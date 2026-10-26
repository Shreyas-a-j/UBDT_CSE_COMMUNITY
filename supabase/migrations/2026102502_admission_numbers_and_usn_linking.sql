-- =========================================================
-- UCC 2.0 — first-year admission numbers + one-time USN linking
-- Date: 2026-10-25
-- Migration: 2026102502_admission_numbers_and_usn_linking.sql
--
-- REVIEW BEFORE APPLYING. This migration is additive and deliberately does
-- not touch existing profiles, events, announcements or roles. It must be
-- applied before the updated web/mobile clients are deployed: until then a
-- first-year signup without a USN fails at the signup trigger.
--
-- What this adds
-- --------------
--   1. public.student_admission_numbers: a private, owner/admin-readable
--      admission number for first-year students who do not have a USN yet.
--      It is deliberately not a profiles column because profiles has a public
--      SELECT policy and is commonly read with select('*').
--   2. handle_new_user() validation: first-year students may register with an
--      admission number instead of a USN; years 2-4 still require a USN and
--      reject an admission number supplied through the Auth API. Duplicate
--      admission numbers and USNs roll the auth.users INSERT back.
--   3. link_student_usn(p_usn): a one-time, authenticated, null -> value USN
--      link for students. It never changes year or any other identity field.
--   4. A narrow protect_profile_privileges() exception for that RPC only.
--      Direct client updates to profiles.usn remain reverted.
-- =========================================================

begin;

-- ---------------------------------------------------------
-- 1. Private admission-number table.
-- ---------------------------------------------------------
create table if not exists public.student_admission_numbers (
  profile_id uuid primary key
    references public.profiles(id) on delete cascade,
  admission_number text not null,
  created_at timestamptz not null default timezone('utc'::text, now()),
  constraint student_admission_numbers_format
    check (admission_number ~ '^[A-Z0-9][A-Z0-9/-]{2,22}[A-Z0-9]$')
);

create unique index if not exists student_admission_numbers_admission_number_key
  on public.student_admission_numbers (upper(btrim(admission_number)));

alter table public.student_admission_numbers enable row level security;

drop policy if exists "Owners and admins read admission numbers"
  on public.student_admission_numbers;
create policy "Owners and admins read admission numbers"
  on public.student_admission_numbers
  for select
  using (auth.uid() = profile_id or public.is_admin(auth.uid()));

revoke all on table public.student_admission_numbers from anon, authenticated;
grant select on table public.student_admission_numbers to authenticated;

comment on table public.student_admission_numbers is
  'Private first-year admission numbers. Readable by the owner and admins; written only by the signup trigger.';

-- ---------------------------------------------------------
-- 2. One-time USN linking RPC.
-- ---------------------------------------------------------
create or replace function public.link_student_usn(p_usn text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_usn text;
  v_profile public.profiles%rowtype;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'Sign in required.';
  end if;

  v_usn := upper(btrim(coalesce(p_usn, '')));
  if v_usn !~ '^4UB[0-9]{2}CS[0-9]{1,3}$' then
    raise exception using
      errcode = '22023',
      message = 'Enter a valid USN. Expected format: 4UB24CS045';
  end if;

  select * into v_profile
  from public.profiles
  where id = v_actor
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Profile not found.';
  end if;
  if v_profile.member_type is distinct from 'student' then
    raise exception using
      errcode = '42501',
      message = 'Only students can link a USN.';
  end if;
  if v_profile.usn is not null then
    raise exception using
      errcode = '22023',
      message = 'A USN is already linked to this account.';
  end if;

  perform set_config('ucc.usn_link', 'on', true);
  begin
    update public.profiles
    set usn = v_usn,
        updated_at = timezone('utc'::text, now())
    where id = v_actor;
  exception when unique_violation then
    perform set_config('ucc.usn_link', '', true);
    raise exception using
      errcode = '23505',
      message = 'This USN is already registered. Sign in or contact the administrator.';
  end;
  perform set_config('ucc.usn_link', '', true);
end;
$$;

revoke all on function public.link_student_usn(text) from public;
revoke all on function public.link_student_usn(text) from anon;
grant execute on function public.link_student_usn(text) to authenticated;

comment on function public.link_student_usn(text) is
  'Links a USN once for a student whose profile has no USN. Does not change year or any other identity field.';

-- ---------------------------------------------------------
-- 3. Signup provisioning with admission-number support.
--
-- This is the canonical body from 2026102212 with two additions: admission
-- validation/insertion and the student-intent identifier rules.
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
  admission_val text;
  intent text;
  member_kind text;
  full_name_val text;
  department_val text;
  designation_val text;
  employee_id_val text;
  v_constraint text;
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
  admission_val := nullif(upper(btrim(meta->>'admission_number')), '');
  if admission_val is not null
     and admission_val !~ '^[A-Z0-9][A-Z0-9/-]{2,22}[A-Z0-9]$' then
    raise exception using
      errcode = '23514',
      message = 'Enter a valid admission number.',
      detail = 'Use 4-24 letters, digits, hyphens or slashes.';
  end if;

  intent := lower(btrim(coalesce(meta->>'intent', 'student')));
  -- Single source of truth for member_type. verify_schema.sql asserts this
  -- assignment appears exactly once and is consumed by the insert below.
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

  -- A missing year keeps the legacy signup behavior: many existing fixtures
  -- and older clients create a student row without one. Years 1-4 are still
  -- validated, and an admission number is always first-year-only.
  if intent = 'student' then
    -- Admission numbers are first-year signup data only. Reject a direct Auth
    -- API call that supplies one for years 2-4 (or for a null year), even when
    -- a valid USN is also present.
    if admission_val is not null and yr is distinct from 1 then
      raise exception using
        errcode = '23514',
        message = 'Admission numbers are only accepted for first-year students.',
        detail = 'Signup was rolled back; no auth user or profile was created.';
    end if;

    if yr = 1 then
      if usn_val is null and admission_val is null then
        raise exception using
          errcode = '23514',
          message = 'First-year students need either a USN or an admission number.';
      end if;
    elsif yr is not null and usn_val is null then
      raise exception using
        errcode = '23514',
        message = 'A USN is required for students in years 2-4.';
    end if;
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

  if intent = 'student' and yr = 1 and admission_val is not null then
    insert into public.student_admission_numbers (profile_id, admission_number)
    values (new.id, admission_val)
    on conflict (profile_id) do nothing;
  end if;

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
  get stacked diagnostics v_constraint = constraint_name;
  if v_constraint = 'student_admission_numbers_admission_number_key' then
    raise exception using
      errcode = '23505',
      message = 'This admission number is already registered. Sign in or contact the department.',
      detail = 'Signup was rolled back; no auth user or profile was created.';
  end if;
  -- Abort the surrounding auth.users INSERT. The full USN is not echoed.
  raise exception using
    errcode = '23505',
    message = 'USN is already registered to another account.',
    detail = 'Signup was rolled back; no auth user or profile was created.',
    hint = 'Sign in with the existing account or ask an administrator to review the USN collision.';
end;
$$;

comment on function public.handle_new_user() is
  'Provisions a non-privileged profile and, for faculty intent, a pending faculty application atomically. First-year students may use an admission number instead of a USN. Duplicate normalized USN/admission numbers abort the signup.';

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ---------------------------------------------------------
-- 4. Narrow one-time USN-link exception.
--
-- The canonical body is copied from 2026102208. The new branch permits only
-- null -> non-null USN for a student, and only while the SECURITY DEFINER RPC
-- above has set the transaction-local GUC. Every other protected field is
-- restored. Direct client updates remain reverted.
-- ---------------------------------------------------------
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

  if coalesce(current_setting('ucc.usn_link', true), '') = 'on'
     and old.member_type = 'student'
     and old.usn is null
     and new.usn is not null then
    new.role := old.role;
    new.faculty_status := old.faculty_status;
    new.employee_id := old.employee_id;
    new.designation := old.designation;
    new.member_type := old.member_type;
    new.graduation_year := old.graduation_year;
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

comment on function public.protect_profile_privileges() is
  'Protects authorisation and identity fields from client writes, with narrow exceptions for the succession RPCs and one-time link_student_usn.';

commit;

notify pgrst, 'reload schema';
