-- =========================================================
-- UBDT College of Engineering, Davangere (ubdtce.org)
-- CSE Community App - Database Schema & Initial Seed Data
-- =========================================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- 1. Profiles Table
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  usn text unique not null,
  name text not null,
  year int not null check (year between 1 and 4),
  branch text default 'CSE' not null,
  bio text,
  avatar_url text,
  skills text[] default '{}',
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 2. Events Table
create table if not exists public.events (
  id uuid default uuid_generate_v4() primary key,
  host_id uuid references public.profiles(id) on delete cascade not null,
  title text not null,
  description text not null,
  type text not null check (type in ('Workshop', 'Meeting', 'Showcase')),
  event_date date not null,
  event_time time not null,
  duration int not null default 60, -- duration in minutes
  link text,
  target_years int[] default '{1, 2, 3, 4}' not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 3. Event RSVPs
create table if not exists public.event_rsvps (
  id uuid default uuid_generate_v4() primary key,
  event_id uuid references public.events(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete cascade not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  unique(event_id, user_id)
);

-- 4. Posts Table (Discussions & Project Showcases)
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

-- 5. Comments Table
create table if not exists public.comments (
  id uuid default uuid_generate_v4() primary key,
  post_id uuid references public.posts(id) on delete cascade not null,
  author_id uuid references public.profiles(id) on delete cascade not null,
  body text not null,
  parent_id uuid references public.comments(id) on delete cascade,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 6. Likes Table
create table if not exists public.likes (
  id uuid default uuid_generate_v4() primary key,
  post_id uuid references public.posts(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete cascade not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  unique(post_id, user_id)
);

-- 7. Upvotes Table (for showcases)
create table if not exists public.upvotes (
  id uuid default uuid_generate_v4() primary key,
  post_id uuid references public.posts(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete cascade not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  unique(post_id, user_id)
);

-- 8. Notifications Table
create table if not exists public.notifications (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  type text not null check (type in ('comment', 'rsvp', 'event_reminder', 'like', 'upvote')),
  title text not null,
  body text,
  link text,
  read boolean default false not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Row Level Security (RLS)
alter table public.profiles enable row level security;
alter table public.events enable row level security;
alter table public.event_rsvps enable row level security;
alter table public.posts enable row level security;
alter table public.comments enable row level security;
alter table public.likes enable row level security;
alter table public.upvotes enable row level security;
alter table public.notifications enable row level security;

-- Policies
create policy "Public profiles are viewable by everyone" on public.profiles for select using (true);
create policy "Users can update their own profile" on public.profiles for update using (auth.uid() = id);

create policy "Events are viewable by everyone" on public.events for select using (true);
create policy "Authenticated users can create events" on public.events for insert with check (auth.uid() = host_id);
create policy "Hosts can update their events" on public.events for update using (auth.uid() = host_id);

create policy "RSVPs are viewable by everyone" on public.event_rsvps for select using (true);
create policy "Users can manage their own RSVP" on public.event_rsvps for all using (auth.uid() = user_id);

create policy "Posts are viewable by everyone" on public.posts for select using (true);
create policy "Authenticated users can create posts" on public.posts for insert with check (auth.uid() = author_id);
create policy "Authors can update their posts" on public.posts for update using (auth.uid() = author_id);

create policy "Comments are viewable by everyone" on public.comments for select using (true);
create policy "Authenticated users can create comments" on public.comments for insert with check (auth.uid() = author_id);

create policy "Likes are viewable by everyone" on public.likes for select using (true);
create policy "Users can toggle their own like" on public.likes for all using (auth.uid() = user_id);

create policy "Upvotes are viewable by everyone" on public.upvotes for select using (true);
create policy "Users can toggle their own upvote" on public.upvotes for all using (auth.uid() = user_id);

create policy "Users view own notifications" on public.notifications for select using (auth.uid() = user_id);
create policy "Users can update own notifications" on public.notifications for update using (auth.uid() = user_id);
