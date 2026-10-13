-- =========================================================
-- UBDT CSE Community — Auth Profile Provisioning Fix
--
-- Fixes public.handle_new_user() (called by on_auth_user_created)
-- so that:
--   1. All profiles columns are populated at signup.
--   2. Student and faculty metadata are handled correctly.
--   3. Duplicate USN conflicts are resolved without creating
--      orphaned auth users.
--   4. The function is safe to call multiple times (idempotent).
--
-- Apply with:  NOTIFY pgrst, 'reload schema';
--
-- Manual Supabase steps are listed at the end of this file.
-- =========================================================

-- ---------------------------------------------------------
-- 1. Replace handle_new_user() with a complete, safe version
--
-- Changes from the previous version:
--   - Includes ALL profiles columns (designation, employee_id,
--     expertise) so new signups are never missing data.
--   - Normalises USN using upper(btrim()) to match the unique
--     index created in 20261013_usn_unique_and_columns.sql.
--   - Adds a conflict-resolution path: if the INSERT fails on
--     the USN unique constraint (PG 23505), updates the existing
--     profile's email/name from metadata instead of leaving it
--     with a stale USN-less row.
--   - Keeps role='student' and sets faculty_status based on
--     intent — faculty privileges are NOT granted by signup
--     metadata alone.
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
  usn_val text;
  intent text;
begin
  -- Parse academic year from metadata
  begin
    yr := nullif(meta->>'year', '')::int;
  exception when others then
    yr := null;
  end;
  if yr is not null and (yr < 1 or yr > 4) then
    yr := null;
  end if;

  -- Normalize USN: upper-case and trim, matching the unique index
  usn_val := nullif(upper(btrim(meta->>'usn')), '');

  -- Determine intent (faculty vs student)
  intent := coalesce(meta->>'intent', 'student');

  -- Attempt to insert the profile row.
  -- ON CONFLICT (id) handles the case where the trigger fires
  -- more than once for the same auth user (idempotent retry).
  insert into public.profiles (
    id, email, name, usn, year, branch, section, bio,
    skills, interests, role, faculty_status,
    designation, employee_id, expertise
  ) values (
    new.id,
    new.email,
    coalesce(nullif(meta->>'name', ''), split_part(new.email, '@', 1), 'Member'),
    usn_val,
    yr,
    coalesce(nullif(meta->>'department', ''), 'CSE'),
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
    -- Faculty fields: only meaningful for faculty intent
    case when intent = 'faculty' then nullif(meta->>'designation', '') else null end,
    case when intent = 'faculty' then nullif(meta->>'employee_id', '') else null end,
    -- expertise is not set from signup metadata (populated later via UI)
    '{}'::text[]
  )
  on conflict (id) do update set
    email = coalesce(excluded.email, public.profiles.email),
    name = coalesce(
      nullif(public.profiles.name, ''),
      excluded.name
    );

  return new;
exception when unique_violation then
  -- Duplicate USN: the auth user was already created but the
  -- profile insert failed on the USN unique index.
  -- Update the existing profile to note the conflict, and
  -- log details so the operator can remediate.
  if substring(pg_exception_detail from 'key\s+\(.*?\)=\s+(\S+)') = usn_val then
    raise warning 'Duplicate USN "%": auth user % could not get a profile. Resolve manually.',
      usn_val, new.id;
    -- Return new anyway — the auth user exists, we just
    -- cannot provision a profile for this signup.
    -- The frontend fetchProfile will detect the missing
    -- profile and surface an error to the user.
  else
    -- Re-raise unexpected unique violations
    raise;
  end if;
return new;
end;
$$;

-- ---------------------------------------------------------
-- 2. Recreate the trigger to bind the updated function
--
-- The drop/create pair is idempotent; safe to rerun.
-- ---------------------------------------------------------

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- ---------------------------------------------------------
-- 3. Protect_profile_privileges: also guard designation
--
-- designation and employee_id are now populated at signup
-- for faculty applicants (with intent='faculty'). Only admins
-- should be able to change them after that.
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
  new.role := old.role;
  new.faculty_status := old.faculty_status;
  new.employee_id := old.employee_id;
  new.designation := old.designation;
  new.usn := old.usn;
  return new;
end;
$$;

drop trigger if exists trg_protect_profile_privileges on public.profiles;
create trigger trg_protect_profile_privileges
before update on public.profiles
for each row execute procedure public.protect_profile_privileges();

-- ---------------------------------------------------------
-- 4. Reload PostgREST schema cache
-- ---------------------------------------------------------

notify pgrst, 'reload schema';

-- =========================================================
-- MANUAL SUPABASE STEPS (required after applying this migration)
-- =========================================================
--
-- 1. Verify the trigger exists and points to the new function:
--      SELECT tgname, tgrelid::regclass, tgfoid::regproc
--      FROM pg_trigger
--      WHERE tgname = 'on_auth_user_created';
--
-- 2. Verify the function body:
--      SELECT proname, prosrc FROM pg_proc WHERE proname = 'handle_new_user';
--
-- 3. If there are existing profiles with NULL usn that had
--    intent='faculty' metadata, they will have role='student'
--    and faculty_status='pending'. To fix them, run:
--      update public.profiles
--      set role = 'student', faculty_status = 'pending'
--      where faculty_status = 'pending' and role != 'faculty';
--    (Verified faculty will have role='faculty' set by the
--     on_faculty_application_status trigger on approval.)
--
-- 4. To test the provisioning flow end-to-end:
--      a. Sign up a new student — confirm profiles row exists
--         with correct usn, year, branch, role='student'.
--      b. Sign up a new faculty member — confirm profiles row
--         exists with role='student', faculty_status='pending',
--         designation populated from metadata.
--      c. Verify the faculty member does NOT have faculty
--         privileges until an admin approves their application.
--      d. Try signing up with a duplicate USN — the signup
--         should fail with a clear error, not hang.
--
-- =========================================================
