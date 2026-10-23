-- =========================================================
-- UCC 2.0 — atomic, truthful faculty application review
-- Date: 2026-10-23
-- Migration: 2026102213_faculty_review_atomic.sql
--
-- Why this migration exists
-- -------------------------
-- The admin API wrote `faculty_applications.notes`, but the review reason is
-- stored in `review_notes`. The status trigger also read `new.notes`, so a
-- rejection reason was never persisted or shown to the applicant.
--
-- More importantly, the API performed a direct table UPDATE and treated an
-- empty result as "already reviewed". That conflates three different states:
--   * the row is already approved/rejected,
--   * the row does not exist,
--   * RLS (or a trigger) silently matched zero rows.
--
-- This migration makes review a single database transaction:
--   * `review_faculty_application()` checks auth.uid() is an administrator,
--     transitions only a row that is still `pending`, and forces the reviewer
--     and timestamp from the trusted session.
--   * The RPC accepts `approve` / `reject` and maps them to the stored
--     `approved` / `rejected` status, matching the admin UI's decision values.
--     It deliberately rejects `approved` / `rejected` to keep one vocabulary
--     at the API boundary.
--   * The existing status trigger promotes the profile in the same
--     transaction. The RPC verifies the resulting profile state and rolls
--     back if it did not reach the expected state.
--   * A zero-row transition re-reads the row and returns the real current
--     state to the caller.
--   * Rejection requires a reason and stores it in `review_notes`.
--
-- Safety
-- ------
-- * Forward-only, idempotent, additive.
-- * Does not delete or bulk-rewrite reviewed records.
-- * Does not touch Supabase Auth users or email verification.
-- * Re-asserts the admin-only UPDATE policy (live databases can drift).
-- =========================================================

begin;

-- ---------------------------------------------------------
-- 1. Canonical review-reason column and profile columns.
--
-- Older databases created `notes`; the live UCC 2.0 database uses
-- `review_notes`. Ensure target databases converge on `review_notes` without
-- creating a second review column.
-- ---------------------------------------------------------
alter table public.faculty_applications
  add column if not exists review_notes text;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'faculty_applications'
      and column_name = 'notes'
  ) then
    execute $copy$
      update public.faculty_applications
      set review_notes = notes
      where review_notes is null and notes is not null
    $copy$;
  end if;
end $$;

alter table public.profiles add column if not exists designation text;
alter table public.profiles add column if not exists employee_id text;

-- Do not alter profiles_faculty_status_check. The live UCC 2.0 constraint
-- allows only pending / approved / rejected, and approval writes 'approved'.
-- Dropping and re-adding the constraint here would weaken that guarantee.

-- ---------------------------------------------------------
-- 2. Transition guard.
--
-- Only an administrator may review, only a pending application may be
-- reviewed, and the audit fields always come from auth.uid()/now().
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
          or (p.role = 'faculty' and p.faculty_status = 'approved')
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
      if old.status is distinct from 'pending' then
        raise exception 'Only pending applications can be reviewed.';
      end if;
      if new.status not in ('approved', 'rejected') then
        raise exception 'Application status must be approved or rejected.';
      end if;
      if new.status = 'rejected'
         and nullif(btrim(coalesce(new.review_notes, '')), '') is null then
        raise exception 'A rejection reason is required.';
      end if;

      -- Never trust client-supplied audit fields.
      new.reviewed_by := auth.uid();
      new.reviewed_at := timezone('utc'::text, now());
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
-- 3. Profile synchronisation.
--
-- Approval: promote to faculty and approved, copy valid designation and
-- employee ID only when present, and leave email verification untouched.
-- Rejection: mark rejected, never promote.
-- ---------------------------------------------------------
create or replace function public.on_faculty_application_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    update public.profiles
    set
      role = case when role = 'admin' then 'admin' else 'faculty' end,
      faculty_status = 'approved',
      member_type = 'faculty',
      designation = coalesce(nullif(btrim(new.designation), ''), designation),
      employee_id = coalesce(nullif(btrim(new.employee_id), ''), employee_id),
      name = coalesce(nullif(name, ''), new.full_name),
      updated_at = timezone('utc'::text, now())
    where id = new.user_id;

    perform public.emit_notification(
      new.user_id,
      'faculty_decision',
      'Faculty access approved',
      'Your faculty application was approved. You now have faculty permissions.',
      '/faculty/dashboard'
    );
  elsif new.status = 'rejected' and old.status is distinct from 'rejected' then
    update public.profiles
    set faculty_status = 'rejected', updated_at = timezone('utc'::text, now())
    where id = new.user_id and role <> 'admin';

    perform public.emit_notification(
      new.user_id,
      'faculty_decision',
      'Faculty application update',
      coalesce(
        nullif(btrim(new.review_notes), ''),
        'Your faculty application was not approved.'
      ),
      '/signup/faculty'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_faculty_application_status on public.faculty_applications;
create trigger trg_faculty_application_status
  after update on public.faculty_applications
  for each row execute procedure public.on_faculty_application_status();

-- ---------------------------------------------------------
-- 4. Atomic review entry point.
--
-- p_decision is `approve` or `reject`. Returns a jsonb object with:
--   outcome: approved | rejected | already_approved | already_rejected |
--            changed | not_found
--   decision: the validated approve/reject input
--   current_status: the real status after the attempt
--   application: the current application row (except not_found)
-- ---------------------------------------------------------
create or replace function public.review_faculty_application(
  p_application_id uuid,
  p_decision text,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_decision text := lower(btrim(coalesce(p_decision, '')));
  v_status_new text;
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_app public.faculty_applications;
  v_current public.faculty_applications;
  v_role text;
  v_status text;
begin
  if v_admin is null or not public.is_admin(v_admin) then
    raise exception using
      errcode = '42501',
      message = 'Administrator access required.';
  end if;

  if v_decision not in ('approve', 'reject') then
    raise exception using
      errcode = '22023',
      message = 'Decision must be approve or reject.';
  end if;

  if v_decision = 'reject' and v_notes is null then
    raise exception using
      errcode = '22023',
      message = 'A rejection reason is required.';
  end if;

  if v_notes is not null and length(v_notes) > 500 then
    v_notes := left(v_notes, 500);
  end if;

  v_status_new := case when v_decision = 'approve' then 'approved' else 'rejected' end;

  -- The status predicate is the concurrency guard: PostgreSQL re-checks it
  -- against the committed row after any competing transaction releases its
  -- lock, so only one administrator can transition a pending row.
  update public.faculty_applications
  set
    status = v_status_new,
    reviewed_by = v_admin,
    reviewed_at = timezone('utc'::text, now()),
    review_notes = case when v_decision = 'reject' then v_notes else null end
  where id = p_application_id
    and status = 'pending'
  returning * into v_app;

  if v_app.id is null then
    select * into v_current
    from public.faculty_applications
    where id = p_application_id;

    if v_current.id is null then
      return jsonb_build_object('outcome', 'not_found');
    end if;

    return jsonb_build_object(
      'outcome',
      case v_current.status
        when 'approved' then 'already_approved'
        when 'rejected' then 'already_rejected'
        else 'changed'
      end,
      'current_status', v_current.status,
      'application', to_jsonb(v_current)
    );
  end if;

  -- Verify the status trigger completed the profile side atomically. If it
  -- did not, raise: the caller must never see a successful review with a
  -- half-promoted profile.
  select p.role, p.faculty_status
  into v_role, v_status
  from public.profiles p
  where p.id = v_app.user_id;

  if v_role is null then
    raise exception using
      errcode = '23503',
      message = 'Applicant profile is missing; review rolled back.';
  end if;

  if v_decision = 'approve'
     and (v_role not in ('faculty', 'admin') or v_status <> 'approved') then
    raise exception using
      errcode = 'P0001',
      message = 'Faculty profile update did not complete; approval rolled back.';
  end if;

  if v_decision = 'reject'
     and v_role <> 'admin'
     and v_status <> 'rejected' then
    raise exception using
      errcode = 'P0001',
      message = 'Faculty profile update did not complete; rejection rolled back.';
  end if;

  return jsonb_build_object(
    'outcome', v_status_new,
    'decision', v_decision,
    'current_status', v_app.status,
    'application', to_jsonb(v_app)
  );
end;
$$;

revoke all on function public.review_faculty_application(uuid, text, text) from public;
revoke all on function public.review_faculty_application(uuid, text, text) from anon;
grant execute on function public.review_faculty_application(uuid, text, text) to authenticated;

comment on function public.review_faculty_application(uuid, text, text) is
  'Administrator-only, atomic faculty application review. Transitions only a pending row, forces reviewer fields from auth.uid(), stores the rejection reason in review_notes, and reports the real state when no transition occurs.';

-- ---------------------------------------------------------
-- 5. Re-assert RLS. Admins review; applicants only read their own row and
-- insert a pending application. No policy is weakened.
-- ---------------------------------------------------------
alter table public.faculty_applications enable row level security;

drop policy if exists "Admins manage faculty applications" on public.faculty_applications;
create policy "Admins manage faculty applications" on public.faculty_applications
  for update
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

commit;

notify pgrst, 'reload schema';
