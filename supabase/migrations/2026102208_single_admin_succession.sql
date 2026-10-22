-- =========================================================
-- UCC Phase 11 — single, transferable administrator role
-- Date: 2026-10-22
-- Migration: 2026102208_single_admin_succession.sql
--
-- REVIEW BEFORE APPLYING. This migration is additive, but it deliberately
-- refuses to run when the existing data violates the new invariants. It never
-- deletes a profile, never changes an existing administrator automatically,
-- and never resets the database.
--
-- What it enforces
-- ----------------
--   1. At most one profile may have role = 'admin' at any time
--      (partial unique index profiles_single_admin).
--   2. An administrator must also be approved faculty:
--      faculty_status in ('approved','verified') and member_type = 'faculty'
--      (CHECK constraint profiles_admin_requires_approved).
--   3. The admin role may only be granted or revoked through the
--      SECURITY DEFINER succession functions below. A direct client UPDATE of
--      role is blocked by trg_enforce_admin_transition, even for an existing
--      administrator.
--   4. Nomination, acceptance, decline, cancellation, resignation and
--      operator recovery are audited with actor, target, timestamp and
--      outcome. The audit log never grants privileges.
--
-- Succession model
-- ----------------
--   current admin --nominate--> approved faculty nominee
--   nominee --accept--> atomic transfer in one transaction:
--       old admin  -> role='faculty'  (keeps approved status)
--       new admin  -> role='admin'    (already approved faculty)
--   nominee --decline--> nomination declined, current admin unchanged
--   admin --cancel--> nomination cancelled
--   admin --resign--> role='faculty'; if no successor was accepted there is
--       temporarily no admin. This is recoverable only by an explicit,
--       audited operator action: public.recover_admin(target, reason), which
--       is executable by service_role/database owner, never by a browser.
--
-- Apply after 2026102207_secure_faculty_onboarding.sql.
-- Run supabase/admin/preflight.sql first and reconcile its output.
-- =========================================================

begin;

-- ---------------------------------------------------------
-- 1. Preflight: refuse to guess about existing administrators.
-- ---------------------------------------------------------
do $$
declare
  n int;
  ids text;
begin
  select count(*) into n from public.profiles where role = 'admin';
  if n > 1 then
    select string_agg(id::text, ', ' order by created_at) into ids
    from public.profiles where role = 'admin';
    raise exception using
      errcode = '23514',
      message = format(
        'Cannot enforce a single administrator: %s profiles currently have role = admin.', n
      ),
      detail = format('Admin profile ids: %s', ids),
      hint = 'Review supabase/admin/preflight.sql, decide which account remains admin, demote the others explicitly, then apply this migration.';
  end if;
end $$;

do $$
declare
  n int;
  ids text;
begin
  select count(*) into n
  from public.profiles
  where role = 'admin'
    and not (
      faculty_status in ('approved', 'verified')
      and member_type = 'faculty'
    );
  if n > 0 then
    select string_agg(id::text, ', ' order by created_at) into ids
    from public.profiles
    where role = 'admin'
      and not (
        faculty_status in ('approved', 'verified')
        and member_type = 'faculty'
      );
    raise exception using
      errcode = '23514',
      message = 'An existing administrator is not approved faculty.',
      detail = format('Admin profile ids needing review: %s', ids),
      hint = 'Review supabase/admin/preflight.sql and explicitly set faculty_status/member_type for the current administrator before applying. The migration does not rewrite it automatically.';
  end if;
end $$;

-- ---------------------------------------------------------
-- 2. Database-level invariants.
-- ---------------------------------------------------------

-- At most one row with role = 'admin'. The partial unique index is the final
-- race-condition guard: even if two transfer transactions overlap, only one
-- can commit the admin row.
create unique index if not exists profiles_single_admin
  on public.profiles (role)
  where role = 'admin';

comment on index public.profiles_single_admin is
  'UCC Phase 11: at most one profile may hold role = admin at a time.';

-- An admin is also an approved faculty member. This is enforced on the table
-- itself, not only in the UI or in a server route.
alter table public.profiles
  drop constraint if exists profiles_admin_requires_approved;
alter table public.profiles
  add constraint profiles_admin_requires_approved
  check (
    role <> 'admin'
    or (
      faculty_status in ('approved', 'verified')
      and member_type = 'faculty'
    )
  );

-- ---------------------------------------------------------
-- 3. Protect the admin role from direct client writes.
--
-- The transaction-local GUC `ucc.admin_transition` is set only inside the
-- SECURITY DEFINER functions below. auth.uid() IS NULL is the trusted
-- operator/SQL-Editor path (including bootstrap and disaster recovery).
-- A signed-in browser session can never set the GUC.
-- ---------------------------------------------------------
create or replace function public.enforce_admin_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role
     and (new.role = 'admin' or old.role = 'admin')
     and coalesce(current_setting('ucc.admin_transition', true), '') <> 'on'
     and auth.uid() is not null then
    raise exception using
      errcode = '42501',
      message = 'The administrator role can only change through the succession process.',
      hint = 'Use nominate_admin/accept_admin_nomination/resign_admin instead of updating profiles.role directly.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_admin_transition on public.profiles;
create trigger trg_enforce_admin_transition
before update on public.profiles
for each row execute procedure public.enforce_admin_transition();

-- Re-state the existing privilege-protection trigger with one addition: the
-- succession functions must be able to change the admin role even though the
-- nominee (the caller) is not an administrator. Every other rule is unchanged.
create or replace function public.protect_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only set inside the SECURITY DEFINER succession functions. It is
  -- transaction-local and cannot be set by a browser session.
  if coalesce(current_setting('ucc.admin_transition', true), '') = 'on' then
    return new;
  end if;

  if public.is_admin(auth.uid()) then
    return new;
  end if;

  if new.faculty_status = 'pending'
     and old.faculty_status in ('none', 'rejected')
     and new.role is not distinct from old.role
     and new.member_type is not distinct from old.member_type
     and exists (
       select 1
       from public.faculty_applications a
       where a.user_id = old.id and a.status = 'pending'
     ) then
    -- Only the non-privileged status transition is allowed. Review-managed
    -- identity fields remain owned by the application/admin flow.
    new.employee_id := old.employee_id;
    new.designation := old.designation;
    new.usn := old.usn;
    new.graduation_year := old.graduation_year;
    return new;
  end if;

  new.role := old.role;
  new.faculty_status := old.faculty_status;
  new.employee_id := old.employee_id;
  new.designation := old.designation;
  new.usn := old.usn;
  new.member_type := old.member_type;
  new.graduation_year := old.graduation_year;
  return new;
end;
$$;

-- ---------------------------------------------------------
-- 4. Audit and nomination history.
-- ---------------------------------------------------------
create table if not exists public.admin_nominations (
  id uuid primary key default gen_random_uuid(),
  nominated_by uuid references public.profiles(id) on delete set null,
  nominee_id uuid references public.profiles(id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  note text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default timezone('utc'::text, now()),
  responded_at timestamptz,
  constraint admin_nominations_no_self
    check (nominated_by is null or nominee_id is null or nominated_by <> nominee_id)
);

-- Only one pending nomination exists at a time. This makes "the current admin
-- nominated X" unambiguous and lets the acceptance function verify that the
-- nominator is still the current admin.
create unique index if not exists admin_nominations_one_pending
  on public.admin_nominations (status)
  where status = 'pending';

create index if not exists admin_nominations_created_idx
  on public.admin_nominations (created_at desc);

create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  action text not null check (action in (
    'nomination_created',
    'nomination_declined',
    'nomination_cancelled',
    'admin_transfer',
    'resignation',
    'recovery'
  )),
  actor_id uuid references public.profiles(id) on delete set null,
  -- Names are snapshotted so audit history survives a later profile deletion.
  actor_name text,
  target_id uuid references public.profiles(id) on delete set null,
  target_name text,
  nomination_id uuid references public.admin_nominations(id) on delete set null,
  outcome text not null,
  detail text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists admin_audit_log_created_idx
  on public.admin_audit_log (created_at desc);

create index if not exists admin_audit_log_action_idx
  on public.admin_audit_log (action, created_at desc);

-- ---------------------------------------------------------
-- 5. Eligibility and read helpers.
-- ---------------------------------------------------------
create or replace function public.is_eligible_admin_candidate(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = p_user
      and p.role = 'faculty'
      and p.faculty_status in ('approved', 'verified')
      and p.member_type = 'faculty'
  );
$$;

revoke all on function public.is_eligible_admin_candidate(uuid) from public;
grant execute on function public.is_eligible_admin_candidate(uuid)
  to authenticated;

create or replace function public.current_admin_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.id from public.profiles p where p.role = 'admin' limit 1;
$$;

revoke all on function public.current_admin_id() from public;
grant execute on function public.current_admin_id() to authenticated;

-- ---------------------------------------------------------
-- 6. Nominate / accept / decline / cancel / resign.
-- ---------------------------------------------------------
create or replace function public.nominate_admin(
  p_nominee uuid,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_admin uuid;
  v_id uuid;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'Sign in required.';
  end if;

  -- Serialise every succession action on the current admin row.
  select p.id into v_admin
  from public.profiles p
  where p.role = 'admin'
  for update;

  if v_admin is null then
    raise exception using
      errcode = 'P0001',
      message = 'No current administrator exists.',
      hint = 'Use the documented operator recovery procedure.';
  end if;
  if v_actor <> v_admin then
    raise exception using
      errcode = '42501',
      message = 'Only the current administrator can nominate a successor.';
  end if;
  if p_nominee is null or p_nominee = v_actor then
    raise exception using
      errcode = '22023',
      message = 'Choose another approved faculty member as the nominee.';
  end if;
  if not public.is_eligible_admin_candidate(p_nominee) then
    raise exception using
      errcode = '22023',
      message = 'The nominee must be a currently approved faculty member.';
  end if;
  if exists (
    select 1 from public.admin_nominations where status = 'pending'
  ) then
    raise exception using
      errcode = '23505',
      message = 'A nomination is already pending.',
      hint = 'Cancel the pending nomination before nominating someone else.';
  end if;

  insert into public.admin_nominations (nominated_by, nominee_id, note)
  values (v_actor, p_nominee, v_note)
  returning id into v_id;

  insert into public.admin_audit_log (
    action, actor_id, actor_name, target_id, target_name,
    nomination_id, outcome, detail
  )
  select
    'nomination_created', v_actor, a.name, p_nominee, t.name,
    v_id, 'pending', v_note
  from public.profiles a, public.profiles t
  where a.id = v_actor and t.id = p_nominee;

  return v_id;
end;
$$;

create or replace function public.accept_admin_nomination(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_admin uuid;
  v_nom public.admin_nominations%rowtype;
  v_old_name text;
  v_new_name text;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'Sign in required.';
  end if;

  -- Lock order is always: current admin row, then nomination row. Every
  -- succession function follows this order, so resignation and acceptance
  -- cannot deadlock each other.
  select p.id into v_admin
  from public.profiles p
  where p.role = 'admin'
  for update;

  select * into v_nom
  from public.admin_nominations
  where id = p_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Nomination not found.';
  end if;
  if v_nom.status <> 'pending' then
    raise exception using
      errcode = 'P0001',
      message = 'This nomination is no longer pending.';
  end if;
  if v_actor <> v_nom.nominee_id then
    raise exception using
      errcode = '42501',
      message = 'Only the nominee can accept this nomination.';
  end if;
  if v_admin is null or v_admin <> v_nom.nominated_by then
    update public.admin_nominations
    set status = 'cancelled', responded_at = timezone('utc'::text, now())
    where id = p_id;
    raise exception using
      errcode = 'P0001',
      message = 'The nominating administrator is no longer current.';
  end if;
  if not public.is_eligible_admin_candidate(v_actor) then
    raise exception using
      errcode = '22023',
      message = 'The nominee is no longer an approved faculty member.';
  end if;

  select name into v_old_name from public.profiles where id = v_admin;
  select name into v_new_name from public.profiles where id = v_actor;

  -- The transaction-local flag lets the privilege-protection trigger accept
  -- the two role changes. It is set only inside this SECURITY DEFINER
  -- function and is cleared automatically at transaction end.
  perform set_config('ucc.admin_transition', 'on', true);

  -- Demote first, then promote: the partial unique index never sees two
  -- administrators, even mid-transaction.
  update public.profiles
  set role = 'faculty',
      updated_at = timezone('utc'::text, now())
  where id = v_admin;

  update public.profiles
  set role = 'admin',
      faculty_status = case
        when faculty_status in ('approved', 'verified') then faculty_status
        else 'approved'
      end,
      member_type = 'faculty',
      updated_at = timezone('utc'::text, now())
  where id = v_actor;

  update public.admin_nominations
  set status = 'accepted', responded_at = timezone('utc'::text, now())
  where id = p_id;

  insert into public.admin_audit_log (
    action, actor_id, actor_name, target_id, target_name,
    nomination_id, outcome, detail, metadata
  ) values (
    'admin_transfer', v_actor, v_new_name, v_actor, v_new_name,
    p_id, 'accepted',
    format('Administrator role transferred from %s to %s', v_old_name, v_new_name),
    jsonb_build_object('previous_admin_id', v_admin, 'new_admin_id', v_actor)
  );
end;
$$;

create or replace function public.decline_admin_nomination(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_nom public.admin_nominations%rowtype;
  v_actor_name text;
  v_target_name text;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'Sign in required.';
  end if;

  select * into v_nom
  from public.admin_nominations
  where id = p_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Nomination not found.';
  end if;
  if v_actor <> v_nom.nominee_id then
    raise exception using
      errcode = '42501',
      message = 'Only the nominee can decline this nomination.';
  end if;
  if v_nom.status <> 'pending' then
    raise exception using
      errcode = 'P0001',
      message = 'This nomination is no longer pending.';
  end if;

  update public.admin_nominations
  set status = 'declined', responded_at = timezone('utc'::text, now())
  where id = p_id;

  select name into v_actor_name from public.profiles where id = v_actor;
  select name into v_target_name from public.profiles where id = v_nom.nominated_by;

  insert into public.admin_audit_log (
    action, actor_id, actor_name, target_id, target_name,
    nomination_id, outcome, detail
  ) values (
    'nomination_declined', v_actor, v_actor_name,
    v_nom.nominated_by, v_target_name, p_id, 'declined',
    'Nominee declined the administrator nomination'
  );
end;
$$;

create or replace function public.cancel_admin_nomination(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_admin uuid;
  v_nom public.admin_nominations%rowtype;
  v_actor_name text;
  v_target_name text;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'Sign in required.';
  end if;

  select p.id into v_admin
  from public.profiles p
  where p.role = 'admin'
  for update;

  if v_admin is null or v_actor <> v_admin then
    raise exception using
      errcode = '42501',
      message = 'Only the current administrator can cancel a nomination.';
  end if;

  select * into v_nom
  from public.admin_nominations
  where id = p_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Nomination not found.';
  end if;
  if v_nom.status <> 'pending' then
    raise exception using
      errcode = 'P0001',
      message = 'This nomination is no longer pending.';
  end if;

  update public.admin_nominations
  set status = 'cancelled', responded_at = timezone('utc'::text, now())
  where id = p_id;

  select name into v_actor_name from public.profiles where id = v_actor;
  select name into v_target_name from public.profiles where id = v_nom.nominee_id;

  insert into public.admin_audit_log (
    action, actor_id, actor_name, target_id, target_name,
    nomination_id, outcome, detail
  ) values (
    'nomination_cancelled', v_actor, v_actor_name,
    v_nom.nominee_id, v_target_name, p_id, 'cancelled',
    'Nominating administrator cancelled the nomination'
  );
end;
$$;

create or replace function public.resign_admin(p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_admin uuid;
  v_name text;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'Sign in required.';
  end if;

  select p.id into v_admin
  from public.profiles p
  where p.role = 'admin'
  for update;

  if v_admin is null or v_actor <> v_admin then
    raise exception using
      errcode = '42501',
      message = 'Only the current administrator can resign.';
  end if;

  select name into v_name from public.profiles where id = v_actor;

  perform set_config('ucc.admin_transition', 'on', true);

  update public.profiles
  set role = 'faculty',
      updated_at = timezone('utc'::text, now())
  where id = v_actor;

  -- A resignation invalidates any outstanding nomination: the next
  -- administrator must be chosen by a current administrator, or through the
  -- documented operator recovery process.
  update public.admin_nominations
  set status = 'cancelled', responded_at = timezone('utc'::text, now())
  where status = 'pending';

  insert into public.admin_audit_log (
    action, actor_id, actor_name, target_id, target_name,
    outcome, detail, metadata
  ) values (
    'resignation', v_actor, v_name, v_actor, v_name,
    'completed',
    coalesce(v_reason, 'Administrator resigned'),
    jsonb_build_object('admin_remaining', public.current_admin_id())
  );
end;
$$;

-- ---------------------------------------------------------
-- 7. Explicit operator recovery.
--
-- This is the only path out of a resignation without an accepted successor.
-- It is NOT callable by a browser session: execute is revoked from anon and
-- authenticated, and the function itself rejects any caller that has a JWT
-- (auth.uid() is not null). It requires an explicit operator decision, a
-- reason, and it writes an audit row.
-- ---------------------------------------------------------
create or replace function public.recover_admin(
  p_target uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_admin uuid;
  v_target_name text;
begin
  if auth.uid() is not null then
    raise exception using
      errcode = '42501',
      message = 'Administrator recovery is an operator-only action.';
  end if;
  if v_reason is null or char_length(v_reason) < 10 then
    raise exception using
      errcode = '22023',
      message = 'A recovery reason of at least 10 characters is required.';
  end if;
  if p_target is null then
    raise exception using
      errcode = '22023',
      message = 'A recovery target is required.';
  end if;

  select p.id into v_admin
  from public.profiles p
  where p.role = 'admin'
  for update;

  if v_admin is not null then
    raise exception using
      errcode = 'P0001',
      message = 'An administrator already exists.',
      hint = 'Use the normal nomination and acceptance process.';
  end if;
  if not public.is_eligible_admin_candidate(p_target) then
    raise exception using
      errcode = '22023',
      message = 'The recovery target must be a currently approved faculty member.';
  end if;

  select name into v_target_name from public.profiles where id = p_target;

  perform set_config('ucc.admin_transition', 'on', true);

  update public.profiles
  set role = 'admin',
      faculty_status = case
        when faculty_status in ('approved', 'verified') then faculty_status
        else 'approved'
      end,
      member_type = 'faculty',
      updated_at = timezone('utc'::text, now())
  where id = p_target;

  insert into public.admin_audit_log (
    action, actor_id, actor_name, target_id, target_name,
    outcome, detail, metadata
  ) values (
    'recovery', null, format('operator (%s)', session_user),
    p_target, v_target_name, 'completed', v_reason,
    jsonb_build_object('reason', v_reason, 'operator', session_user)
  );
end;
$$;

-- ---------------------------------------------------------
-- 8. Permissions.
-- ---------------------------------------------------------
revoke all on function public.nominate_admin(uuid, text) from public;
revoke all on function public.accept_admin_nomination(uuid) from public;
revoke all on function public.decline_admin_nomination(uuid) from public;
revoke all on function public.cancel_admin_nomination(uuid) from public;
revoke all on function public.resign_admin(text) from public;

grant execute on function public.nominate_admin(uuid, text) to authenticated;
grant execute on function public.accept_admin_nomination(uuid) to authenticated;
grant execute on function public.decline_admin_nomination(uuid) to authenticated;
grant execute on function public.cancel_admin_nomination(uuid) to authenticated;
grant execute on function public.resign_admin(text) to authenticated;

revoke all on function public.recover_admin(uuid, text) from public;
revoke all on function public.recover_admin(uuid, text) from anon;
revoke all on function public.recover_admin(uuid, text) from authenticated;
grant execute on function public.recover_admin(uuid, text) to service_role;

-- ---------------------------------------------------------
-- 9. RLS: history is readable to the people involved and to the admin.
--    No client INSERT/UPDATE/DELETE policy exists, so the tables are
--    append-only from the API's point of view.
-- ---------------------------------------------------------
alter table public.admin_nominations enable row level security;
alter table public.admin_audit_log enable row level security;

drop policy if exists "Admins and participants read admin nominations"
  on public.admin_nominations;
create policy "Admins and participants read admin nominations"
  on public.admin_nominations
  for select
  using (
    public.is_admin(auth.uid())
    or auth.uid() = nominated_by
    or auth.uid() = nominee_id
  );

drop policy if exists "Admins read admin audit log"
  on public.admin_audit_log;
create policy "Admins read admin audit log"
  on public.admin_audit_log
  for select
  using (public.is_admin(auth.uid()));

revoke insert, update, delete on public.admin_nominations from anon, authenticated;
revoke insert, update, delete on public.admin_audit_log from anon, authenticated;
grant select on public.admin_nominations to authenticated;
grant select on public.admin_audit_log to authenticated;

-- Internal helper functions do not need public execute.
revoke all on function public.enforce_admin_transition() from public;
revoke all on function public.current_admin_id() from public;
grant execute on function public.current_admin_id() to authenticated;

commit;

notify pgrst, 'reload schema';
