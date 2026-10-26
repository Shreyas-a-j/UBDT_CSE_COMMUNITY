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

-- Shared updated_at trigger helper. Defined before the first trigger that
-- references it so a fresh install can create the push/email triggers.
create or replace function public.update_updated_at_column()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := timezone('utc'::text, now());
  return new;
end;
$$;

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
    'announcement', 'faculty_decision', 'event_published',
    'showcase_top2'
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
    check (content_type is null or content_type in ('discussion', 'event', 'showcase', 'announcement')),
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

-- 24-hour retention scans by creation time.
create index if not exists notifications_created_at_idx
  on public.notifications (created_at);

-- ---------------------------------------------------------
-- Dedupe ledger: survives the in-app notification so deleting the row
-- cannot authorize a duplicate push. released_at is set when retention
-- deletes the notification; pruning waits 30 days after release.
-- Server-only. Mirrors 2026102501_notification_retention.sql.
-- ---------------------------------------------------------
create table if not exists public.notification_dedupe_ledger (
  user_id uuid not null references public.profiles(id) on delete cascade,
  dedupe_key text not null
    check (char_length(dedupe_key) between 1 and 200),
  created_at timestamp with time zone not null default now(),
  released_at timestamp with time zone,
  primary key (user_id, dedupe_key)
);

create index if not exists notification_dedupe_ledger_released_idx
  on public.notification_dedupe_ledger (released_at)
  where released_at is not null;

alter table public.notification_dedupe_ledger enable row level security;
revoke all on public.notification_dedupe_ledger from anon, authenticated;

-- Suppress a duplicate key before the existing unique index sees it.
-- The trigger owner can write the server-only ledger; clients cannot.
create or replace function public.guard_notification_dedupe()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.dedupe_key is null then
    return new;
  end if;

  insert into public.notification_dedupe_ledger (user_id, dedupe_key, created_at)
  values (new.user_id, new.dedupe_key, coalesce(new.created_at, now()))
  on conflict (user_id, dedupe_key) do nothing;

  if not found then
    return null;
  end if;

  return new;
end;
$$;

revoke all on function public.guard_notification_dedupe() from public;
revoke all on function public.guard_notification_dedupe() from anon;
revoke all on function public.guard_notification_dedupe() from authenticated;

drop trigger if exists trg_guard_notification_dedupe on public.notifications;
create trigger trg_guard_notification_dedupe
  before insert on public.notifications
  for each row execute procedure public.guard_notification_dedupe();

-- ---------------------------------------------------------
-- Email preference (opt-out), default-on. Missing row = enabled:
-- every read coalesces a missing row to true. Users manage their own
-- row only; cross-user changes are service-role territory. Mirrors
-- 2026102303_notification_publish_schema.sql.
-- ---------------------------------------------------------
create table if not exists public.notification_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  email_enabled boolean not null default true,
  push_enabled boolean not null default true,
  updated_at timestamp with time zone not null default timezone('utc'::text, now())
);

drop trigger if exists trg_update_notification_preferences_updated_at on public.notification_preferences;
create trigger trg_update_notification_preferences_updated_at
  before update on public.notification_preferences
  for each row execute procedure public.update_updated_at_column();

-- ---------------------------------------------------------
-- Durable email delivery queue: one row per (source, recipient),
-- explicit delivery state, retry bookkeeping, unique idempotency key.
-- No client policies and privileges revoked from anon/authenticated:
-- only the service role (the Edge Function worker) reads or writes it.
-- source_type is restricted to announcement/event so discussions and
-- comments can never be queued for email at the schema level. Mirrors
-- 2026102303_notification_publish_schema.sql.
-- ---------------------------------------------------------
create table if not exists public.notification_email_outbox (
  id uuid primary key default gen_random_uuid(),
  source_type text not null check (source_type in ('announcement', 'event')),
  source_id uuid not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  next_attempt_at timestamp with time zone not null default timezone('utc'::text, now()),
  locked_at timestamp with time zone,
  provider text not null default 'resend',
  provider_message_id text,
  sent_at timestamp with time zone,
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  updated_at timestamp with time zone not null default timezone('utc'::text, now()),
  constraint notification_email_outbox_unique unique (source_type, source_id, user_id)
);

create index if not exists notification_email_outbox_due_idx
  on public.notification_email_outbox (next_attempt_at)
  where status in ('pending', 'failed');
create index if not exists notification_email_outbox_user_idx
  on public.notification_email_outbox (user_id, created_at desc);

revoke all on public.notification_email_outbox from anon, authenticated;

drop trigger if exists trg_update_notification_email_outbox_updated_at on public.notification_email_outbox;
create trigger trg_update_notification_email_outbox_updated_at
  before update on public.notification_email_outbox
  for each row execute procedure public.update_updated_at_column();

-- ---------------------------------------------------------
-- Android push queue: one row per in-app notification. The outbox row
-- UUID is the OneSignal idempotency key; notification_id is UNIQUE so a
-- notification can never create two pushes. Retention detaches a
-- terminal log instead of destroying delivery state. No client policies
-- and no client privileges. Mirrors 2026102401 + 2026102501.
-- ---------------------------------------------------------
create table if not exists public.notification_push_outbox (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid
    references public.notifications(id) on delete set null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  source_type text not null
    check (source_type in ('announcement', 'event', 'showcase_top2')),
  source_id uuid not null,
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  next_attempt_at timestamp with time zone not null default timezone('utc'::text, now()),
  locked_at timestamp with time zone,
  provider text not null default 'onesignal',
  provider_message_id text,
  sent_at timestamp with time zone,
  finished_at timestamp with time zone,
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  updated_at timestamp with time zone not null default timezone('utc'::text, now()),
  constraint notification_push_outbox_notification_unique unique (notification_id)
);

create index if not exists notification_push_outbox_due_idx
  on public.notification_push_outbox (next_attempt_at)
  where status in ('pending', 'failed');
create index if not exists notification_push_outbox_user_idx
  on public.notification_push_outbox (user_id, created_at desc);
create index if not exists notification_push_outbox_source_idx
  on public.notification_push_outbox (source_type, source_id);
create index if not exists notification_push_outbox_terminal_idx
  on public.notification_push_outbox (status, finished_at)
  where finished_at is not null;

revoke all on public.notification_push_outbox from anon, authenticated;

drop trigger if exists trg_update_notification_push_outbox_updated_at
  on public.notification_push_outbox;
create trigger trg_update_notification_push_outbox_updated_at
  before update on public.notification_push_outbox
  for each row execute procedure public.update_updated_at_column();

-- ---------------------------------------------------------
-- Durable showcase top-two tenures. One active row per post; a genuine
-- re-entry gets entry_seq + 1 and therefore a distinct notification key.
-- Server-only. Mirrors 2026102401_android_push_schema.sql.
-- ---------------------------------------------------------
create table if not exists public.showcase_top_entries (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  entry_seq integer not null check (entry_seq > 0),
  entered_at timestamp with time zone not null default timezone('utc'::text, now()),
  left_at timestamp with time zone,
  notified_at timestamp with time zone,
  notification_id uuid references public.notifications(id) on delete set null,
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  constraint showcase_top_entries_seq_unique unique (post_id, entry_seq),
  constraint showcase_top_entries_time_order_check
    check (left_at is null or left_at >= entered_at)
);

create unique index if not exists showcase_top_entries_one_active_idx
  on public.showcase_top_entries (post_id)
  where left_at is null;
create unique index if not exists showcase_top_entries_notification_idx
  on public.showcase_top_entries (notification_id)
  where notification_id is not null;
create index if not exists showcase_top_entries_active_idx
  on public.showcase_top_entries (entered_at desc)
  where left_at is null;

revoke all on public.showcase_top_entries from anon, authenticated;

-- ---------------------------------------------------------
-- Notification retention: one terminal predicate, batched cleanup, and
-- a pg_cron schedule helper that is safe when pg_cron is not installed.
-- Mirrors 2026102501_notification_retention.sql.
-- ---------------------------------------------------------
create or replace function public.notification_push_outbox_is_terminal(
  p_status text,
  p_finished_at timestamp with time zone,
  p_next_attempt_at timestamp with time zone
)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select case
    when p_status in ('sent', 'skipped') then true
    when p_status = 'failed' then
      p_finished_at is not null
      or (p_next_attempt_at is not null
          and p_next_attempt_at > now() + interval '1 day')
    else false
  end;
$$;

revoke all on function public.notification_push_outbox_is_terminal(
  text, timestamp with time zone, timestamp with time zone
) from public;
revoke all on function public.notification_push_outbox_is_terminal(
  text, timestamp with time zone, timestamp with time zone
) from anon;
revoke all on function public.notification_push_outbox_is_terminal(
  text, timestamp with time zone, timestamp with time zone
) from authenticated;

create or replace function public.cleanup_expired_notifications(
  p_notification_retention interval default interval '24 hours',
  p_dedupe_retention interval default interval '30 days',
  p_success_log_retention interval default interval '7 days',
  p_failure_log_retention interval default interval '30 days',
  p_batch_size integer default 1000,
  p_max_batches integer default 10
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamp with time zone := now();
  v_cutoff timestamp with time zone;
  v_deleted_total bigint := 0;
  v_released_total bigint := 0;
  v_batch_deleted bigint;
  v_batch_released bigint;
  v_batches integer := 0;
  v_orphan_released bigint := 0;
  v_success_pruned bigint := 0;
  v_failed_pruned bigint := 0;
  v_dedupe_pruned bigint := 0;
  v_remaining bigint := 0;
  v_summary jsonb;
begin
  if p_notification_retention is null or p_notification_retention < interval '0' then
    raise exception 'p_notification_retention must be a non-negative interval';
  end if;
  if p_dedupe_retention is null or p_dedupe_retention < interval '0' then
    raise exception 'p_dedupe_retention must be a non-negative interval';
  end if;
  if p_success_log_retention is null or p_success_log_retention < interval '0' then
    raise exception 'p_success_log_retention must be a non-negative interval';
  end if;
  if p_failure_log_retention is null or p_failure_log_retention < interval '0' then
    raise exception 'p_failure_log_retention must be a non-negative interval';
  end if;
  if p_batch_size is null or p_batch_size <= 0 then
    raise exception 'p_batch_size must be positive';
  end if;
  if p_max_batches is null or p_max_batches <= 0 then
    raise exception 'p_max_batches must be positive';
  end if;

  v_cutoff := v_now - p_notification_retention;

  update public.notification_push_outbox
  set finished_at = coalesce(sent_at, updated_at, created_at)
  where status in ('sent', 'skipped')
    and finished_at is null;

  update public.notification_push_outbox
  set finished_at = coalesce(updated_at, created_at)
  where status = 'failed'
    and finished_at is null
    and next_attempt_at > v_now + interval '1 day';

  loop
    exit when v_batches >= p_max_batches;

    with expired as (
      select n.id
      from public.notifications n
      where n.created_at < v_cutoff
        and not exists (
          select 1
          from public.notification_push_outbox o
          where o.notification_id = n.id
            and not public.notification_push_outbox_is_terminal(
              o.status, o.finished_at, o.next_attempt_at
            )
        )
      order by n.created_at, n.id
      limit p_batch_size
      for update of n skip locked
    ),
    deleted as (
      delete from public.notifications n
      using expired e
      where n.id = e.id
      returning n.user_id, n.dedupe_key
    ),
    released as (
      update public.notification_dedupe_ledger l
      set released_at = v_now
      from deleted d
      where d.dedupe_key is not null
        and l.user_id = d.user_id
        and l.dedupe_key = d.dedupe_key
        and l.released_at is null
      returning 1
    )
    select
      (select count(*) from deleted),
      (select count(*) from released)
    into v_batch_deleted, v_batch_released;

    v_batches := v_batches + 1;
    v_deleted_total := v_deleted_total + v_batch_deleted;
    v_released_total := v_released_total + v_batch_released;

    exit when v_batch_deleted = 0;
    exit when v_batch_deleted < p_batch_size;
  end loop;

  update public.notification_dedupe_ledger l
  set released_at = v_now
  where l.released_at is null
    and not exists (
      select 1
      from public.notifications n
      where n.user_id = l.user_id
        and n.dedupe_key = l.dedupe_key
    );
  get diagnostics v_orphan_released = row_count;
  v_released_total := v_released_total + v_orphan_released;

  delete from public.notification_push_outbox o
  where o.status in ('sent', 'skipped')
    and coalesce(o.finished_at, o.sent_at, o.updated_at, o.created_at)
        < v_now - p_success_log_retention;
  get diagnostics v_success_pruned = row_count;

  delete from public.notification_push_outbox o
  where o.status = 'failed'
    and public.notification_push_outbox_is_terminal(
      o.status, o.finished_at, o.next_attempt_at
    )
    and coalesce(o.finished_at, o.updated_at, o.created_at)
        < v_now - p_failure_log_retention;
  get diagnostics v_failed_pruned = row_count;

  delete from public.notification_dedupe_ledger l
  where l.released_at is not null
    and l.released_at < v_now - p_dedupe_retention
    and not exists (
      select 1
      from public.notifications n
      where n.user_id = l.user_id
        and n.dedupe_key = l.dedupe_key
    );
  get diagnostics v_dedupe_pruned = row_count;

  select count(*)
  into v_remaining
  from public.notifications n
  where n.created_at < v_cutoff
    and not exists (
      select 1
      from public.notification_push_outbox o
      where o.notification_id = n.id
        and not public.notification_push_outbox_is_terminal(
          o.status, o.finished_at, o.next_attempt_at
        )
    );

  v_summary := jsonb_build_object(
    'cutoff', v_cutoff,
    'deleted_notifications', v_deleted_total,
    'released_dedupe_keys', v_released_total,
    'pruned_success_logs', v_success_pruned,
    'pruned_failed_logs', v_failed_pruned,
    'pruned_dedupe_keys', v_dedupe_pruned,
    'batches', v_batches,
    'remaining_expired_notifications', v_remaining
  );

  raise notice
    'notification retention: deleted=% released=% pruned_success=% pruned_failed=% pruned_dedupe=% batches=% remaining=%',
    v_deleted_total, v_released_total, v_success_pruned, v_failed_pruned,
    v_dedupe_pruned, v_batches, v_remaining;

  return v_summary;
end;
$$;

revoke all on function public.cleanup_expired_notifications(
  interval, interval, interval, interval, integer, integer
) from public;
revoke all on function public.cleanup_expired_notifications(
  interval, interval, interval, interval, integer, integer
) from anon;
revoke all on function public.cleanup_expired_notifications(
  interval, interval, interval, interval, integer, integer
) from authenticated;

create or replace function public.ensure_notification_retention_schedule()
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_jobname text := 'ucc2-cleanup-expired-notifications';
  v_schedule text := '*/15 * * * *';
  v_command text := 'select public.cleanup_expired_notifications();';
  v_exists boolean;
begin
  if not exists (
    select 1 from pg_extension where extname = 'pg_cron'
  ) then
    raise notice
      'pg_cron is not installed; notification retention schedule was not created';
    return false;
  end if;

  execute 'select exists (select 1 from cron.job where jobname = $1)'
    into v_exists
    using v_jobname;

  if v_exists then
    execute
      'select cron.alter_job(jobid, schedule := $1, command := $2, active := true)
         from cron.job
        where jobname = $3
        order by jobid
        limit 1'
      using v_schedule, v_command, v_jobname;
  else
    execute 'select cron.schedule($1, $2, $3)'
      using v_jobname, v_schedule, v_command;
  end if;

  return true;
end;
$$;

revoke all on function public.ensure_notification_retention_schedule() from public;
revoke all on function public.ensure_notification_retention_schedule() from anon;
revoke all on function public.ensure_notification_retention_schedule() from authenticated;

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

-- ---------------------------------------------------------
-- Publish fan-out (announcements + events). Mirrors
-- 2026102402_android_push_triggers.sql. AFTER INSERT only: edits
-- (UPDATE) never publish. Eligibility = confirmed email, not
-- banned/deleted, not the publisher. Each eligible recipient gets one
-- in-app notification and, when the app preference allows it, one
-- durable OneSignal push outbox row. Email is not enqueued.
-- ---------------------------------------------------------
create or replace function public.publish_recipient_ids(p_publisher uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.id
  from public.profiles p
  join auth.users u on u.id = p.id
  where u.email_confirmed_at is not null
    and (u.banned_until is null or u.banned_until <= now())
    and u.deleted_at is null
    and (p_publisher is null or p.id <> p_publisher);
$$;

create or replace function public.on_publish_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind text;
  v_type text;
  v_publisher uuid;
  v_title text;
  v_body text;
  v_link text;
  v_recipient uuid;
  v_notification_id uuid;
begin
  if tg_table_name = 'announcements' then
    v_kind := 'announcement';
    v_type := 'announcement';
    v_publisher := new.author_id;
    v_title := left(new.title, 200);
    v_body := left(new.body, 160);
    v_link := '/announcements#announcement-' || new.id;
  elsif tg_table_name = 'events' then
    v_kind := 'event';
    v_type := 'event_published';
    v_publisher := new.host_id;
    v_title := left(new.title, 200);
    v_body := new.type || ' · ' || to_char(new.event_date, 'Dy, Mon DD, YYYY')
              || ' · ' || to_char(new.event_time, 'HH24:MI');
    v_link := '/#event-' || new.id;
  else
    return new;
  end if;

  for v_recipient in
    select * from public.publish_recipient_ids(v_publisher)
  loop
    perform public.emit_notification(
      v_recipient,
      v_type,
      v_title,
      v_body,
      v_link,
      v_kind,
      new.id,
      'publish:' || v_kind || ':' || new.id
    );

    select n.id into v_notification_id
    from public.notifications n
    where n.user_id = v_recipient
      and n.dedupe_key = 'publish:' || v_kind || ':' || new.id;

    if v_notification_id is not null
       and coalesce((
         select p.push_enabled
         from public.notification_preferences p
         where p.user_id = v_recipient
       ), true) then
      insert into public.notification_push_outbox (
        notification_id, user_id, source_type, source_id
      ) values (
        v_notification_id, v_recipient, v_kind, new.id
      )
      on conflict (notification_id) do nothing;
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_publish_fanout_announcement on public.announcements;
create trigger trg_publish_fanout_announcement
after insert on public.announcements
for each row execute procedure public.on_publish_notification();

drop trigger if exists trg_publish_fanout_event on public.events;
create trigger trg_publish_fanout_event
after insert on public.events
for each row execute procedure public.on_publish_notification();

-- ---------------------------------------------------------
-- Showcase top-two tenures. Mirrors 2026102402_android_push_triggers.sql.
-- Ranking: upvotes desc, created_at desc, id asc; only showcases with at
-- least one upvote; cap 2. The advisory lock serializes ranking writers.
-- ---------------------------------------------------------
create or replace function public.recompute_showcase_top2()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_top_ids uuid[] := '{}'::uuid[];
  v_post record;
  v_entry_id uuid;
  v_seq integer;
  v_notification_id uuid;
  v_dedupe_key text;
begin
  perform pg_advisory_xact_lock(
    hashtextextended('public.showcase_top2_ranking', 0)
  );

  select coalesce(array_agg(r.id order by r.rank_order), '{}'::uuid[])
  into v_top_ids
  from (
    select
      p.id,
      row_number() over (
        order by count(u.id) desc, p.created_at desc, p.id asc
      ) as rank_order
    from public.posts p
    join public.upvotes u on u.post_id = p.id
    where p.type = 'showcase'
    group by p.id
    order by count(u.id) desc, p.created_at desc, p.id asc
    limit 2
  ) r;

  -- Close every active tenure that is no longer in the current top two.
  -- Skip posts that are already gone: a showcase DELETE cascades to its
  -- tenure rows in the same statement, and updating a tenure whose parent
  -- post was just removed would violate the FK before the cascade lands.
  update public.showcase_top_entries e
  set left_at = timezone('utc'::text, now())
  where e.left_at is null
    and not (e.post_id = any(v_top_ids))
    and exists (
      select 1 from public.posts p where p.id = e.post_id
    );

  for v_post in
    select p.id, p.author_id, p.title
    from public.posts p
    where p.id = any(v_top_ids)
  loop
    select e.id into v_entry_id
    from public.showcase_top_entries e
    where e.post_id = v_post.id
      and e.left_at is null;

    if v_entry_id is null then
      select coalesce(max(e.entry_seq), 0) + 1 into v_seq
      from public.showcase_top_entries e
      where e.post_id = v_post.id;

      insert into public.showcase_top_entries (post_id, entry_seq)
      values (v_post.id, v_seq)
      returning id into v_entry_id;

      v_dedupe_key := 'showcase_top2:' || v_post.id || ':' || v_seq;

      insert into public.notifications (
        user_id, type, title, body, link,
        content_type, content_id, dedupe_key
      ) values (
        v_post.author_id,
        'showcase_top2',
        'Your showcase is in the top two',
        left(v_post.title, 160),
        '/#showcase-' || v_post.id,
        'showcase',
        v_post.id,
        v_dedupe_key
      )
      on conflict (user_id, dedupe_key) where dedupe_key is not null
      do nothing
      returning id into v_notification_id;

      if v_notification_id is null then
        select n.id into v_notification_id
        from public.notifications n
        where n.user_id = v_post.author_id
          and n.dedupe_key = v_dedupe_key;
      end if;

      if v_notification_id is not null then
        update public.showcase_top_entries
        set notification_id = v_notification_id,
            notified_at = timezone('utc'::text, now())
        where id = v_entry_id;

        if coalesce((
          select p.push_enabled
          from public.notification_preferences p
          where p.user_id = v_post.author_id
        ), true) then
          insert into public.notification_push_outbox (
            notification_id, user_id, source_type, source_id
          ) values (
            v_notification_id, v_post.author_id, 'showcase_top2', v_post.id
          )
          on conflict (notification_id) do nothing;
        end if;
      end if;
    end if;
  end loop;
end;
$$;

create or replace function public.on_showcase_ranking_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.recompute_showcase_top2();
  return null;
end;
$$;

drop trigger if exists trg_showcase_ranking_post_insert on public.posts;
create trigger trg_showcase_ranking_post_insert
after insert on public.posts
for each row execute procedure public.on_showcase_ranking_change();

drop trigger if exists trg_showcase_ranking_post_delete on public.posts;
create trigger trg_showcase_ranking_post_delete
after delete on public.posts
for each row execute procedure public.on_showcase_ranking_change();

drop trigger if exists trg_showcase_ranking_post_update on public.posts;
create trigger trg_showcase_ranking_post_update
after update of type, author_id, created_at on public.posts
for each row execute procedure public.on_showcase_ranking_change();

drop trigger if exists trg_showcase_ranking_upvote_insert on public.upvotes;
create trigger trg_showcase_ranking_upvote_insert
after insert on public.upvotes
for each row execute procedure public.on_showcase_ranking_change();

drop trigger if exists trg_showcase_ranking_upvote_delete on public.upvotes;
create trigger trg_showcase_ranking_upvote_delete
after delete on public.upvotes
for each row execute procedure public.on_showcase_ranking_change();

drop trigger if exists trg_showcase_ranking_upvote_update on public.upvotes;
create trigger trg_showcase_ranking_upvote_update
after update of post_id, user_id on public.upvotes
for each row execute procedure public.on_showcase_ranking_change();

-- Seed current top-two entries as already notified on a new/upgraded
-- database so deployment does not re-announce history. On a brand-new
-- empty database this inserts nothing.
insert into public.showcase_top_entries (
  post_id, entry_seq, entered_at, notified_at
)
select r.id, 1, timezone('utc'::text, now()), timezone('utc'::text, now())
from (
  select p.id
  from public.posts p
  join public.upvotes u on u.post_id = p.id
  where p.type = 'showcase'
  group by p.id
  order by count(u.id) desc, p.created_at desc, p.id asc
  limit 2
) r
on conflict do nothing;

-- Historical email table: new inserts are blocked. The table and rows are
-- retained; email delivery is no longer part of this product flow.
create or replace function public.block_new_email_enqueue()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception using
    errcode = '0A000',
    message = 'Email delivery is disabled for this deployment.',
    hint = 'Use public.notification_push_outbox. Historical email rows are retained.';
end;
$$;

drop trigger if exists trg_block_new_email_enqueue
  on public.notification_email_outbox;
create trigger trg_block_new_email_enqueue
before insert on public.notification_email_outbox
for each row execute procedure public.block_new_email_enqueue();

-- =========================================================
-- 15. Function permissions
-- =========================================================
revoke all on function public.get_or_create_direct_conversation(uuid) from public;
grant execute on function public.get_or_create_direct_conversation(uuid) to authenticated;

revoke all on function public.emit_notification(uuid, text, text, text, text, text, uuid, text) from public;
revoke all on function public.emit_notification(uuid, text, text, text, text, text, uuid, text) from anon, authenticated;

revoke all on function public.publish_recipient_ids(uuid) from public;
revoke all on function public.publish_recipient_ids(uuid) from anon, authenticated;
revoke all on function public.on_publish_notification() from public;
revoke all on function public.on_publish_notification() from anon, authenticated;
revoke all on function public.recompute_showcase_top2() from public;
revoke all on function public.recompute_showcase_top2() from anon, authenticated;
revoke all on function public.on_showcase_ranking_change() from public;
revoke all on function public.on_showcase_ranking_change() from anon, authenticated;
revoke all on function public.block_new_email_enqueue() from public;
revoke all on function public.block_new_email_enqueue() from anon, authenticated;

comment on table public.notification_email_outbox is
  'HISTORICAL ONLY since 2026102403. New inserts are blocked; android push uses notification_push_outbox.';
comment on function public.block_new_email_enqueue() is
  'Fail-closed guard: email delivery is disabled. Drop this trigger only with an approved re-enable migration.';

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
alter table public.notification_preferences enable row level security;
alter table public.notification_email_outbox enable row level security;
alter table public.notification_push_outbox enable row level security;
alter table public.showcase_top_entries enable row level security;

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

-- Email preference — own row only (see 2026102303). The outbox has RLS
-- enabled with NO policies on purpose: every client read/write denied.
drop policy if exists "Users manage own notification preferences" on public.notification_preferences;
create policy "Users manage own notification preferences"
  on public.notification_preferences
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

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
-- 16b. Discussion pins (UCC 2.0 verified-faculty pinning)
--
-- Discussions are public.posts rows with type = 'discussion'. Pins live
-- in a dedicated table so a discussion can be pinned again after expiry
-- without losing its pin history. An active pin is:
--   unpinned_at is null AND pin_expires_at > now()
--
-- Mutations are only possible through the SECURITY DEFINER functions;
-- the table has a read-only RLS policy for active rows and no write
-- policies or write grants for anon/authenticated.
-- =========================================================
create table if not exists public.discussion_pins (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  pinned_by uuid not null references public.profiles(id) on delete cascade,
  pinned_at timestamp with time zone not null default timezone('utc'::text, now()),
  pin_expires_at timestamp with time zone not null
    default (timezone('utc'::text, now()) + interval '7 days'),
  unpinned_at timestamp with time zone,
  unpinned_by uuid references public.profiles(id) on delete set null,
  constraint discussion_pins_expiry_check
    check (pin_expires_at > pinned_at),
  constraint discussion_pins_unpin_pair_check
    check (unpinned_at is not null or unpinned_by is null)
);

create unique index if not exists discussion_pins_one_active_per_discussion
  on public.discussion_pins (post_id)
  where unpinned_at is null;

create index if not exists discussion_pins_active_idx
  on public.discussion_pins (pinned_at desc, pin_expires_at desc)
  where unpinned_at is null;

create index if not exists discussion_pins_post_idx
  on public.discussion_pins (post_id, pinned_at desc);

create or replace function public.pin_discussion(p_discussion_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamp with time zone := timezone('utc'::text, now());
  v_discussion public.posts%rowtype;
  v_pin_id uuid;
  v_active_count integer;
begin
  if v_uid is null
     or not (
       public.is_admin(v_uid)
       or public.is_verified_faculty(v_uid)
     ) then
    raise exception 'Only admins and verified faculty can pin or unpin discussions.'
      using errcode = '42501';
  end if;

  if p_discussion_id is null then
    raise exception 'A discussion id is required.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(2026102301::bigint);

  select *
    into v_discussion
  from public.posts
  where id = p_discussion_id;

  if not found then
    raise exception 'Discussion not found.' using errcode = 'P0002';
  end if;

  if v_discussion.type is distinct from 'discussion' then
    raise exception 'Only discussions can be pinned.' using errcode = '22023';
  end if;

  update public.discussion_pins
  set unpinned_at = v_now
  where post_id = p_discussion_id
    and unpinned_at is null
    and pin_expires_at <= v_now;

  if exists (
    select 1
    from public.discussion_pins
    where post_id = p_discussion_id
      and unpinned_at is null
      and pin_expires_at > v_now
  ) then
    raise exception 'This discussion is already pinned.' using errcode = '23505';
  end if;

  select count(*)
    into v_active_count
  from public.discussion_pins
  where unpinned_at is null
    and pin_expires_at > v_now;

  if v_active_count >= 3 then
    raise exception
      'The community already has 3 active pinned discussions. Wait for a pin to expire or unpin one first.'
      using errcode = '23514';
  end if;

  insert into public.discussion_pins (
    post_id,
    pinned_by,
    pinned_at,
    pin_expires_at
  )
  values (
    p_discussion_id,
    v_uid,
    v_now,
    v_now + interval '7 days'
  )
  returning id into v_pin_id;

  return v_pin_id;
end;
$$;

create or replace function public.unpin_discussion(p_discussion_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamp with time zone := timezone('utc'::text, now());
  v_pin_id uuid;
begin
  if v_uid is null
     or not (
       public.is_admin(v_uid)
       or public.is_verified_faculty(v_uid)
     ) then
    raise exception 'Only admins and verified faculty can pin or unpin discussions.'
      using errcode = '42501';
  end if;

  if p_discussion_id is null then
    raise exception 'A discussion id is required.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(2026102301::bigint);

  update public.discussion_pins
  set
    unpinned_at = v_now,
    unpinned_by = v_uid
  where post_id = p_discussion_id
    and unpinned_at is null
    and pin_expires_at > v_now
  returning id into v_pin_id;

  if v_pin_id is null then
    if exists (
      select 1
      from public.discussion_pins
      where post_id = p_discussion_id
        and unpinned_at is null
        and pin_expires_at <= v_now
    ) then
      raise exception 'This pin has already expired.' using errcode = 'P0002';
    end if;

    raise exception 'This discussion is not pinned.' using errcode = 'P0002';
  end if;

  return v_pin_id;
end;
$$;

revoke all on public.discussion_pins from anon, authenticated;
grant select on public.discussion_pins to anon, authenticated;

revoke all on function public.pin_discussion(uuid) from public;
revoke all on function public.pin_discussion(uuid) from anon;
revoke all on function public.pin_discussion(uuid) from authenticated;
grant execute on function public.pin_discussion(uuid) to authenticated;

revoke all on function public.unpin_discussion(uuid) from public;
revoke all on function public.unpin_discussion(uuid) from anon;
revoke all on function public.unpin_discussion(uuid) from authenticated;
grant execute on function public.unpin_discussion(uuid) to authenticated;

alter table public.discussion_pins enable row level security;

drop policy if exists "Active discussion pins are viewable by everyone"
  on public.discussion_pins;
create policy "Active discussion pins are viewable by everyone"
  on public.discussion_pins
  for select
  using (unpinned_at is null and pin_expires_at > now());

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

select public.ensure_notification_retention_schedule();

notify pgrst, 'reload schema';

-- =========================================================
-- 18. Administrator succession and faculty review (reconciled)
--
-- These blocks are copied verbatim (transaction markers removed)
-- from the canonical migrations so a fresh install from this file
-- includes the same administrator handover and atomic faculty
-- review objects as an existing database that ran the chain:
--   2026102208_single_admin_succession.sql
--   2026102209_admin_bootstrap.sql
--   2026102210_admin_role_check_alignment.sql
--   2026102213_faculty_review_atomic.sql
--   2026102602_admin_nominee_eligibility.sql (final eligibility rule)
-- =========================================================

-- >>> 2026102208_single_admin_succession.sql
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


notify pgrst, 'reload schema';


-- >>> 2026102209_admin_bootstrap.sql
-- =========================================================
-- UCC Phase 12 — one-time initial administrator bootstrap
-- Date: 2026-10-22
-- Migration: 2026102209_admin_bootstrap.sql
--
-- Apply after 2026102208_single_admin_succession.sql.
--
-- This migration adds the *bookkeeping* for a single, operator-run bootstrap.
-- It deliberately does not promote anyone and it does not leave a callable
-- privileged function behind. The promotion itself is the one-off,
-- owner-executed script in supabase/admin/bootstrap-initial-admin.sql.
--
-- Invariants
-- ----------
--   1. public.admin_bootstrap_state has exactly zero or one row. Once the
--      bootstrap completes, the marker blocks every later run, including after
--      an administrator resigns. Recovery after a resignation is the explicit
--      operator process from Phase 11, not a second bootstrap.
--   2. The audit log now accepts the 'bootstrap' action so the initial grant
--      is recorded with the same actor/target/outcome evidence as succession.
--   3. No browser role can read or write the marker: RLS is enabled with no
--      policies and all table privileges are revoked from anon/authenticated.
--
-- The hard "at most one admin" guarantee remains the partial unique index
-- public.profiles_single_admin from Phase 11. This migration does not weaken it.
-- =========================================================


-- ---------------------------------------------------------
-- 1. Extend the audit vocabulary with the one-time bootstrap action.
-- ---------------------------------------------------------
alter table public.admin_audit_log
  drop constraint if exists admin_audit_log_action_check;

alter table public.admin_audit_log
  add constraint admin_audit_log_action_check
  check (action in (
    'bootstrap',
    'nomination_created',
    'nomination_declined',
    'nomination_cancelled',
    'admin_transfer',
    'resignation',
    'recovery'
  ));

-- ---------------------------------------------------------
-- 2. Permanent one-time marker.
--
-- The boolean primary key can only ever hold TRUE, so at most one row can
-- exist. The bootstrap script inserts this row in the same transaction as the
-- role change and the audit entry; a failure rolls all three back together.
-- ---------------------------------------------------------
create table if not exists public.admin_bootstrap_state (
  bootstrap_key boolean primary key default true,
  constraint admin_bootstrap_state_single_row check (bootstrap_key is true),
  completed_at timestamptz not null default timezone('utc'::text, now()),
  completed_by text not null,
  target_id uuid references public.profiles(id) on delete set null,
  target_email text not null,
  detail text
);

comment on table public.admin_bootstrap_state is
  'UCC Phase 12: permanent marker proving the one-time initial administrator bootstrap ran. Presence blocks every later bootstrap attempt.';

-- This marker is operator/audit infrastructure, never client-readable data.
alter table public.admin_bootstrap_state enable row level security;

revoke all on table public.admin_bootstrap_state from public;
revoke all on table public.admin_bootstrap_state from anon;
revoke all on table public.admin_bootstrap_state from authenticated;

-- No SELECT policy is created. Even if a future policy is added, the table
-- privileges above must be granted explicitly first.

-- ---------------------------------------------------------
-- 3. Make the marker append-only for ordinary roles. The owner remains able
--    to perform a documented disaster-recovery repair, but no runtime role
--    can silently delete the proof that bootstrap already happened.
-- ---------------------------------------------------------
create or replace function public.prevent_admin_bootstrap_state_rewrite()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null then
    raise exception using
      errcode = '42501',
      message = 'The administrator bootstrap marker is append-only.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_admin_bootstrap_state_append_only
  on public.admin_bootstrap_state;
create trigger trg_admin_bootstrap_state_append_only
before update or delete on public.admin_bootstrap_state
for each row execute procedure public.prevent_admin_bootstrap_state_rewrite();

revoke all on function public.prevent_admin_bootstrap_state_rewrite() from public;


notify pgrst, 'reload schema';


-- >>> 2026102210_admin_role_check_alignment.sql
-- =========================================================
-- UCC Phase 12.1 — profiles.role must allow 'admin'
-- Date: 2026-10-22
-- Migration: 2026102210_admin_role_check_alignment.sql
--
-- Why this exists
-- ---------------
-- Phase 11/12 grant role = 'admin', but some hand-migrated live databases
-- still carry an older profiles_role_check that only allows 'student' and
-- 'faculty'. In that state the one-time bootstrap fails with:
--
--   23514: new row for relation "profiles" violates check constraint
--          "profiles_role_check"
--
-- The canonical base migrations already widen this constraint, but the
-- bootstrap must not assume every environment has them. This migration makes
-- the permission explicit and idempotent before the bootstrap is run.
--
-- It only widens the allowed role vocabulary. It does not promote anyone,
-- does not rewrite existing rows, and does not weaken any other constraint.
-- Apply after 2026102209_admin_bootstrap.sql and before the one-time
-- bootstrap script.
-- =========================================================


alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('student', 'faculty', 'admin'));


notify pgrst, 'reload schema';


-- >>> 2026102213_faculty_review_atomic.sql
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


notify pgrst, 'reload schema';


-- >>> 2026102602_admin_nominee_eligibility.sql
-- =========================================================
-- UCC 2.0 — align administrator nominee eligibility with the
-- canonical verified-faculty rule
-- Date: 2026-10-26
-- Migration: 2026102602_admin_nominee_eligibility.sql
--
-- Why this migration exists
-- -------------------------
-- public.is_eligible_admin_candidate() required
--   role = 'faculty' AND faculty_status IN ('approved','verified')
--   AND member_type = 'faculty'
--
-- member_type is descriptive identity (student / alumni / faculty), not the
-- privilege model. The canonical verified-faculty rule
-- (public.is_verified_faculty, 2026102206) checks only role and
-- faculty_status. 2026102212 gave profiles.member_type a default of
-- 'student', so an account approved as faculty can legitimately still carry
-- member_type = 'student' (legacy rows, or rows approved before the
-- onboarding trigger wrote member_type). Those accounts are excluded from
-- the administrator handover list and rejected by nominate_admin() even
-- though every other faculty action accepts them.
--
-- The rule is now identical to the canonical verification rule:
--   role = 'faculty' AND faculty_status IN ('approved','verified')
--
-- Students, alumni and unverified/pending/rejected accounts remain
-- ineligible because their role is not 'faculty' (role is protected by
-- public.protect_profile_privileges()). An administrator is not a nominee;
-- nominate_admin() already rejects self/current-admin nominations and the
-- single-admin index is unchanged.
--
-- This migration does not grant administrator privileges. It only decides
-- who may be nominated; acceptance still transfers the role atomically
-- through the existing succession RPC.
--
-- Safety
-- ------
-- * create or replace on one function; no table, row, policy or grant is
--   dropped.
-- * Idempotent.
-- * If the function does not exist (a database that never applied
--   2026102208), this migration creates it; admin_nominations/nominate_admin
--   remain governed by that migration.
-- =========================================================


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
  );
$$;

revoke all on function public.is_eligible_admin_candidate(uuid) from public;
revoke all on function public.is_eligible_admin_candidate(uuid) from anon;
grant execute on function public.is_eligible_admin_candidate(uuid)
  to authenticated;

comment on function public.is_eligible_admin_candidate(uuid) is
  'A nominee must be an approved/verified faculty profile (role = faculty). member_type is descriptive, not an eligibility condition.';

notify pgrst, 'reload schema';

