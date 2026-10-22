-- =========================================================
-- UCC 2.0 — Phase 8: secure faculty onboarding
-- Date: 2026-10-22
--
-- Forward-only and additive. Safe to re-run. Apply after:
--   2026102201_member_identity_and_contacts.sql
--   2026102204_duplicate_usn_signup_guard.sql
--   2026102206_faculty_approval_status_alignment.sql
--
-- Why this migration exists
-- -------------------------
-- The browser used to insert the pending faculty_applications row after
-- auth.signUp(). When email confirmation is enabled that browser has no
-- session yet, so the RLS-protected insert failed and the application was
-- never created: the profile was left "pending" with nothing for an
-- administrator to review.
--
-- This migration makes signup provisioning atomic and server-side:
--   * handle_new_user() creates the pending application itself.
--   * A faculty-intent signup without a designation is rejected.
--   * A new enforcement trigger stops a direct client INSERT from claiming
--     faculty identity, a privileged role or an approved status.
--   * The profiles self-insert policy is narrowed to non-privileged members.
--   * Faculty-application transitions force the acting administrator as the
--     reviewer and reject a second application from an approved account.
--
-- Approval remains unchanged in principle: only an administrator JWT can
-- change an application's status (RLS + enforce_faculty_application_transition),
-- and on_faculty_application_status() promotes the profile in the same
-- transaction. No signup metadata can grant role='faculty' or 'admin'.
-- =========================================================

begin;

-- ---------------------------------------------------------
-- 1. Repair the schema drift: the updated-at trigger needs this column.
-- ---------------------------------------------------------
alter table public.faculty_applications
  add column if not exists updated_at timestamptz;

-- ---------------------------------------------------------
-- 2. Defense in depth for profile creation.
--
-- RLS already restricts self-inserts. This trigger repeats the rule inside
-- the table for any future policy mistake, and it also prevents a direct
-- client INSERT from writing review-managed designation/employee_id fields.
--
-- auth.uid() is null during auth signup provisioning and for trusted
-- owner/service-role work, so handle_new_user() and operator migrations can
-- still create the profile they need. Anonymous API inserts are still blocked
-- by the profiles INSERT policy (auth.uid() = id).
-- ---------------------------------------------------------
create or replace function public.enforce_pending_faculty_signup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null then
    if new.role is distinct from 'student'
       or new.faculty_status not in ('none', 'pending')
       or new.member_type is distinct from 'student' then
      raise exception 'New profiles cannot grant faculty or admin privileges.';
    end if;

    -- These fields are written only by the signup trigger or an approved
    -- faculty application. A direct self-insert must not set them.
    new.designation := null;
    new.employee_id := null;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_pending_faculty_signup on public.profiles;
create trigger trg_enforce_pending_faculty_signup
before insert on public.profiles
for each row execute procedure public.enforce_pending_faculty_signup();

-- ---------------------------------------------------------
-- 3. Tighten the self-insert RLS policy to match the trigger.
-- ---------------------------------------------------------
drop policy if exists "Users can insert own profile" on public.profiles;
create policy "Users can insert own profile" on public.profiles
  for insert with check (
    auth.uid() = id
    and role = 'student'
    and faculty_status in ('none', 'pending')
    and member_type = 'student'
    and designation is null
    and employee_id is null
  );

-- ---------------------------------------------------------
-- 4. Atomic signup provisioning.
--
-- Replaces the Phase 1D duplicate-USN guard with the same USN behaviour plus:
--   * normalised intent (trim + lower)
--   * a required designation for faculty intent
--   * a pending faculty_applications row created in the same transaction
--
-- The profile is inserted first; the application FKs to it. If either step
-- fails, the auth.users INSERT is rolled back, so no orphan auth account can
-- survive a failed application.
-- ---------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  yr int;
  grad_yr int;
  usn_val text;
  intent text;
  member_kind text;
  full_name_val text;
  department_val text;
  designation_val text;
  employee_id_val text;
begin
  begin
    yr := nullif(meta->>'year', '')::int;
  exception when others then
    yr := null;
  end;
  if yr is not null and (yr < 1 or yr > 4) then
    yr := null;
  end if;

  begin
    grad_yr := nullif(meta->>'graduation_year', '')::int;
  exception when others then
    grad_yr := null;
  end;
  if grad_yr is not null and (grad_yr < 1950 or grad_yr > 2200) then
    grad_yr := null;
  end if;

  usn_val := nullif(upper(btrim(meta->>'usn')), '');
  intent := lower(btrim(coalesce(meta->>'intent', 'student')));
  member_kind := case when intent = 'alumni' then 'alumni' else 'student' end;

  full_name_val := coalesce(
    nullif(btrim(meta->>'name'), ''),
    split_part(coalesce(new.email, ''), '@', 1),
    'Member'
  );
  department_val := coalesce(nullif(btrim(meta->>'department'), ''), 'CSE');
  designation_val := nullif(btrim(meta->>'designation'), '');
  employee_id_val := nullif(btrim(meta->>'employee_id'), '');

  -- The public form already enforces this. Reject a direct Auth API call too:
  -- an application that cannot be reviewed is worse than an explicit error.
  if intent = 'faculty' and designation_val is null then
    raise exception using
      errcode = '23514',
      message = 'Faculty signup requires a designation.',
      detail = 'Signup was rolled back; no auth user or profile was created.',
      hint = 'Submit the faculty application form with your designation.';
  end if;

  insert into public.profiles (
    id, email, name, usn, year, branch, section, bio,
    skills, interests, role, faculty_status,
    designation, employee_id, expertise,
    member_type, graduation_year
  ) values (
    new.id,
    new.email,
    full_name_val,
    usn_val,
    yr,
    department_val,
    nullif(meta->>'section', ''),
    nullif(meta->>'bio', ''),
    case when jsonb_typeof(meta->'skills') = 'array'
      then array(select jsonb_array_elements_text(meta->'skills'))
      else '{}'::text[]
    end,
    case when jsonb_typeof(meta->'interests') = 'array'
      then array(select jsonb_array_elements_text(meta->'interests'))
      else '{}'::text[]
    end,
    'student',
    case when intent = 'faculty' then 'pending' else 'none' end,
    case when intent = 'faculty' then designation_val else null end,
    case when intent = 'faculty' then employee_id_val else null end,
    '{}'::text[],
    member_kind,
    grad_yr
  )
  on conflict (id) do update set
    email = coalesce(excluded.email, public.profiles.email),
    name = coalesce(
      nullif(public.profiles.name, ''),
      excluded.name
    );

  -- The pending application is part of signup, not a second browser request.
  -- ON CONFLICT makes a retry (or the browser's legacy fallback insert)
  -- idempotent without weakening the "one pending application" invariant.
  if intent = 'faculty' then
    insert into public.faculty_applications (
      user_id,
      full_name,
      official_email,
      department,
      designation,
      employee_id,
      status
    ) values (
      new.id,
      full_name_val,
      coalesce(new.email, ''),
      department_val,
      designation_val,
      employee_id_val,
      'pending'
    )
    on conflict (user_id) where status = 'pending' do nothing;
  end if;

  return new;
exception when unique_violation then
  -- Abort the surrounding auth.users INSERT. This is deliberate: the user
  -- must not end up authenticated with no profile. The full USN is not
  -- echoed. The diagnostic is documented in docs/ucc2-phase1-runbook.md.
  raise exception using
    errcode = '23505',
    message = 'USN is already registered to another account.',
    detail = 'Signup was rolled back; no auth user or profile was created.',
    hint = 'Sign in with the existing account or ask an administrator to review the USN collision.';
end;
$$;

comment on function public.handle_new_user() is
  'Provisions a non-privileged profile and, for faculty intent, a pending faculty application atomically. Duplicate normalized USN aborts the signup.';

-- ---------------------------------------------------------
-- 5. Harden application transitions.
--
-- Approval/rejection still requires an administrator JWT. The reviewer is
-- forced to the acting administrator so audit fields cannot be spoofed, and
-- an account that already has faculty access cannot file a second pending
-- application.
-- ---------------------------------------------------------
create or replace function public.enforce_faculty_application_transition()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.status is distinct from 'pending' then
      raise exception 'Faculty applications must start as pending.';
    end if;
    if new.reviewed_by is not null or new.reviewed_at is not null then
      raise exception 'Cannot set reviewer on a new application.';
    end if;
    if exists (
      select 1
      from public.profiles p
      where p.id = new.user_id
        and (
          p.role = 'admin'
          or (p.role = 'faculty' and p.faculty_status in ('approved', 'verified'))
        )
    ) then
      raise exception 'This account already has faculty access.';
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.status is distinct from old.status then
      if not public.is_admin(auth.uid()) then
        raise exception 'Only administrators can change application status.';
      end if;
      if old.status = 'approved' and new.status in ('pending', 'rejected') then
        raise exception 'An approved application cannot be reverted.';
      end if;

      if new.status in ('approved', 'rejected') then
        new.reviewed_by := auth.uid();
        -- Server-controlled audit time. Do not preserve a client-supplied
        -- historical timestamp.
        new.reviewed_at := timezone('utc'::text, now());
      end if;
    end if;

    if new.reviewed_by is distinct from old.reviewed_by
       or new.reviewed_at is distinct from old.reviewed_at then
      if not public.is_admin(auth.uid()) then
        raise exception 'Only administrators can set reviewer fields.';
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_faculty_application_transition on public.faculty_applications;
create trigger trg_faculty_application_transition
before insert or update on public.faculty_applications
for each row execute procedure public.enforce_faculty_application_transition();

-- ---------------------------------------------------------
-- 6. Keep profile state consistent when a rejected member reapplies.
--
-- faculty_applications.status alone drives approval, but the onboarding UI
-- reads profiles.faculty_status. Without this step a rejected member who
-- filed a fresh pending application would still display as rejected. Pending
-- is not a privilege: publishing still requires role='faculty' plus an
-- approved status, so this only fixes the displayed state.
--
-- protect_profile_privileges() is re-stated with one narrow exception:
-- none/rejected -> pending is allowed only while a pending application exists
-- and only when role/member_type are unchanged. Every other protected field
-- is still restored.
-- ---------------------------------------------------------
create or replace function public.protect_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
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

create or replace function public.on_faculty_application_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'pending' then
    update public.profiles
    set faculty_status = 'pending',
        updated_at = timezone('utc'::text, now())
    where id = new.user_id
      and role = 'student'
      and faculty_status in ('none', 'rejected');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_faculty_application_created on public.faculty_applications;
create trigger trg_faculty_application_created
after insert on public.faculty_applications
for each row execute procedure public.on_faculty_application_created();

-- ---------------------------------------------------------
-- 7. Reload PostgREST schema cache
-- ---------------------------------------------------------
commit;

notify pgrst, 'reload schema';
