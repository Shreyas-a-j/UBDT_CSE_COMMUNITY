-- =========================================================
-- UBDT CSE Community — USN Uniqueness & Column Fix Migration
--
-- This migration fixes the following issues:
--   1. Missing columns (designation, employee_id, etc.) in the
--      live database — all added idempotently via IF NOT EXISTS.
--   2. Case/whitespace-sensitive USN uniqueness — replaced with
--      a normalized expression index for students only.
--   3. USN mutable by non-admins — added to protect_profile_privileges.
--   4. Existing USNs not normalized — normalized in-place.
--
-- Safe to rerun. Apply AFTER: 20261013_network_and_faculty.sql
-- and 20261013_network_fixes.sql.
--
-- After applying, run:
--   NOTIFY pgrst, 'reload schema';
--
-- =========================================================

-- ---------------------------------------------------------
-- 1. Ensure all required columns exist on public.profiles
--
-- These columns were defined in the schema.sql and the base
-- migration, but if the live DB was created from an older
-- schema version, some or all may be missing. Adding them
-- here is idempotent (IF NOT EXISTS) and additive.
-- ---------------------------------------------------------

alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists section text;
alter table public.profiles add column if not exists interests text[] default '{}';
alter table public.profiles add column if not exists thumbhash text;
alter table public.profiles add column if not exists role text not null default 'student';
alter table public.profiles add column if not exists faculty_status text not null default 'none';
alter table public.profiles add column if not exists designation text;
alter table public.profiles add column if not exists employee_id text;
alter table public.profiles add column if not exists expertise text[] default '{}';
alter table public.profiles add column if not exists updated_at timestamp with time zone default timezone('utc'::text, now());

-- Make usn nullable (it may have been NOT NULL in an older schema)
do $$
begin
  alter table public.profiles alter column usn drop not null;
exception when others then null;
end $$;

-- Make year nullable (same reason)
do $$
begin
  alter table public.profiles alter column year drop not null;
exception when others then null;
end $$;

-- Ensure year check constraint exists
alter table public.profiles drop constraint if exists profiles_year_check;
alter table public.profiles add constraint profiles_year_check
  check (year is null or year between 1 and 4);

-- Ensure role check constraint exists
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('student', 'faculty', 'admin'));

-- Ensure faculty_status check constraint exists
alter table public.profiles drop constraint if exists profiles_faculty_status_check;
alter table public.profiles add constraint profiles_faculty_status_check
  check (faculty_status in ('none', 'pending', 'verified', 'rejected'));

-- ---------------------------------------------------------
-- 2. Normalize existing USNs
--
-- Upper-case and trim surrounding whitespace for all
-- non-null USNs. This is non-destructive — it only
-- changes the representation, not the data.
-- ---------------------------------------------------------

update public.profiles
set usn = upper(btrim(usn))
where usn is not null
  and usn <> upper(btrim(usn));

-- ---------------------------------------------------------
-- 3. Diagnostic: report duplicate USNs before creating index
--
-- This query identifies USN groups that have more than one
-- student profile. If duplicates exist, the unique index
-- below will not be created and a WARNING will be raised.
--
-- To find the duplicate records, run:
--   select upper(btrim(usn)) as usn, count(*) as cnt,
--     array_agg(id::text) as profile_ids
--   from public.profiles
--   where role = 'student' and usn is not null
--   group by usn
--   having count(*) > 1;
--
-- Remediation: choose one canonical profile per USN,
-- then set the others' usn to NULL or update to a
-- corrected value. Never delete profiles without
-- confirming with the affected users.
-- ---------------------------------------------------------

do $$
declare
  dup_groups int;
begin
  select count(*) into dup_groups
  from (
    select upper(btrim(usn)) as usn_norm
    from public.profiles
    where role = 'student' and usn is not null and btrim(usn) <> ''
    group by usn_norm
    having count(*) > 1
  ) d;

  if dup_groups > 0 then
    raise warning 'Found % duplicate USN group(s). Resolve duplicates before creating the unique index.', dup_groups;
    raise warning 'Diagnostic query: select upper(btrim(usn)) as usn, count(*) as cnt, array_agg(id::text) as profile_ids from public.profiles where role = ''student'' and usn is not null group by usn having count(*) > 1;';
  end if;
end $$;

-- ---------------------------------------------------------
-- 4. Create normalized USN unique index (students only)
--
-- Only enforces uniqueness for student profiles with a
-- non-null, non-empty USN. Faculty and admin profiles
-- are excluded — they don't use USNs.
--
-- The index uses upper(btrim(usn)) so that
-- '4UB24CS045', '4ub24cs045', ' 4UB24CS045 ' all
-- resolve to the same value.
--
-- The index is created inside a DO block with exception
-- handling. If duplicate USNs exist, the creation fails
-- gracefully and a warning is raised instead of aborting
-- the entire migration.
-- ---------------------------------------------------------

do $$
begin
  execute $sql$
    create unique index if not exists profiles_student_usn_unique
      on public.profiles ((upper(btrim(usn))))
      where role = 'student' and usn is not null
      and btrim(usn) <> ''
  $sql$;
  raise notice 'USN unique index created successfully.';
exception when unique_violation then
  raise warning 'Cannot create USN unique index: duplicate USNs exist among student profiles.';
  raise warning 'Run the diagnostic query to find duplicates, resolve them, then rerun this migration.';
exception when others then
  raise notice 'USN unique index may already exist or another condition prevented creation. This is non-fatal.';
end $$;

-- ---------------------------------------------------------
-- 5. Update protect_profile_privileges to also protect USN
--
-- Previously, a user could PATCH their own USN via the
-- REST API. Now only admins can change a profile's USN.
-- This protects against impersonation and USN squatting.
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

-- Trigger already exists; drop and recreate to pick up new body
drop trigger if exists trg_protect_profile_privileges on public.profiles;
create trigger trg_protect_profile_privileges
before update on public.profiles
for each row execute procedure public.protect_profile_privileges();

-- ---------------------------------------------------------
-- 6. Create handle_new_user trigger if missing
--
-- The trigger that creates a profile row when a new
-- auth user is created. If the base migration was never
-- applied, this trigger won't exist and new signups
-- won't create profile rows.
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
begin
  begin
    yr := nullif(meta->>'year', '')::int;
  exception when others then
    yr := null;
  end;
  if yr is not null and (yr < 1 or yr > 4) then
    yr := null;
  end if;

  insert into public.profiles (
    id, email, name, usn, year, branch, section, bio,
    skills, interests, role, faculty_status
  ) values (
    new.id,
    new.email,
    coalesce(nullif(meta->>'name', ''), split_part(new.email, '@', 1), 'Member'),
    nullif(upper(btrim(meta->>'usn')), ''),
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
    case when meta->>'intent' = 'faculty' then 'pending' else 'none' end
  )
  on conflict (id) do update set
    email = excluded.email,
    name = coalesce(nullif(public.profiles.name, ''), excluded.name);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- ---------------------------------------------------------
-- 7. Ensure update_updated_at_column trigger exists
-- ---------------------------------------------------------

create or replace function public.update_updated_at_column()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := timezone('utc'::text, now());
  return new;
end;
$$;

drop trigger if exists trg_update_profiles_updated_at on public.profiles;
create trigger trg_update_profiles_updated_at
before update on public.profiles
for each row execute procedure public.update_updated_at_column();

-- ---------------------------------------------------------
-- 8. Ensure RLS is enabled on profiles
-- ---------------------------------------------------------

alter table public.profiles enable row level security;

-- Ensure the public select policy exists
drop policy if exists "Public profiles are viewable by everyone" on public.profiles;
create policy "Public profiles are viewable by everyone" on public.profiles
  for select using (true);

-- Ensure the insert policy exists
drop policy if exists "Users can insert own profile" on public.profiles;
create policy "Users can insert own profile" on public.profiles
  for insert with check (
    auth.uid() = id
    and role = 'student'
    and faculty_status in ('none', 'pending')
  );

-- Ensure the update policy exists
drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- ---------------------------------------------------------
-- 9. Reload the PostgREST schema cache
--
-- This is critical. Without it, PostgREST won't know about
-- any new columns, and queries referencing those columns
-- will fail with "Could not find the column in the schema cache".
-- ---------------------------------------------------------

notify pgrst, 'reload schema';
