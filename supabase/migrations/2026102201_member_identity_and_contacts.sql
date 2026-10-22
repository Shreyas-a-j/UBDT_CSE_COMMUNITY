-- =========================================================
-- UCC 2.0 — Phase 1A: member identity, public links, contacts
-- Date: 2026-10-22
--
-- Forward-only and additive. Safe to re-run.
--
-- Why this migration exists
-- -------------------------
-- The legacy model overloaded public.profiles.role with two different
-- concepts: community identity ("student") and authorisation capability
-- ("faculty", "admin"). Alumni cannot be represented without either
-- granting them a privileged role or losing the distinction.
--
-- This migration keeps role/faculty_status as the authorisation model
-- (unchanged, so every existing RLS policy and privilege check keeps
-- working) and adds member_type as the community identity:
--
--   member_type = 'student' | 'alumni' | 'faculty'
--
-- Alumni therefore remain role = 'student' (or whatever their existing
-- role is), receive no faculty permissions, and are distinguishable for
-- profiles, directory filters, and reporting.
--
-- Public links (portfolio/GitHub/LinkedIn) are intentionally stored on
-- profiles because they are public. Contact details are NOT stored on
-- profiles: profiles has a public SELECT policy, so a column-level
-- "contact_visibility = private" would still be readable by anon. They
-- live in public.profile_contacts, which has its own RLS.
--
-- Objects created/replaced:
--   - public.profiles columns: member_type, graduation_year,
--     portfolio_url, github_url, linkedin_url
--   - public.profile_contacts (new table, RLS)
--   - public.protect_profile_privileges() (replaced; adds member_type,
--     graduation_year; keeps role/faculty_status/employee_id/
--     designation/usn protection exactly as before)
--   - public.handle_new_user() (replaced; recognises intent = 'alumni'
--     but never grants a privileged role from signup metadata)
--   - public.on_faculty_application_status() (replaced; approved faculty
--     also get member_type = 'faculty')
--
-- Apply transactionally (Supabase CLI does this by default):
--   supabase db push
-- or paste into the Supabase SQL Editor.
-- Then run:  NOTIFY pgrst, 'reload schema';
-- =========================================================

-- ---------------------------------------------------------
-- 1. Profile identity and public link columns
-- ---------------------------------------------------------

alter table public.profiles add column if not exists member_type text;
alter table public.profiles add column if not exists graduation_year int;
alter table public.profiles add column if not exists portfolio_url text;
alter table public.profiles add column if not exists github_url text;
alter table public.profiles add column if not exists linkedin_url text;

-- ---------------------------------------------------------
-- 2. Backfill member_type from the legacy role model
--
-- The privilege-protection trigger would revert this UPDATE for a
-- non-admin session (and the SQL editor has no auth.uid()), so it is
-- disabled for the backfill and immediately re-enabled. Keep migrations
-- transactional so a failure cannot leave it disabled.
-- ---------------------------------------------------------

do $$
begin
  if exists (
    select 1
    from pg_trigger
    where tgname = 'trg_protect_profile_privileges'
      and tgrelid = 'public.profiles'::regclass
      and not tgisinternal
  ) then
    alter table public.profiles disable trigger trg_protect_profile_privileges;
  end if;
end $$;

update public.profiles
set member_type = case
  when role in ('faculty', 'admin') then 'faculty'
  else 'student'
end
where member_type is null;

do $$
begin
  if exists (
    select 1
    from pg_trigger
    where tgname = 'trg_protect_profile_privileges'
      and tgrelid = 'public.profiles'::regclass
      and not tgisinternal
  ) then
    alter table public.profiles enable trigger trg_protect_profile_privileges;
  end if;
end $$;

alter table public.profiles alter column member_type set default 'student';
alter table public.profiles alter column member_type set not null;

-- ---------------------------------------------------------
-- 3. Constraints
--
-- Legacy accounts may legitimately have no graduation year. New URL
-- fields are nullable; only the scheme/host/length is enforced so that
-- real-world profile URLs are not rejected.
-- ---------------------------------------------------------

alter table public.profiles drop constraint if exists profiles_member_type_check;
alter table public.profiles add constraint profiles_member_type_check
  check (member_type in ('student', 'alumni', 'faculty'));

alter table public.profiles drop constraint if exists profiles_graduation_year_check;
alter table public.profiles add constraint profiles_graduation_year_check
  check (graduation_year is null or graduation_year between 1950 and 2200);

alter table public.profiles drop constraint if exists profiles_portfolio_url_check;
alter table public.profiles add constraint profiles_portfolio_url_check
  check (
    portfolio_url is null
    or (portfolio_url ~* '^https?://[^[:space:]]+$' and char_length(portfolio_url) <= 500)
  );

alter table public.profiles drop constraint if exists profiles_github_url_check;
alter table public.profiles add constraint profiles_github_url_check
  check (
    github_url is null
    or (
      github_url ~* '^https?://(www\.)?github\.com/[^[:space:]]+$'
      and char_length(github_url) <= 300
    )
  );

alter table public.profiles drop constraint if exists profiles_linkedin_url_check;
alter table public.profiles add constraint profiles_linkedin_url_check
  check (
    linkedin_url is null
    or (
      linkedin_url ~* '^https?://(www\.)?linkedin\.com/[^[:space:]]+$'
      and char_length(linkedin_url) <= 300
    )
  );

create index if not exists profiles_member_type_idx
  on public.profiles (member_type);

create index if not exists profiles_alumni_graduation_idx
  on public.profiles (graduation_year)
  where member_type = 'alumni';

-- ---------------------------------------------------------
-- 4. Private contact details
--
-- One row per profile, created lazily. contact_visibility is the single
-- switch for both fields and defaults to the safest value:
--   private  -> owner and admins only
--   members  -> any authenticated member
--   public   -> anyone, including anon
--
-- There is deliberately no copy of auth.users.email here; contact_email
-- is a separate, user-supplied value.
-- ---------------------------------------------------------

create table if not exists public.profile_contacts (
  profile_id uuid references public.profiles(id) on delete cascade primary key,
  contact_email text,
  phone text,
  contact_visibility text not null default 'private',
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

alter table public.profile_contacts drop constraint if exists profile_contacts_contact_visibility_check;
alter table public.profile_contacts add constraint profile_contacts_contact_visibility_check
  check (contact_visibility in ('private', 'members', 'public'));

alter table public.profile_contacts drop constraint if exists profile_contacts_email_format_check;
alter table public.profile_contacts add constraint profile_contacts_email_format_check
  check (
    contact_email is null
    or (
      contact_email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
      and char_length(contact_email) <= 320
    )
  );

alter table public.profile_contacts drop constraint if exists profile_contacts_phone_format_check;
alter table public.profile_contacts add constraint profile_contacts_phone_format_check
  check (
    phone is null
    or (phone ~ '^\+?[0-9][0-9 ()\-]{6,19}$')
  );

drop trigger if exists trg_profile_contacts_updated_at on public.profile_contacts;
create trigger trg_profile_contacts_updated_at
before update on public.profile_contacts
for each row execute procedure public.update_updated_at_column();

alter table public.profile_contacts enable row level security;

drop policy if exists "Owners manage their contact details" on public.profile_contacts;
drop policy if exists "Admins view all contact details" on public.profile_contacts;
drop policy if exists "Public contact details are visible" on public.profile_contacts;
drop policy if exists "Member contact details are visible to authenticated members" on public.profile_contacts;

create policy "Owners manage their contact details" on public.profile_contacts
  for all
  using (auth.uid() = profile_id)
  with check (auth.uid() = profile_id);

create policy "Admins view all contact details" on public.profile_contacts
  for select
  using (public.is_admin(auth.uid()));

create policy "Public contact details are visible" on public.profile_contacts
  for select
  using (contact_visibility = 'public');

create policy "Member contact details are visible to authenticated members" on public.profile_contacts
  for select
  using (contact_visibility = 'members' and auth.uid() is not null);

-- ---------------------------------------------------------
-- 5. Privilege protection — preserve existing fields and add identity
--
-- Existing protected fields are unchanged. member_type and
-- graduation_year are admin/trigger-managed so a member cannot claim
-- alumni/faculty identity by PATCHing their own profile.
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
  new.member_type := old.member_type;
  new.graduation_year := old.graduation_year;
  return new;
end;
$$;

drop trigger if exists trg_protect_profile_privileges on public.profiles;
create trigger trg_protect_profile_privileges
before update on public.profiles
for each row execute procedure public.protect_profile_privileges();

-- ---------------------------------------------------------
-- 6. Signup provisioning — recognise alumni intent safely
--
-- role stays 'student' and faculty_status stays 'none' for alumni.
-- Only the explicit faculty-intent path sets faculty_status='pending',
-- and nothing in metadata can grant role='faculty' or 'admin'.
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
  intent := lower(coalesce(meta->>'intent', 'student'));
  member_kind := case when intent = 'alumni' then 'alumni' else 'student' end;

  insert into public.profiles (
    id, email, name, usn, year, branch, section, bio,
    skills, interests, role, faculty_status,
    designation, employee_id, expertise,
    member_type, graduation_year
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
    case when intent = 'faculty' then nullif(meta->>'designation', '') else null end,
    case when intent = 'faculty' then nullif(meta->>'employee_id', '') else null end,
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

  return new;
exception when unique_violation then
  -- Duplicate USN (or another unique key). Do not echo the USN into the
  -- server log. The auth user may exist without a profile; the app
  -- surfaces that state and an operator resolves it with the diagnostic
  -- in supabase/diagnostics/usn_collisions.sql.
  if substring(pg_exception_detail from '(?i)key\s+\(.*?\)=\s+(\S+)') = usn_val then
    raise warning 'Duplicate USN for auth user %; profile was not provisioned. Resolve manually.', new.id;
  else
    raise;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- ---------------------------------------------------------
-- 7. Faculty approval sets the faculty identity as well
--
-- Authorisation behaviour is unchanged: role becomes 'faculty' (admin is
-- preserved) and faculty_status becomes 'verified'. Only member_type is
-- added to the same UPDATE.
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
      faculty_status = 'verified',
      member_type = 'faculty',
      designation = new.designation,
      employee_id = new.employee_id,
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
      coalesce(new.notes, 'Your faculty application was not approved.'),
      '/signup/faculty'
    );
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------
-- 8. Reload PostgREST schema cache
-- ---------------------------------------------------------

notify pgrst, 'reload schema';
