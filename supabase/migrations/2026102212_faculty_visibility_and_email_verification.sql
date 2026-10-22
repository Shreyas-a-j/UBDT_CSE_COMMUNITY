-- =========================================================
-- UCC 2.0 — faculty application visibility + email verification
-- Date: 2026-10-23
-- Migration: 2026102212_faculty_visibility_and_email_verification.sql
--
-- Why this migration exists
-- -------------------------
-- 1. A faculty signup must always produce a reviewable application. The
--    durable fix is server-side provisioning in handle_new_user() (added in
--    2026102207). This migration re-asserts that function and its auth.users
--    trigger so a database that never received 2026102207 still provisions
--    atomically instead of relying on a browser insert that RLS blocks while
--    email confirmation is enabled.
-- 2. Accounts that signed up while the trigger was missing were left with
--    profiles.faculty_status = 'pending' but no faculty_applications row, so
--    no administrator could see or review them. Backfill one pending
--    application per such profile. The partial unique index makes this
--    idempotent.
-- 3. The admin dashboard needs a realtime invalidation channel so a new
--    application appears without a manual refresh.
-- 4. Email verification must come from trusted Supabase Auth data
--    (auth.users.email_confirmed_at), never from a client boolean or from an
--    editable profile column. A SECURITY DEFINER RPC exposes only the boolean
--    for authorised targets: the member themselves, an administrator, or an
--    account that is already approved faculty (the public directory case).
--
-- Safety
-- ------
-- * Additive and re-runnable; no destructive statements.
-- * No role, faculty approval or member type is changed by the backfill.
-- * No RLS policy is disabled or weakened.
-- * The RPC never returns an email address, only user_id + a boolean.
-- =========================================================

begin;

-- ---------------------------------------------------------
-- 1. Columns required by the provisioning trigger and the sync triggers.
--
-- This migration must be safe on a hosted database that skipped one or more
-- earlier alignment migrations. In particular, profiles.employee_id was
-- missing in production even though 2026101303/2026102201 define it, which
-- made the backfill fail with 42703. Every column written by handle_new_user()
-- or read by the backfill is therefore ensured here. These are no-ops on a
-- canonical database.
-- ---------------------------------------------------------
alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists name text;
alter table public.profiles add column if not exists usn text;
alter table public.profiles add column if not exists year integer;
alter table public.profiles add column if not exists branch text;
alter table public.profiles add column if not exists section text;
alter table public.profiles add column if not exists bio text;
alter table public.profiles add column if not exists skills text[] default '{}'::text[];
alter table public.profiles add column if not exists interests text[] default '{}'::text[];
alter table public.profiles add column if not exists role text not null default 'student';
alter table public.profiles add column if not exists faculty_status text not null default 'none';
alter table public.profiles add column if not exists designation text;
alter table public.profiles add column if not exists employee_id text;
alter table public.profiles add column if not exists expertise text[] default '{}'::text[];
alter table public.profiles add column if not exists member_type text not null default 'student';
alter table public.profiles add column if not exists graduation_year integer;
alter table public.profiles add column if not exists created_at timestamptz default timezone('utc'::text, now());
alter table public.profiles add column if not exists updated_at timestamptz
  default timezone('utc'::text, now());

-- Keep the application table self-consistent too: the signup trigger and the
-- backfill both write these columns. Add them before the partial index below.
alter table public.faculty_applications add column if not exists user_id uuid;
alter table public.faculty_applications add column if not exists full_name text;
alter table public.faculty_applications add column if not exists official_email text;
alter table public.faculty_applications add column if not exists department text;
alter table public.faculty_applications add column if not exists designation text;
alter table public.faculty_applications add column if not exists employee_id text;
alter table public.faculty_applications add column if not exists status text default 'pending';
alter table public.faculty_applications add column if not exists created_at timestamptz default timezone('utc'::text, now());
alter table public.faculty_applications add column if not exists updated_at timestamptz
  default timezone('utc'::text, now());

-- The signup trigger's ON CONFLICT clause depends on this partial index.
create unique index if not exists faculty_applications_one_pending
  on public.faculty_applications (user_id)
  where status = 'pending';

-- ---------------------------------------------------------
-- 2. Re-assert atomic signup provisioning.
--
-- Kept byte-for-byte compatible with 2026102207 / schema.sql. The function
-- creates the profile first and the pending application in the same
-- transaction. If either fails, the auth.users INSERT rolls back, so an
-- account can never exist without the application an administrator reviews.
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
  -- Abort the surrounding auth.users INSERT. The full USN is not echoed.
  raise exception using
    errcode = '23505',
    message = 'USN is already registered to another account.',
    detail = 'Signup was rolled back; no auth user or profile was created.',
    hint = 'Sign in with the existing account or ask an administrator to review the USN collision.';
end;
$$;

comment on function public.handle_new_user() is
  'Provisions a non-privileged profile and, for faculty intent, a pending faculty application atomically. Duplicate normalized USN aborts the signup.';

-- Ensure the auth trigger exists even on a database that skipped 2026102207.
-- The trigger definition is owned by the auth schema; migrations run as an
-- owner role, matching Supabase's normal migration path.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- ---------------------------------------------------------
-- 3. Backfill pending applications for profiles that have none.
--
-- This is deliberately narrow:
--   * only student accounts in the pending onboarding state;
--   * only when no pending application already exists (idempotent);
--   * no role, approval or member type is changed.
--
-- 'Faculty applicant' is used only when a legacy profile has no designation,
-- because faculty_applications.designation is NOT NULL. The reviewer can see
-- the missing value and reject or correct it.
-- ---------------------------------------------------------
-- The repair is a function so an operator can re-run the same code after
-- diagnosing a future provisioning gap. It is owner-only: EXECUTE is revoked
-- from PUBLIC and never granted to anon/authenticated, because it writes
-- reviewable application rows.
create or replace function public.backfill_pending_faculty_applications()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_count integer;
begin
  insert into public.faculty_applications (
    user_id,
    full_name,
    official_email,
    department,
    designation,
    employee_id,
    status,
    created_at,
    updated_at
  )
  select
    p.id,
    coalesce(
      nullif(btrim(p.name), ''),
      split_part(coalesce(p.email, ''), '@', 1),
      'Member'
    ),
    coalesce(nullif(btrim(p.email), ''), ''),
    coalesce(nullif(btrim(p.branch), ''), 'CSE'),
    coalesce(nullif(btrim(p.designation), ''), 'Faculty applicant'),
    p.employee_id,
    'pending',
    coalesce(p.created_at, timezone('utc'::text, now())),
    timezone('utc'::text, now())
  from public.profiles p
  where p.role = 'student'
    and p.faculty_status = 'pending'
    and p.email is not null
    and btrim(p.email) <> ''
    and not exists (
      select 1
      from public.faculty_applications a
      where a.user_id = p.id
        and a.status = 'pending'
    )
  on conflict do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

comment on function public.backfill_pending_faculty_applications() is
  'Creates one pending application for each orphaned pending faculty profile. Idempotent; owner-only maintenance function.';

-- Supabase's default privileges grant EXECUTE on new public functions to the
-- API roles. Revoke PUBLIC *and* those explicit grants, otherwise anon could
-- inject reviewable applications through PostgREST.
revoke all on function public.backfill_pending_faculty_applications()
  from public, anon, authenticated, service_role;

select public.backfill_pending_faculty_applications();

-- ---------------------------------------------------------
-- 4. Email-verification lookup.
--
-- Returns one row per requested user whose verification state the caller may
-- see:
--   * an administrator sees every requested id;
--   * a member sees their own id;
--   * anyone (including an anonymous directory visitor) sees an id that is
--     already approved faculty, because that fact is part of the public
--     faculty directory.
--
-- It returns only a boolean derived from auth.users.email_confirmed_at. No
-- email address, token, timestamp or other Auth field is exposed. Unauthorised
-- ids are silently omitted rather than raising, so a directory can request a
-- mixed batch without failing.
-- ---------------------------------------------------------
create or replace function public.get_email_verification_status(target_user_ids uuid[])
returns table (user_id uuid, email_verified boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  caller_is_admin boolean := false;
begin
  if target_user_ids is null or cardinality(target_user_ids) = 0 then
    return;
  end if;

  -- Evaluated once; is_admin() is SECURITY DEFINER and stable.
  caller_is_admin := public.is_admin(caller);

  return query
  select u.id, (u.email_confirmed_at is not null)
  from auth.users u
  where u.id = any(target_user_ids)
    and (
      caller_is_admin
      or u.id = caller
      or public.is_verified_faculty(u.id)
    );
end;
$$;

comment on function public.get_email_verification_status(uuid[]) is
  'Returns only user_id + email_confirmed_at-derived boolean, authorised for self, admins, and approved faculty. Never exposes an email address.';

revoke all on function public.get_email_verification_status(uuid[]) from public;
grant execute on function public.get_email_verification_status(uuid[]) to authenticated, anon;

-- ---------------------------------------------------------
-- 5. Realtime: let the admin dashboard react to a new application.
--    Guarded so the migration also runs on a database without the
--    supabase_realtime publication (e.g. a plain PostgreSQL rehearsal).
-- ---------------------------------------------------------
alter table public.faculty_applications replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'faculty_applications'
    ) then
      execute 'alter publication supabase_realtime add table public.faculty_applications';
    end if;
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
