-- =========================================================
-- UBDT CSE Community — complete schema for new installs
--
-- For existing databases, apply every file in supabase/migrations/ in
-- filename (date) order, then run:  NOTIFY pgrst, 'reload schema';
-- UCC 2.0 Phase 1 additions are:
--   2026102201_member_identity_and_contacts.sql
--   2026102202_notification_targeting_and_visits.sql
--   2026102203_global_usn_uniqueness.sql
--   2026102204_duplicate_usn_signup_guard.sql
--   2026102205_announcement_images_and_reactions.sql
--   2026102206_faculty_approval_status_alignment.sql
--   2026102207_secure_faculty_onboarding.sql
--
-- This file is the canonical reference for new installations.
-- =========================================================

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- =========================================================
-- 1. Profiles (canonical table)
-- =========================================================
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  usn text unique,
  name text not null default 'Member',
  year int,
  branch text default 'CSE' not null,
  bio text,
  avatar_url text,
  skills text[] default '{}',
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  -- Extended columns (added by migration, always present for new installs)
  email text,
  section text,
  interests text[] default '{}',
  thumbhash text,
  role text not null default 'student',
  faculty_status text not null default 'none',
  designation text,
  employee_id text,
  expertise text[] default '{}',
  updated_at timestamp with time zone default timezone('utc'::text, now()),
  -- UCC 2.0: community identity is separate from authorisation.
  -- role/faculty_status remain the privilege model; member_type describes
  -- whether the person is a student, alumnus, or faculty member.
  member_type text not null default 'student',
  graduation_year int,
  portfolio_url text,
  github_url text,
  linkedin_url text
);

-- Constraints (safe to add/drop if they exist)
do $$
begin
  alter table public.profiles alter column usn drop not null;
exception when others then null;
end $$;

do $$
begin
  alter table public.profiles alter column year drop not null;
exception when others then null;
end $$;

alter table public.profiles drop constraint if exists profiles_year_check;
alter table public.profiles add constraint profiles_year_check
  check (year is null or year between 1 and 4);

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('student', 'faculty', 'admin'));

alter table public.profiles drop constraint if exists profiles_faculty_status_check;
alter table public.profiles add constraint profiles_faculty_status_check
  check (faculty_status in ('none', 'pending', 'approved', 'verified', 'rejected'));

-- UCC 2.0 identity and public-link constraints
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

-- Legacy user_profiles sync: not included here because schema.sql is for
-- new installs, where user_profiles never exists. Existing databases with
-- a legacy user_profiles table must apply
-- migrations/2026101302_network_fixes.sql, which performs a fully dynamic
-- column-mapped sync (PostgreSQL resolves column refs at parse time, so
-- only existing columns can be referenced).

create index if not exists profiles_lower_name_idx on public.profiles (lower(name));
create index if not exists profiles_usn_idx on public.profiles (usn);
create index if not exists profiles_year_idx on public.profiles (year);
create index if not exists profiles_role_idx on public.profiles (role);
create index if not exists profiles_branch_idx on public.profiles (branch);
create index if not exists profiles_skills_gin on public.profiles using gin (skills);
create index if not exists profiles_interests_gin on public.profiles using gin (interests);
create index if not exists profiles_member_type_idx on public.profiles (member_type);
create index if not exists profiles_alumni_graduation_idx
  on public.profiles (graduation_year) where member_type = 'alumni';

-- UCC 2.0 invariant: one normalized USN per account, across every member
-- type. Alumni remain covered after their identity changes.
create unique index if not exists profiles_usn_normalized_unique
  on public.profiles ((upper(btrim(usn))))
  where usn is not null and btrim(usn) <> '';

comment on index public.profiles_usn_normalized_unique is
  'UCC 2.0 invariant: upper(btrim(usn)) is unique across all profiles with a non-empty USN, including alumni.';

-- =========================================================
-- 1b. Profile contacts (private by default)
--
-- Kept out of public.profiles because that table has a public SELECT
-- policy; a "private" contact value on profiles would still be readable.
-- =========================================================
create table if not exists public.profile_contacts (
  profile_id uuid references public.profiles(id) on delete cascade primary key,
  contact_email text,
  phone text,
  contact_visibility text not null default 'private',
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  constraint profile_contacts_contact_visibility_check
    check (contact_visibility in ('private', 'members', 'public')),
  constraint profile_contacts_email_format_check
    check (
      contact_email is null
      or (
        contact_email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
        and char_length(contact_email) <= 320
      )
    ),
  constraint profile_contacts_phone_format_check
    check (
      phone is null
      or (phone ~ '^\+?[0-9][0-9 ()\-]{6,19}$')
    )
);

-- =========================================================
-- 2. Events
-- =========================================================
create table if not exists public.events (
  id uuid default uuid_generate_v4() primary key,
  host_id uuid references public.profiles(id) on delete cascade not null,
  title text not null,
  description text not null,
  type text not null check (type in ('Workshop', 'Meeting', 'Showcase', 'Seminar', 'Project Session')),
  event_date date not null,
  event_time time not null,
  duration int not null default 60,
  link text,
  target_years int[] default '{1, 2, 3, 4}' not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- =========================================================
-- 3. Event RSVPs
-- =========================================================
create table if not exists public.event_rsvps (
  id uuid default uuid_generate_v4() primary key,
  event_id uuid references public.events(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete cascade not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  unique(event_id, user_id)
);

-- =========================================================
-- 4. Posts
-- =========================================================
create table if not exists public.posts (
  id uuid default uuid_generate_v4() primary key,
  author_id uuid references public.profiles(id) on delete cascade not null,
  type text not null check (type in ('discussion', 'showcase')),
  title text not null,
  body text not null,
  image_url text,
  github_url text,
  demo_url text,
  tech_stack text[] default '{}',
  tags text[] default '{}',
  target_years int[] default '{1, 2, 3, 4}' not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- =========================================================
-- 5. Comments
-- =========================================================
create table if not exists public.comments (
  id uuid default uuid_generate_v4() primary key,
  post_id uuid references public.posts(id) on delete cascade not null,
  author_id uuid references public.profiles(id) on delete cascade not null,
  body text not null,
  parent_id uuid references public.comments(id) on delete cascade,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- =========================================================
-- 6. Likes
-- =========================================================
create table if not exists public.likes (
  id uuid default uuid_generate_v4() primary key,
  post_id uuid references public.posts(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete cascade not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  unique(post_id, user_id)
);

-- =========================================================
-- 7. Upvotes
-- =========================================================
create table if not exists public.upvotes (
  id uuid default uuid_generate_v4() primary key,
  post_id uuid references public.posts(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete cascade not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  unique(post_id, user_id)
);

-- =========================================================
-- 8. Notifications
-- =========================================================
create table if not exists public.notifications (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  type text not null check (type in (
    'comment', 'rsvp', 'event_reminder', 'like', 'upvote',
    'connection_request', 'connection_accepted', 'message',
    'announcement', 'faculty_decision'
  )),
  title text not null,
  body text,
  link text,
  read boolean default false not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  -- UCC 2.0 targeting: discussions/showcases use posts.id, events use
  -- events.id. content_type disambiguates the polymorphic identifier.
  content_type text,
  content_id uuid,
  dedupe_key text,
  constraint notifications_content_pair_check check (
    (content_type is null and content_id is null)
    or (content_type is not null and content_id is not null)
  ),
  constraint notifications_content_type_check
    check (content_type is null or content_type in ('discussion', 'event', 'showcase')),
  constraint notifications_dedupe_key_check
    check (dedupe_key is null or char_length(dedupe_key) between 1 and 200)
);

create index if not exists notifications_user_created_idx on public.notifications (user_id, created_at desc);
create index if not exists notifications_content_idx
  on public.notifications (content_type, content_id)
  where content_id is not null;

-- Deterministic fan-out keys make generated notifications idempotent.
create unique index if not exists notifications_user_dedupe_key_unique
  on public.notifications (user_id, dedupe_key)
  where dedupe_key is not null;

-- =========================================================
-- 8b. Content visits
--
-- One row per (user, content_type, content_id); repeat visits update
-- last_visited_at instead of appending rows. content_id is polymorphic
-- (posts.id for discussion/showcase, events.id for events), so there is
-- no single FK target.
-- =========================================================
create table if not exists public.content_visits (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  content_type text not null,
  content_id uuid not null,
  first_visited_at timestamptz not null default timezone('utc'::text, now()),
  last_visited_at timestamptz not null default timezone('utc'::text, now()),
  constraint content_visits_content_type_check
    check (content_type in ('discussion', 'event', 'showcase')),
  constraint content_visits_time_order_check
    check (last_visited_at >= first_visited_at),
  constraint content_visits_user_content_key
    unique (user_id, content_type, content_id)
);

create index if not exists content_visits_user_recent_idx
  on public.content_visits (user_id, last_visited_at desc);
create index if not exists content_visits_content_idx
  on public.content_visits (content_type, content_id);

-- =========================================================
-- 9. Faculty Applications
-- =========================================================
create table if not exists public.faculty_applications (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  full_name text not null,
  official_email text not null,
  department text not null default 'CSE',
  designation text not null,
  employee_id text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamp with time zone,
  notes text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone
);

-- Only one pending application per user
create unique index if not exists faculty_applications_one_pending
  on public.faculty_applications (user_id)
  where status = 'pending';

-- =========================================================
-- 10. Connection Requests
-- =========================================================
create table if not exists public.connection_requests (
  id uuid default uuid_generate_v4() primary key,
  requester_id uuid references public.profiles(id) on delete cascade not null,
  addressee_id uuid references public.profiles(id) on delete cascade not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'cancelled')),
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  responded_at timestamp with time zone,
  constraint connection_no_self check (requester_id <> addressee_id)
  -- Note: connection_pair unique constraint removed; replaced by
  -- partial unique index on pending status (see below).
  -- This allows re-sending requests after rejection/cancellation.
);

-- Only one pending request per (requester, addressee) pair
create unique index if not exists connection_pending_pair
  on public.connection_requests (requester_id, addressee_id)
  where status = 'pending';

-- Only one active (pending or accepted) pair regardless of direction
create unique index if not exists connection_active_pair
  on public.connection_requests (
    least(requester_id, addressee_id),
    greatest(requester_id, addressee_id)
  )
  where status in ('pending', 'accepted');

create index if not exists connection_addressee_status_idx
  on public.connection_requests (addressee_id, status);
create index if not exists connection_requester_status_idx
  on public.connection_requests (requester_id, status);

-- =========================================================
-- 11. Conversations + Messages
-- =========================================================
create table if not exists public.conversations (
  id uuid default uuid_generate_v4() primary key,
  is_group boolean not null default false,
  title text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  last_message_at timestamp with time zone,
  last_message_preview text
);

create table if not exists public.conversation_participants (
  conversation_id uuid references public.conversations(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete cascade not null,
  last_read_at timestamp with time zone default to_timestamp(0),
  joined_at timestamp with time zone default timezone('utc'::text, now()) not null,
  primary key (conversation_id, user_id)
);

-- Direct (1:1) conversation pair index: one pair of users => at most one conversation
create table if not exists public.direct_conversation_pairs (
  lesser_user uuid not null references public.profiles(id) on delete cascade,
  greater_user uuid not null references public.profiles(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  primary key (lesser_user, greater_user)
);

create index if not exists direct_conversation_pairs_conv_idx
  on public.direct_conversation_pairs (conversation_id);

create table if not exists public.messages (
  id uuid default uuid_generate_v4() primary key,
  conversation_id uuid references public.conversations(id) on delete cascade not null,
  sender_id uuid references public.profiles(id) on delete cascade not null,
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create index if not exists messages_conversation_created_idx
  on public.messages (conversation_id, created_at desc);
create index if not exists conversation_participants_user_idx
  on public.conversation_participants (user_id);

-- =========================================================
-- 12. Announcements
-- =========================================================
create table if not exists public.announcements (
  id uuid default uuid_generate_v4() primary key,
  author_id uuid references public.profiles(id) on delete cascade not null,
  title text not null,
  body text not null,
  image_urls text[] not null default '{}',
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.announcements
  drop constraint if exists announcements_image_urls_check;
alter table public.announcements
  add constraint announcements_image_urls_check
  check (
    array_length(image_urls, 1) is null
    or array_length(image_urls, 1) between 1 and 4
  );

create index if not exists announcements_created_idx on public.announcements (created_at desc);

create table if not exists public.announcement_reactions (
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  reaction text not null check (reaction in ('thumbs_up', 'heart', 'party', 'clap')),
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  primary key (announcement_id, user_id, reaction)
);

create index if not exists announcement_reactions_announcement_idx
  on public.announcement_reactions (announcement_id);

-- =========================================================
-- 13. Security Functions
-- =========================================================
create or replace function public.is_admin(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = uid and p.role = 'admin'
  );
$$;

create or replace function public.is_verified_faculty(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = uid
      and p.role in ('faculty', 'admin')
      and (p.role = 'admin' or p.faculty_status in ('approved', 'verified'))
  );
$$;

-- Returns only a boolean derived from auth.users.email_confirmed_at. Authorised
-- for self, administrators, and already-approved faculty (the public directory
-- case). Unauthorised ids are omitted; no email address or Auth metadata leaves
-- the function.
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

-- Default function privileges grant EXECUTE to PUBLIC. Remove that and rely on
-- the explicit anon/authenticated grant in section 15.
revoke all on function public.get_email_verification_status(uuid[]) from public;

-- Owner-only maintenance function: creates one pending application for each
-- orphaned pending faculty profile. Idempotent. EXECUTE is revoked from PUBLIC
-- and never granted to anon/authenticated because it writes reviewable rows.
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

-- Supabase's default privileges grant EXECUTE on new public functions to the
-- API roles. Revoke PUBLIC *and* those explicit grants, otherwise anon could
-- inject reviewable applications through PostgREST.
revoke all on function public.backfill_pending_faculty_applications()
  from public, anon, authenticated, service_role;

create or replace function public.are_connected(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.connection_requests c
    where c.status = 'accepted'
      and (
        (c.requester_id = a and c.addressee_id = b)
        or (c.requester_id = b and c.addressee_id = a)
      )
  );
$$;

create or replace function public.is_conversation_participant(cid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.conversation_participants p
    where p.conversation_id = cid and p.user_id = auth.uid()
  );
$$;

create or replace function public.emit_notification(
  p_user_id uuid,
  p_type text,
  p_title text,
  p_body text default null,
  p_link text default null,
  p_content_type text default null,
  p_content_id uuid default null,
  p_dedupe_key text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null then return; end if;
  insert into public.notifications (
    user_id, type, title, body, link,
    content_type, content_id, dedupe_key
  ) values (
    p_user_id, p_type, p_title, p_body, p_link,
    p_content_type, p_content_id, p_dedupe_key
  )
  on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
end;
$$;

-- ---------------------------------------------------------
-- Profile privilege protection: prevents non-admin users from
-- changing role, faculty_status, employee_id, designation, usn, or
-- UCC 2.0 member identity fields.
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

create or replace function public.update_updated_at_column()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := timezone('utc'::text, now());
  return new;
end;
$$;

-- ---------------------------------------------------------
-- New user trigger: creates profile row on auth sign-up
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
-- Faculty application status trigger (AFTER UPDATE)
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
-- Faculty application creation: return a rejected/none profile to pending
-- ---------------------------------------------------------
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

-- ---------------------------------------------------------
-- Faculty application transition enforcement (BEFORE INSERT OR UPDATE)
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

-- ---------------------------------------------------------
-- Faculty signup hardening (BEFORE INSERT on profiles)
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

-- ---------------------------------------------------------
-- Connection change trigger + transition enforcement
-- ---------------------------------------------------------
create or replace function public.on_connection_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requester_name text;
begin
  if tg_op = 'INSERT' and new.status = 'pending' then
    select name into requester_name from public.profiles where id = new.requester_id;
    perform public.emit_notification(
      new.addressee_id,
      'connection_request',
      'New connection request',
      coalesce(requester_name, 'A student') || ' wants to connect with you.',
      '/connections'
    );
  elsif tg_op = 'UPDATE' and new.status = 'accepted' and old.status = 'pending' then
    select name into requester_name from public.profiles where id = new.addressee_id;
    perform public.emit_notification(
      new.requester_id,
      'connection_accepted',
      'Connection accepted',
      coalesce(requester_name, 'A student') || ' accepted your connection request.',
      '/connections'
    );
  end if;
  return new;
end;
$$;

create or replace function public.enforce_connection_transition()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  -- Prevent changing the participants of a connection request
  if new.requester_id is distinct from old.requester_id or new.addressee_id is distinct from old.addressee_id then
    raise exception 'Cannot change connection participants';
  end if;

  -- requester may cancel pending; cannot accept their own request
  if old.status = 'pending' and new.status = 'cancelled' then
    if auth.uid() <> old.requester_id and not public.is_admin(auth.uid()) then
      raise exception 'Only the requester can cancel';
    end if;
    new.responded_at := timezone('utc'::text, now());
    return new;
  end if;

  if old.status = 'pending' and new.status in ('accepted', 'rejected') then
    if auth.uid() <> old.addressee_id and not public.is_admin(auth.uid()) then
      raise exception 'Only the addressee can accept or reject';
    end if;
    new.responded_at := timezone('utc'::text, now());
    return new;
  end if;

  -- either party may remove an accepted connection by marking cancelled
  if old.status = 'accepted' and new.status = 'cancelled' then
    if auth.uid() <> old.requester_id and auth.uid() <> old.addressee_id and not public.is_admin(auth.uid()) then
      raise exception 'Only participants can remove a connection';
    end if;
    new.responded_at := timezone('utc'::text, now());
    return new;
  end if;

  raise exception 'Invalid connection status change from % to %', old.status, new.status;
end;
$$;

-- ---------------------------------------------------------
-- Message insert trigger
-- ---------------------------------------------------------
create or replace function public.on_message_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  other_id uuid;
  sender_name text;
  preview text;
begin
  preview := left(btrim(new.body), 140);
  update public.conversations
  set last_message_at = new.created_at,
      last_message_preview = preview,
      updated_at = new.created_at
  where id = new.conversation_id;

  select user_id into other_id
  from public.conversation_participants
  where conversation_id = new.conversation_id and user_id <> new.sender_id
  limit 1;

  select name into sender_name from public.profiles where id = new.sender_id;

  if other_id is not null then
    perform public.emit_notification(
      other_id,
      'message',
      coalesce(sender_name, 'New message'),
      preview,
      '/messages/' || new.conversation_id::text
    );
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------
-- Get-or-create direct conversation (race-safe via unique pair)
-- ---------------------------------------------------------
create or replace function public.get_or_create_direct_conversation(other_user uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  conv_id uuid;
  lesser uuid;
  greater uuid;
begin
  if me is null then
    raise exception 'Not authenticated';
  end if;
  if other_user = me then
    raise exception 'Cannot message yourself';
  end if;
  if not public.are_connected(me, other_user) then
    raise exception 'You can only message accepted connections';
  end if;

  lesser := least(me, other_user);
  greater := greatest(me, other_user);

  insert into public.direct_conversation_pairs (lesser_user, greater_user, conversation_id)
  values (lesser, greater, uuid_generate_v4())
  on conflict (lesser_user, greater_user) do update
    set conversation_id = EXCLUDED.conversation_id
  returning conversation_id into conv_id;

  if not exists (select 1 from public.conversations where id = conv_id) then
    insert into public.conversations (id, is_group) values (conv_id, false);
  end if;

  insert into public.conversation_participants (conversation_id, user_id)
  values (conv_id, me), (conv_id, other_user)
  on conflict (conversation_id, user_id) do nothing;

  if (select count(*) from public.conversation_participants where conversation_id = conv_id) > 2 then
    raise exception 'Conversation already has too many participants';
  end if;

  return conv_id;
end;
$$;

-- ---------------------------------------------------------
-- Conversation participant count enforcement
-- ---------------------------------------------------------
create or replace function public.enforce_conversation_participant_count()
returns trigger
language plpgsql
as $$
declare
  cnt int;
begin
  if exists (select 1 from public.conversations c where c.id = new.conversation_id and c.is_group = false) then
    select count(*) into cnt
    from public.conversation_participants
    where conversation_id = new.conversation_id;
    if cnt >= 2 then
      raise exception 'Direct conversations support exactly two participants';
    end if;
  end if;
  return new;
end;
$$;

-- =========================================================
-- 14. Triggers
-- =========================================================
drop trigger if exists trg_protect_profile_privileges on public.profiles;
create trigger trg_protect_profile_privileges
before update on public.profiles
for each row execute procedure public.protect_profile_privileges();

drop trigger if exists trg_enforce_pending_faculty_signup on public.profiles;
create trigger trg_enforce_pending_faculty_signup
before insert on public.profiles
for each row execute procedure public.enforce_pending_faculty_signup();

drop trigger if exists trg_update_profiles_updated_at on public.profiles;
create trigger trg_update_profiles_updated_at
before update on public.profiles
for each row execute procedure public.update_updated_at_column();

drop trigger if exists trg_update_announcements_updated_at on public.announcements;
create trigger trg_update_announcements_updated_at
before update on public.announcements
for each row execute procedure public.update_updated_at_column();

drop trigger if exists trg_update_conversations_updated_at on public.conversations;
create trigger trg_update_conversations_updated_at
before update on public.conversations
for each row execute procedure public.update_updated_at_column();

drop trigger if exists trg_update_faculty_app_updated_at on public.faculty_applications;
create trigger trg_update_faculty_app_updated_at
before update on public.faculty_applications
for each row execute procedure public.update_updated_at_column();

drop trigger if exists trg_profile_contacts_updated_at on public.profile_contacts;
create trigger trg_profile_contacts_updated_at
before update on public.profile_contacts
for each row execute procedure public.update_updated_at_column();

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

drop trigger if exists trg_faculty_application_transition on public.faculty_applications;
create trigger trg_faculty_application_transition
before insert or update on public.faculty_applications
for each row execute procedure public.enforce_faculty_application_transition();

drop trigger if exists trg_faculty_application_status on public.faculty_applications;
create trigger trg_faculty_application_status
after update on public.faculty_applications
for each row execute procedure public.on_faculty_application_status();

drop trigger if exists trg_faculty_application_created on public.faculty_applications;
create trigger trg_faculty_application_created
after insert on public.faculty_applications
for each row execute procedure public.on_faculty_application_created();

drop trigger if exists trg_connection_transition on public.connection_requests;
create trigger trg_connection_transition
before update on public.connection_requests
for each row execute procedure public.enforce_connection_transition();

drop trigger if exists trg_connection_change on public.connection_requests;
create trigger trg_connection_change
after insert or update on public.connection_requests
for each row execute procedure public.on_connection_change();

drop trigger if exists trg_message_insert on public.messages;
create trigger trg_message_insert
after insert on public.messages
for each row execute procedure public.on_message_insert();

drop trigger if exists trg_enforce_participant_count on public.conversation_participants;
create trigger trg_enforce_participant_count
before insert on public.conversation_participants
for each row execute procedure public.enforce_conversation_participant_count();

-- =========================================================
-- 15. Function permissions
-- =========================================================
revoke all on function public.get_or_create_direct_conversation(uuid) from public;
grant execute on function public.get_or_create_direct_conversation(uuid) to authenticated;

revoke all on function public.emit_notification(uuid, text, text, text, text, text, uuid, text) from public;
revoke all on function public.emit_notification(uuid, text, text, text, text, text, uuid, text) from anon, authenticated;

grant execute on function public.is_admin(uuid) to authenticated, anon;
grant execute on function public.is_verified_faculty(uuid) to authenticated, anon;
grant execute on function public.get_email_verification_status(uuid[]) to authenticated, anon;
grant execute on function public.are_connected(uuid, uuid) to authenticated, anon;
grant execute on function public.is_conversation_participant(uuid) to authenticated, anon;

-- =========================================================
-- 16. Row Level Security (RLS) Policies
-- =========================================================
alter table public.profiles enable row level security;
alter table public.events enable row level security;
alter table public.event_rsvps enable row level security;
alter table public.posts enable row level security;
alter table public.comments enable row level security;
alter table public.likes enable row level security;
alter table public.upvotes enable row level security;
alter table public.notifications enable row level security;
alter table public.faculty_applications enable row level security;
alter table public.connection_requests enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_participants enable row level security;
alter table public.messages enable row level security;
alter table public.announcements enable row level security;
alter table public.announcement_reactions enable row level security;
alter table public.direct_conversation_pairs enable row level security;
alter table public.profile_contacts enable row level security;
alter table public.content_visits enable row level security;

-- Profiles
drop policy if exists "Public profiles are viewable by everyone" on public.profiles;
drop policy if exists "Users can update their own profile" on public.profiles;
drop policy if exists "Users can insert own profile" on public.profiles;
create policy "Public profiles are viewable by everyone" on public.profiles
  for select using (true);
create policy "Users can insert own profile" on public.profiles
  for insert with check (
    auth.uid() = id
    and role = 'student'
    and faculty_status in ('none', 'pending')
    and member_type = 'student'
    and designation is null
    and employee_id is null
  );
create policy "Users can update their own profile" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- Events
drop policy if exists "Events are viewable by everyone" on public.events;
drop policy if exists "Authenticated users can create events" on public.events;
drop policy if exists "Hosts can update their events" on public.events;
drop policy if exists "Hosts can delete their events" on public.events;
create policy "Events are viewable by everyone" on public.events for select using (true);
create policy "Authenticated users can create events" on public.events
  for insert with check (auth.uid() = host_id);
create policy "Hosts can update their events" on public.events
  for update using (auth.uid() = host_id or public.is_admin(auth.uid()));
create policy "Hosts can delete their events" on public.events
  for delete using (auth.uid() = host_id or public.is_admin(auth.uid()));

-- Event RSVPs
drop policy if exists "RSVPs are viewable by everyone" on public.event_rsvps;
drop policy if exists "Users can manage their own RSVP" on public.event_rsvps;
create policy "RSVPs are viewable by everyone" on public.event_rsvps for select using (true);
create policy "Users can manage their own RSVP" on public.event_rsvps
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Posts
drop policy if exists "Posts are viewable by everyone" on public.posts;
drop policy if exists "Authenticated users can create posts" on public.posts;
drop policy if exists "Authors can update their posts" on public.posts;
drop policy if exists "Authors can delete their posts" on public.posts;
create policy "Posts are viewable by everyone" on public.posts for select using (true);
create policy "Authenticated users can create posts" on public.posts
  for insert with check (auth.uid() = author_id);
create policy "Authors can update their posts" on public.posts
  for update using (auth.uid() = author_id or public.is_admin(auth.uid()));
create policy "Authors can delete their posts" on public.posts
  for delete using (auth.uid() = author_id or public.is_admin(auth.uid()));

-- Comments
drop policy if exists "Comments are viewable by everyone" on public.comments;
drop policy if exists "Authenticated users can create comments" on public.comments;
drop policy if exists "Authors can delete comments" on public.comments;
create policy "Comments are viewable by everyone" on public.comments for select using (true);
create policy "Authenticated users can create comments" on public.comments
  for insert with check (auth.uid() = author_id);
create policy "Authors can delete comments" on public.comments
  for delete using (auth.uid() = author_id or public.is_admin(auth.uid()));

-- Likes
drop policy if exists "Likes are viewable by everyone" on public.likes;
drop policy if exists "Users can toggle their own like" on public.likes;
create policy "Likes are viewable by everyone" on public.likes for select using (true);
create policy "Users can toggle their own like" on public.likes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Upvotes
drop policy if exists "Upvotes are viewable by everyone" on public.upvotes;
drop policy if exists "Users can toggle their own upvote" on public.upvotes;
create policy "Upvotes are viewable by everyone" on public.upvotes for select using (true);
create policy "Users can toggle their own upvote" on public.upvotes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Notifications
drop policy if exists "Users view own notifications" on public.notifications;
drop policy if exists "Users can update own notifications" on public.notifications;
create policy "Users view own notifications" on public.notifications
  for select using (auth.uid() = user_id);
create policy "Users can update own notifications" on public.notifications
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Profile contacts — private by default.
-- The owner can manage their row; admins may read every row; everyone else
-- sees a row only when its contact_visibility is 'public' or, for signed-in
-- members, 'members'. is_admin() is SECURITY DEFINER and reads profiles,
-- not profile_contacts, so these policies cannot recurse.
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

-- Content visits — personal history is owner-only, including writes.
drop policy if exists "Users manage own content visits" on public.content_visits;
create policy "Users manage own content visits" on public.content_visits
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Faculty Applications
drop policy if exists "Users read own faculty applications" on public.faculty_applications;
drop policy if exists "Users submit own faculty application" on public.faculty_applications;
drop policy if exists "Admins manage faculty applications" on public.faculty_applications;
create policy "Users read own faculty applications" on public.faculty_applications
  for select using (auth.uid() = user_id or public.is_admin(auth.uid()));
create policy "Users submit own faculty application" on public.faculty_applications
  for insert with check (
    auth.uid() = user_id
    and status = 'pending'
    and reviewed_by IS NULL
    and reviewed_at IS NULL
  );
create policy "Admins manage faculty applications" on public.faculty_applications
  for update using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
create policy "Faculty view own application" on public.faculty_applications
  for select using (auth.uid() = user_id);

-- Connection Requests
drop policy if exists "Users read relevant connections" on public.connection_requests;
drop policy if exists "Users create connection requests" on public.connection_requests;
drop policy if exists "Participants update connections" on public.connection_requests;
create policy "Users read relevant connections" on public.connection_requests
  for select using (auth.uid() = requester_id or auth.uid() = addressee_id);
create policy "Users create connection requests" on public.connection_requests
  for insert with check (
    auth.uid() = requester_id
    and status = 'pending'
    and requester_id <> addressee_id
  );
create policy "Participants update connections" on public.connection_requests
  for update using (auth.uid() = requester_id or auth.uid() = addressee_id)
  with check (auth.uid() = requester_id or auth.uid() = addressee_id);

-- Conversations — no direct client inserts; created only via function
drop policy if exists "Participants read conversations" on public.conversations;
create policy "Participants read conversations" on public.conversations
  for select using (public.is_conversation_participant(id));

-- Conversation Participants
drop policy if exists "Participants read conversation members" on public.conversation_participants;
drop policy if exists "Participants update own read state" on public.conversation_participants;
create policy "Participants read conversation members" on public.conversation_participants
  for select using (public.is_conversation_participant(conversation_id));
create policy "Participants update own read state" on public.conversation_participants
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Messages
drop policy if exists "Participants read messages" on public.messages;
drop policy if exists "Participants send messages" on public.messages;
create policy "Participants read messages" on public.messages
  for select using (public.is_conversation_participant(conversation_id));
create policy "Participants send messages" on public.messages
  for insert with check (
    sender_id = auth.uid()
    and public.is_conversation_participant(conversation_id)
  );

-- Announcements
drop policy if exists "Announcements are viewable by everyone" on public.announcements;
drop policy if exists "Verified faculty create announcements" on public.announcements;
drop policy if exists "Authors update announcements" on public.announcements;
drop policy if exists "Authors delete announcements" on public.announcements;
create policy "Announcements are viewable by everyone" on public.announcements
  for select using (true);
create policy "Verified faculty create announcements" on public.announcements
  for insert with check (
    auth.uid() = author_id and public.is_verified_faculty(auth.uid())
  );
create policy "Authors update announcements" on public.announcements
  for update using (auth.uid() = author_id or public.is_admin(auth.uid()));
create policy "Authors delete announcements" on public.announcements
  for delete using (auth.uid() = author_id or public.is_admin(auth.uid()));

-- Announcement reactions — everyone reads, members write only their own row
drop policy if exists "Announcement reactions are viewable by everyone" on public.announcement_reactions;
drop policy if exists "Members add their own reaction" on public.announcement_reactions;
drop policy if exists "Members remove their own reaction" on public.announcement_reactions;
create policy "Announcement reactions are viewable by everyone" on public.announcement_reactions
  for select using (true);
create policy "Members add their own reaction" on public.announcement_reactions
  for insert with check (auth.uid() = user_id);
create policy "Members remove their own reaction" on public.announcement_reactions
  for delete using (auth.uid() = user_id);

-- Direct conversation pairs — no direct client access
create policy "No direct access to direct_conversation_pairs" on public.direct_conversation_pairs
  for all using (false) with check (false);

-- =========================================================
-- 17. Realtime Publication
-- =========================================================
alter table public.messages replica identity full;
alter table public.notifications replica identity full;
alter table public.conversation_participants replica identity full;
alter table public.faculty_applications replica identity full;

do $$
begin
  begin
    alter publication supabase_realtime add table public.messages;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.notifications;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.conversation_participants;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.faculty_applications;
  exception when duplicate_object then null;
  end;
end $$;

notify pgrst, 'reload schema';
