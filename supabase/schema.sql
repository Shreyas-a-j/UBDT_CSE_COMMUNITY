-- =========================================================
-- UBDT CSE Community — complete schema for new installs
-- For existing databases, apply only:
--   supabase/migrations/20261013_network_and_faculty.sql
-- Then run:  NOTIFY pgrst, 'reload schema';
-- =========================================================

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  usn text unique,
  name text not null default 'Member',
  year int,
  branch text default 'CSE' not null,
  bio text,
  avatar_url text,
  skills text[] default '{}',
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table if not exists public.events (
  id uuid default uuid_generate_v4() primary key,
  host_id uuid references public.profiles(id) on delete cascade not null,
  title text not null,
  description text not null,
  type text not null,
  event_date date not null,
  event_time time not null,
  duration int not null default 60,
  link text,
  target_years int[] default '{1, 2, 3, 4}' not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table if not exists public.event_rsvps (
  id uuid default uuid_generate_v4() primary key,
  event_id uuid references public.events(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete cascade not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  unique(event_id, user_id)
);

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

create table if not exists public.comments (
  id uuid default uuid_generate_v4() primary key,
  post_id uuid references public.posts(id) on delete cascade not null,
  author_id uuid references public.profiles(id) on delete cascade not null,
  body text not null,
  parent_id uuid references public.comments(id) on delete cascade,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table if not exists public.likes (
  id uuid default uuid_generate_v4() primary key,
  post_id uuid references public.posts(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete cascade not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  unique(post_id, user_id)
);

create table if not exists public.upvotes (
  id uuid default uuid_generate_v4() primary key,
  post_id uuid references public.posts(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete cascade not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  unique(post_id, user_id)
);

create table if not exists public.notifications (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  type text not null,
  title text not null,
  body text,
  link text,
  read boolean default false not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Latest additive migration (roles, connections, messaging, faculty, RLS):
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------
-- 1. Canonical profiles table (source of truth)
-- Posts/events/comments FKs already reference public.profiles.
-- ---------------------------------------------------------
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  usn text unique,
  name text not null default 'Member',
  year int,
  branch text default 'CSE' not null,
  bio text,
  avatar_url text,
  skills text[] default '{}',
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

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
  check (faculty_status in ('none', 'pending', 'verified', 'rejected'));

-- Sync legacy user_profiles rows into profiles if that table exists.
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'user_profiles'
  ) then
    execute $sync$
      insert into public.profiles (
        id, usn, name, year, branch, bio, avatar_url, skills, created_at,
        email, thumbhash, updated_at
      )
      select
        up.id,
        nullif(up.usn, ''),
        coalesce(nullif(up.name, ''), 'Member'),
        case when up.year between 1 and 4 then up.year else null end,
        coalesce(up.branch, 'CSE'),
        up.bio,
        up.avatar_url,
        coalesce(up.skills, '{}'),
        coalesce(up.created_at, timezone('utc'::text, now())),
        up.email,
        up.thumbhash,
        coalesce(up.updated_at, timezone('utc'::text, now()))
      from public.user_profiles up
      on conflict (id) do update set
        usn = coalesce(excluded.usn, public.profiles.usn),
        name = coalesce(nullif(excluded.name, ''), public.profiles.name),
        year = coalesce(excluded.year, public.profiles.year),
        bio = coalesce(excluded.bio, public.profiles.bio),
        avatar_url = coalesce(excluded.avatar_url, public.profiles.avatar_url),
        skills = coalesce(excluded.skills, public.profiles.skills),
        email = coalesce(excluded.email, public.profiles.email),
        thumbhash = coalesce(excluded.thumbhash, public.profiles.thumbhash);
    $sync$;
  end if;
end $$;

-- ---------------------------------------------------------
-- 2. Expand event + notification types
-- ---------------------------------------------------------
alter table public.events drop constraint if exists events_type_check;
alter table public.events add constraint events_type_check
  check (type in ('Workshop', 'Meeting', 'Showcase', 'Seminar', 'Project Session'));

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'comment', 'rsvp', 'event_reminder', 'like', 'upvote',
    'connection_request', 'connection_accepted', 'message',
    'announcement', 'faculty_decision'
  ));

-- ---------------------------------------------------------
-- 3. Faculty applications (users cannot self-assign faculty)
-- ---------------------------------------------------------
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
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create unique index if not exists faculty_applications_one_pending
  on public.faculty_applications (user_id)
  where status = 'pending';

-- ---------------------------------------------------------
-- 4. Connection requests
-- ---------------------------------------------------------
create table if not exists public.connection_requests (
  id uuid default uuid_generate_v4() primary key,
  requester_id uuid references public.profiles(id) on delete cascade not null,
  addressee_id uuid references public.profiles(id) on delete cascade not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'cancelled')),
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  responded_at timestamp with time zone,
  constraint connection_no_self check (requester_id <> addressee_id),
  constraint connection_pair unique (requester_id, addressee_id)
);

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

-- ---------------------------------------------------------
-- 5. Conversations + messages (1:1, extensible)
-- ---------------------------------------------------------
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

create table if not exists public.messages (
  id uuid default uuid_generate_v4() primary key,
  conversation_id uuid references public.conversations(id) on delete cascade not null,
  sender_id uuid references public.profiles(id) on delete cascade not null,
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create unique index if not exists conversation_direct_pair
  on public.conversation_participants (conversation_id, user_id);

-- Exactly two participants for non-group conversations is enforced in functions.
create index if not exists messages_conversation_created_idx
  on public.messages (conversation_id, created_at desc);
create index if not exists conversation_participants_user_idx
  on public.conversation_participants (user_id);

-- ---------------------------------------------------------
-- 6. Faculty announcements
-- ---------------------------------------------------------
create table if not exists public.announcements (
  id uuid default uuid_generate_v4() primary key,
  author_id uuid references public.profiles(id) on delete cascade not null,
  title text not null,
  body text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- ---------------------------------------------------------
-- 7. Search / lookup indexes
-- ---------------------------------------------------------
create index if not exists profiles_lower_name_idx on public.profiles (lower(name));
create index if not exists profiles_usn_idx on public.profiles (usn);
create index if not exists profiles_year_idx on public.profiles (year);
create index if not exists profiles_role_idx on public.profiles (role);
create index if not exists profiles_branch_idx on public.profiles (branch);
create index if not exists profiles_skills_gin on public.profiles using gin (skills);
create index if not exists profiles_interests_gin on public.profiles using gin (interests);
create index if not exists announcements_created_idx on public.announcements (created_at desc);
create index if not exists notifications_user_created_idx on public.notifications (user_id, created_at desc);

-- ---------------------------------------------------------
-- 8. Helper functions (SECURITY DEFINER only where required)
-- ---------------------------------------------------------
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
      and (p.role = 'admin' or p.faculty_status = 'verified')
  );
$$;

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
  p_link text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null then return; end if;
  insert into public.notifications (user_id, type, title, body, link)
  values (p_user_id, p_type, p_title, p_body, p_link);
end;
$$;

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
  return new;
end;
$$;

drop trigger if exists trg_protect_profile_privileges on public.profiles;
create trigger trg_protect_profile_privileges
before update on public.profiles
for each row execute procedure public.protect_profile_privileges();

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
    id, email, name, usn, year, branch, section, bio, skills, interests, role, faculty_status
  ) values (
    new.id,
    new.email,
    coalesce(nullif(meta->>'name', ''), split_part(new.email, '@', 1), 'Member'),
    nullif(upper(meta->>'usn'), ''),
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

drop trigger if exists trg_faculty_application_status on public.faculty_applications;
create trigger trg_faculty_application_status
after update on public.faculty_applications
for each row execute procedure public.on_faculty_application_status();

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

drop trigger if exists trg_connection_change on public.connection_requests;
create trigger trg_connection_change
after insert or update on public.connection_requests
for each row execute procedure public.on_connection_change();

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

drop trigger if exists trg_message_insert on public.messages;
create trigger trg_message_insert
after insert on public.messages
for each row execute procedure public.on_message_insert();

create or replace function public.get_or_create_direct_conversation(other_user uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  conv_id uuid;
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

  select c.id into conv_id
  from public.conversations c
  where c.is_group = false
    and exists (
      select 1 from public.conversation_participants p
      where p.conversation_id = c.id and p.user_id = me
    )
    and exists (
      select 1 from public.conversation_participants p
      where p.conversation_id = c.id and p.user_id = other_user
    )
    and (
      select count(*) from public.conversation_participants p
      where p.conversation_id = c.id
    ) = 2
  limit 1;

  if conv_id is not null then
    return conv_id;
  end if;

  insert into public.conversations (is_group) values (false) returning id into conv_id;
  insert into public.conversation_participants (conversation_id, user_id)
  values (conv_id, me), (conv_id, other_user);
  return conv_id;
end;
$$;

revoke all on function public.get_or_create_direct_conversation(uuid) from public;
grant execute on function public.get_or_create_direct_conversation(uuid) to authenticated;

revoke all on function public.emit_notification(uuid, text, text, text, text) from public;
grant execute on function public.is_admin(uuid) to authenticated, anon;
grant execute on function public.is_verified_faculty(uuid) to authenticated, anon;
grant execute on function public.are_connected(uuid, uuid) to authenticated, anon;
grant execute on function public.is_conversation_participant(uuid) to authenticated, anon;

-- ---------------------------------------------------------
-- 9. RLS
-- ---------------------------------------------------------
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
  );
create policy "Users can update their own profile" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

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

drop policy if exists "RSVPs are viewable by everyone" on public.event_rsvps;
drop policy if exists "Users can manage their own RSVP" on public.event_rsvps;
create policy "RSVPs are viewable by everyone" on public.event_rsvps for select using (true);
create policy "Users can manage their own RSVP" on public.event_rsvps
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

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

drop policy if exists "Comments are viewable by everyone" on public.comments;
drop policy if exists "Authenticated users can create comments" on public.comments;
drop policy if exists "Authors can delete comments" on public.comments;
create policy "Comments are viewable by everyone" on public.comments for select using (true);
create policy "Authenticated users can create comments" on public.comments
  for insert with check (auth.uid() = author_id);
create policy "Authors can delete comments" on public.comments
  for delete using (auth.uid() = author_id or public.is_admin(auth.uid()));

drop policy if exists "Likes are viewable by everyone" on public.likes;
drop policy if exists "Users can toggle their own like" on public.likes;
create policy "Likes are viewable by everyone" on public.likes for select using (true);
create policy "Users can toggle their own like" on public.likes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Upvotes are viewable by everyone" on public.upvotes;
drop policy if exists "Users can toggle their own upvote" on public.upvotes;
create policy "Upvotes are viewable by everyone" on public.upvotes for select using (true);
create policy "Users can toggle their own upvote" on public.upvotes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users view own notifications" on public.notifications;
drop policy if exists "Users can update own notifications" on public.notifications;
create policy "Users view own notifications" on public.notifications
  for select using (auth.uid() = user_id);
create policy "Users can update own notifications" on public.notifications
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users read own faculty applications" on public.faculty_applications;
drop policy if exists "Users submit own faculty application" on public.faculty_applications;
drop policy if exists "Admins manage faculty applications" on public.faculty_applications;
create policy "Users read own faculty applications" on public.faculty_applications
  for select using (auth.uid() = user_id or public.is_admin(auth.uid()));
create policy "Users submit own faculty application" on public.faculty_applications
  for insert with check (auth.uid() = user_id and status = 'pending');
create policy "Admins manage faculty applications" on public.faculty_applications
  for update using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

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

create or replace function public.enforce_connection_transition()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
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
  raise exception 'Invalid connection status change';
end;
$$;

drop trigger if exists trg_connection_transition on public.connection_requests;
create trigger trg_connection_transition
before update on public.connection_requests
for each row execute procedure public.enforce_connection_transition();

drop policy if exists "Participants read conversations" on public.conversations;
drop policy if exists "Participants read conversation members" on public.conversation_participants;
drop policy if exists "Participants read messages" on public.messages;
drop policy if exists "Participants send messages" on public.messages;
drop policy if exists "Participants update own read state" on public.conversation_participants;

create policy "Participants read conversations" on public.conversations
  for select using (public.is_conversation_participant(id));

create policy "Participants read conversation members" on public.conversation_participants
  for select using (public.is_conversation_participant(conversation_id));

create policy "Participants update own read state" on public.conversation_participants
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "Participants read messages" on public.messages
  for select using (public.is_conversation_participant(conversation_id));

create policy "Participants send messages" on public.messages
  for insert with check (
    sender_id = auth.uid()
    and public.is_conversation_participant(conversation_id)
  );

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

-- Conversations are created only via get_or_create_direct_conversation.
-- Allow authenticated insert of conversations/participants only through that function
-- (SECURITY DEFINER bypasses RLS). No direct client inserts.

-- ---------------------------------------------------------
-- 10. Realtime
-- ---------------------------------------------------------
alter table public.messages replica identity full;
alter table public.notifications replica identity full;
alter table public.conversation_participants replica identity full;

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
