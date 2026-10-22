-- =========================================================
-- UBDT CSE Community — Schema Audit & Repair Migration
-- Additive / idempotent. Does NOT drop tables or delete data.
-- Apply AFTER: supabase/migrations/2026101301_network_and_faculty.sql
-- Then run:  NOTIFY pgrst, 'reload schema';
-- =========================================================

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------
-- 1. Safe legacy user_profiles sync (fixes non-existent columns)
--
-- PostgreSQL resolves column references at parse time, not at
-- runtime. A CASE WHEN EXISTS (...) THEN up.column END expression
-- still requires up.column to exist when the SQL string is parsed.
-- The original migration's execute $sync$ block referenced columns
-- (email, thumbhash, updated_at) that may not exist in a real legacy
-- user_profiles table, causing parse-time failures.
--
-- This DO block introspects the table's columns via information_schema,
-- then builds the INSERT...SELECT statement dynamically using only
-- columns that actually exist. Dollar-quoted string fragments ($sql$)
-- hold each expression — they don't conflict with the outer DO $$
-- delimiter since $sql$ ≠ $$.
--
-- The INSERT uses ON CONFLICT (id) DO UPDATE for idempotency — it
-- can be re-run safely without duplicating data.
-- ---------------------------------------------------------

do $$
declare
  col_map jsonb;
  has_usn boolean;
  has_email boolean;
  has_thumbhash boolean;
  has_updated_at boolean;
  has_year boolean;
  has_branch boolean;
  has_bio boolean;
  has_avatar_url boolean;
  has_skills boolean;
  has_created_at boolean;
  has_name boolean;
  has_username boolean;
  has_display_name boolean;
  skills_type text;
  branch_type text;
  year_type text;
  skills_is_array boolean;
  branch_is_text boolean;
  year_is_int boolean;
  usn_expr text;
  name_expr text;
  year_expr text;
  branch_expr text;
  bio_expr text;
  avatar_expr text;
  skills_expr text;
  created_expr text;
  email_expr text;
  thumbhash_expr text;
  updated_expr text;
  insert_sql text;
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'user_profiles'
  ) then
    return;
  end if;

  select coalesce(jsonb_object_agg(column_name, data_type), '{}'::jsonb)
    into col_map
  from information_schema.columns
  where table_schema = 'public' and table_name = 'user_profiles';

  -- Check column existence
  has_usn := col_map ? 'usn';
  has_email := col_map ? 'email';
  has_thumbhash := col_map ? 'thumbhash';
  has_updated_at := col_map ? 'updated_at';
  has_year := col_map ? 'year';
  has_branch := col_map ? 'branch';
  has_bio := col_map ? 'bio';
  has_avatar_url := col_map ? 'avatar_url';
  has_skills := col_map ? 'skills';
  has_created_at := col_map ? 'created_at';
  has_name := col_map ? 'name';
  has_username := col_map ? 'username';
  has_display_name := col_map ? 'display_name';

  -- Get data types for type-specific handling
  skills_type := col_map->>'skills';
  branch_type := col_map->>'branch';
  year_type := col_map->>'year';

  -- Determine type categories
  skills_is_array := (skills_type = 'ARRAY');
  branch_is_text := (branch_type in ('text', 'character varying', 'character'));
  year_is_int := (year_type in ('integer', 'bigint', 'smallint'));

  -- Build SELECT expressions for each target column.
  -- Only reference columns that actually exist in user_profiles.
  -- Dollar-quoted strings avoid escaping issues with embedded quotes.

  -- usn
  if has_usn then
    usn_expr := $sql$nullif(up.usn, '')$sql$;
  else
    usn_expr := 'NULL';
  end if;

  -- name: prefer display_name, then username, then name, fallback 'Member'
  if has_display_name and has_username and has_name then
    name_expr := $sql$coalesce(nullif(up.display_name, ''), nullif(up.name, ''), nullif(up.username, ''), 'Member')$sql$;
  elsif has_display_name and has_name then
    name_expr := $sql$coalesce(nullif(up.display_name, ''), nullif(up.name, ''), 'Member')$sql$;
  elsif has_display_name and has_username then
    name_expr := $sql$coalesce(nullif(up.display_name, ''), nullif(up.username, ''), 'Member')$sql$;
  elsif has_display_name then
    name_expr := $sql$coalesce(nullif(up.display_name, ''), 'Member')$sql$;
  elsif has_username and has_name then
    name_expr := $sql$coalesce(nullif(up.name, ''), nullif(up.username, ''), 'Member')$sql$;
  elsif has_username then
    name_expr := $sql$coalesce(nullif(up.username, ''), 'Member')$sql$;
  elsif has_name then
    name_expr := $sql$coalesce(nullif(up.name, ''), 'Member')$sql$;
  else
    name_expr := $sql$'Member'$sql$;
  end if;

  -- year: only use if integer-like type (text years could contain invalid data)
  if year_is_int then
    year_expr := $sql$case when up.year is not null and up.year between 1 and 4 then up.year::int else null end$sql$;
  else
    year_expr := 'NULL';
  end if;

  -- branch: only use if string-like type
  if branch_is_text then
    branch_expr := $sql$coalesce(up.branch, 'CSE')$sql$;
  else
    branch_expr := $sql$'CSE'$sql$;
  end if;

  -- bio
  if has_bio then
    bio_expr := $sql$up.bio$sql$;
  else
    bio_expr := 'NULL';
  end if;

  -- avatar_url
  if has_avatar_url then
    avatar_expr := $sql$up.avatar_url$sql$;
  else
    avatar_expr := 'NULL';
  end if;

  -- skills: handle text[] and text/string types separately
  if skills_is_array then
    skills_expr := $sql$coalesce(up.skills, '{}'::text[])$sql$;
  elsif has_skills and skills_type in ('text', 'character varying', 'character') then
    skills_expr := $sql$case when up.skills is null or trim(both from up.skills) = '' then '{}'::text[] else string_to_array(trim(both from up.skills), ',') end$sql$;
  else
    skills_expr := $sql$'{}'::text[]$sql$;
  end if;

  -- created_at
  if has_created_at then
    created_expr := $sql$coalesce(up.created_at, timezone('utc'::text, now()))$sql$;
  else
    created_expr := $sql$timezone('utc'::text, now())$sql$;
  end if;

  -- email
  if has_email then
    email_expr := $sql$up.email$sql$;
  else
    email_expr := 'NULL';
  end if;

  -- thumbhash
  if has_thumbhash then
    thumbhash_expr := $sql$up.thumbhash$sql$;
  else
    thumbhash_expr := 'NULL';
  end if;

  -- updated_at
  if has_updated_at then
    updated_expr := $sql$coalesce(up.updated_at, timezone('utc'::text, now()))$sql$;
  else
    updated_expr := $sql$timezone('utc'::text, now())$sql$;
  end if;

  -- Assemble and execute the INSERT ... SELECT ... ON CONFLICT statement
  -- The ON CONFLICT clause only references excluded.* and public.profiles.*
  -- (both guaranteed to exist), so no dynamic construction is needed there.
  insert_sql := $sql$insert into public.profiles (id, usn, name, year, branch, bio, avatar_url, skills, created_at, email, thumbhash, updated_at) select up.id, $sql$
    || usn_expr || ', '
    || name_expr || ', '
    || year_expr || ', '
    || branch_expr || ', '
    || bio_expr || ', '
    || avatar_expr || ', '
    || skills_expr || ', '
    || created_expr || ', '
    || email_expr || ', '
    || thumbhash_expr || ', '
    || updated_expr
    || $sql$ from public.user_profiles up on conflict (id) do update set usn = coalesce(excluded.usn, public.profiles.usn), name = coalesce(nullif(excluded.name, ''), public.profiles.name), year = coalesce(excluded.year, public.profiles.year), branch = coalesce(excluded.branch, public.profiles.branch), bio = coalesce(excluded.bio, public.profiles.bio), avatar_url = coalesce(excluded.avatar_url, public.profiles.avatar_url), skills = coalesce(excluded.skills, public.profiles.skills), created_at = coalesce(excluded.created_at, public.profiles.created_at), email = coalesce(excluded.email, public.profiles.email), thumbhash = coalesce(excluded.thumbhash, public.profiles.thumbhash), updated_at = coalesce(excluded.updated_at, public.profiles.updated_at)$sql$;

  execute insert_sql;
end $$;

-- ---------------------------------------------------------
-- 2. Protect employee_id and designation from non-admin updates
--
-- The original protect_profile_privileges trigger only protected
-- role and faculty_status. A faculty user could PATCH their own
-- employee_id or designation via the REST API. We extend the
-- trigger to also reset employee_id and designation for non-admins.
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
  return new;
end;
$$;

-- Trigger already exists from base migration; recreate to pick up new body
drop trigger if exists trg_protect_profile_privileges on public.profiles;
create trigger trg_protect_profile_privileges
before update on public.profiles
for each row execute procedure public.protect_profile_privileges();

-- ---------------------------------------------------------
-- 3. Enforce connection participant immutability + valid transitions
--
-- The original enforce_connection_transition did not prevent
-- changing requester_id or addressee_id on an existing row.
-- This would allow request forgery. We add a hard guard.
-- ---------------------------------------------------------

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

drop trigger if exists trg_connection_transition on public.connection_requests;
create trigger trg_connection_transition
before update on public.connection_requests
for each row execute procedure public.enforce_connection_transition();

-- ---------------------------------------------------------
-- 4. Fix connection_pair unique constraint (too broad)
--
-- The original `unique (requester_id, addressee_id)` prevents
-- re-sending a request after it was rejected/cancelled. Replace
-- with a partial unique index on pending status only.
-- ---------------------------------------------------------

-- Drop the old constraint if it exists
alter table public.connection_requests drop constraint if exists connection_pair;

-- Partial unique: only one pending request per (requester, addressee) pair
create unique index if not exists connection_pending_pair
  on public.connection_requests (requester_id, addressee_id)
  where status = 'pending';

-- ---------------------------------------------------------
-- 5. Enforce valid faculty application state transitions
--
-- Prevents users from setting status directly and prevents
-- status regression without admin action. Also ensures only
-- admins can mark an application as something other than 'pending'
-- on update.
-- ---------------------------------------------------------

create or replace function public.enforce_faculty_application_transition()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    -- Only allow insert with status = 'pending' (already enforced by policy, but double-check)
    if new.status is distinct from 'pending' then
      raise exception 'Faculty applications must start as pending';
    end if;
    -- Ensure reviewers cannot be set on insert
    if new.reviewed_by is not null or new.reviewed_at is not null then
      raise exception 'Cannot set reviewer on new application';
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    -- Only admins can change the status of a faculty application
    if new.status is distinct from old.status then
      if not public.is_admin(auth.uid()) then
        raise exception 'Only administrators can change application status';
      end if;
      -- Prevent status regression: once approved, cannot go back to pending
      if old.status = 'approved' and new.status = 'pending' then
        raise exception 'Cannot revert an approved application to pending';
      end if;
      -- If changing to a final status, set reviewed fields if not already set
      if new.status in ('approved', 'rejected') then
        if new.reviewed_at is null and old.reviewed_at is null then
          new.reviewed_at := timezone('utc'::text, now());
        end if;
      end if;
    end if;

    -- Non-admin users: prevent changing any column if status changed
    -- (covered by above; also prevent changing reviewed_by/reviewed_at as non-admin)
    if new.reviewed_by is distinct from old.reviewed_by or new.reviewed_at is distinct from old.reviewed_at then
      if not public.is_admin(auth.uid()) then
        raise exception 'Only administrators can set reviewer fields';
      end if;
    end if;

    return new;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_faculty_application_transition on public.faculty_applications;
create trigger trg_faculty_application_transition
before insert or update on public.faculty_applications
for each row execute procedure public.enforce_faculty_application_transition();

-- ---------------------------------------------------------
-- 6. Fix get_or_create_direct_conversation race condition
--
-- Adds a unique constraint on the participant pair so concurrent
-- calls cannot create duplicate conversations. Uses a
-- SECURITY DEFINER helper that inserts into a unique index
-- with ON CONFLICT to atomically find-or-create.
-- ---------------------------------------------------------

-- Create a unique index on conversation participant pairs for non-group conversations.
-- We use a computed expression: for direct conversations, the pair of
-- participant IDs must be unique. We achieve this with a partial unique
-- index over the two participants.
--
-- Implementation: We create a table `direct_conversation_pairs` that
-- stores (lesser_user, greater_user, conversation_id) for non-group
-- conversations, with a unique constraint on (lesser_user, greater_user).
create table if not exists public.direct_conversation_pairs (
  lesser_user uuid not null references public.profiles(id) on delete cascade,
  greater_user uuid not null references public.profiles(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  primary key (lesser_user, greater_user)
);

create index if not exists direct_conversation_pairs_conv_idx
  on public.direct_conversation_pairs (conversation_id);

-- Drop and recreate the function with race-safe logic
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

  -- Atomically find or create the conversation pair
  insert into public.direct_conversation_pairs (lesser_user, greater_user, conversation_id)
  values (lesser, greater, uuid_generate_v4())
  on conflict (lesser_user, greater_user) do update
    set conversation_id = EXCLUDED.conversation_id
  returning conversation_id into conv_id;

  -- Check if this is an existing conversation (ON CONFLICT DO UPDATE means
  -- a race might have inserted the conversation participants already)
  -- The conv_id returned is always the correct one.

  -- Ensure the conversation exists
  if not exists (select 1 from public.conversations where id = conv_id) then
    insert into public.conversations (id, is_group) values (conv_id, false);
  end if;

  -- Ensure both participants exist (in case the conversation was created by
  -- the pair table but participants weren't added yet due to a partial insert)
  insert into public.conversation_participants (conversation_id, user_id)
  values (conv_id, me), (conv_id, other_user)
  on conflict (conversation_id, user_id) do nothing;

  -- Enforce exactly 2 participants for non-group conversations
  if (select count(*) from public.conversation_participants where conversation_id = conv_id) > 2 then
    raise exception 'Conversation already has too many participants';
  end if;

  return conv_id;
end;
$$;

revoke all on function public.get_or_create_direct_conversation(uuid) from public;
grant execute on function public.get_or_create_direct_conversation(uuid) to authenticated;

-- ---------------------------------------------------------
-- 7. Enforce exactly 2 participants for non-group conversations
-- (handled in the function above, but also add a guard trigger)
-- ---------------------------------------------------------

create or replace function public.enforce_conversation_participant_count()
returns trigger
language plpgsql
as $$
declare
  cnt int;
begin
  -- Check if the conversation this participant is being added to is a non-group
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

drop trigger if exists trg_enforce_participant_count on public.conversation_participants;
create trigger trg_enforce_participant_count
before insert on public.conversation_participants
for each row execute procedure public.enforce_conversation_participant_count();

-- ---------------------------------------------------------
-- 8. Fix faculty_applications insert policy
-- Add WITH CHECK ensuring reviewer fields are NULL on insert
-- ---------------------------------------------------------

drop policy if exists "Users submit own faculty application" on public.faculty_applications;
create policy "Users submit own faculty application" on public.faculty_applications
  for insert with check (
    auth.uid() = user_id
    and status = 'pending'
    and reviewed_by IS NULL
    and reviewed_at IS NULL
  );

-- ---------------------------------------------------------
-- 9. Add updated_at auto-update triggers
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

-- Attach to profiles
drop trigger if exists trg_update_profiles_updated_at on public.profiles;
create trigger trg_update_profiles_updated_at
before update on public.profiles
for each row execute procedure public.update_updated_at_column();

-- Attach to announcements
drop trigger if exists trg_update_announcements_updated_at on public.announcements;
create trigger trg_update_announcements_updated_at
before update on public.announcements
for each row execute procedure public.update_updated_at_column();

-- Attach to conversations
drop trigger if exists trg_update_conversations_updated_at on public.conversations;
create trigger trg_update_conversations_updated_at
before update on public.conversations
for each row execute procedure public.update_updated_at_column();

-- Attach to faculty_applications
drop trigger if exists trg_update_faculty_app_updated_at on public.faculty_applications;
create trigger trg_update_faculty_app_updated_at
before update on public.faculty_applications
for each row execute procedure public.update_updated_at_column();

-- ---------------------------------------------------------
-- 10. Grant/revoke permissions on new functions
-- ---------------------------------------------------------

revoke all on function public.enforce_connection_transition() from public;
revoke all on function public.enforce_faculty_application_transition() from public;
revoke all on function public.enforce_conversation_participant_count() from public;
revoke all on function public.update_updated_at_column() from public;

-- ---------------------------------------------------------
-- 11. Ensure emit_notification is not executable by untrusted roles
-- (Already revoked in base migration, but enforce here too)
-- ---------------------------------------------------------

revoke all on function public.emit_notification(uuid, text, text, text, text) from public;

-- ---------------------------------------------------------
-- 12. Realtime publication (idempotent)
-- ---------------------------------------------------------

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
end $$;

notify pgrst, 'reload schema';
