-- =========================================================
-- UCC 2.0 — Phase 6: announcement images and reactions
-- Date: 2026-10-22
--
-- Forward-only, additive and safe to re-run. It never updates or deletes an
-- existing row and never touches another table's data.
--
-- What it adds
-- ------------
-- 1. public.announcements.image_urls — up to four public R2 URLs per
--    announcement (the project has no Supabase Storage bucket; images use the
--    existing Cloudflare R2 architecture).
-- 2. public.announcement_reactions — one row per (announcement, member,
--    reaction). The composite primary key is what makes a duplicate reaction
--    of the same type by the same member impossible.
-- 3. RLS for the new table: everyone may read counts; a signed-in member may
--    only insert and delete their own row.
--
-- It also re-asserts the existing announcements policies so this migration is
-- self-sufficient: the publish route and the insert policy both require
-- verified faculty, and neither trusts a client-supplied role.
--
-- Apply with either:
--   supabase db push
--   psql "$DATABASE_URL" -f supabase/migrations/2026102205_announcement_images_and_reactions.sql
-- Then reload PostgREST (the final NOTIFY does that for you).
-- =========================================================

-- ---------------------------------------------------------
-- 1. Optional images
-- ---------------------------------------------------------
alter table public.announcements
  add column if not exists image_urls text[] not null default '{}';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'announcements_image_urls_check'
      and conrelid = 'public.announcements'::regclass
  ) then
    alter table public.announcements
      add constraint announcements_image_urls_check
      check (
        array_length(image_urls, 1) is null
        or array_length(image_urls, 1) between 1 and 4
      );
  end if;
end $$;

-- ---------------------------------------------------------
-- 2. Reactions
-- ---------------------------------------------------------
create table if not exists public.announcement_reactions (
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  reaction text not null check (reaction in ('thumbs_up', 'heart', 'party', 'clap')),
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  primary key (announcement_id, user_id, reaction)
);

create index if not exists announcement_reactions_announcement_idx
  on public.announcement_reactions (announcement_id);

alter table public.announcement_reactions enable row level security;

drop policy if exists "Announcement reactions are viewable by everyone" on public.announcement_reactions;
drop policy if exists "Members add their own reaction" on public.announcement_reactions;
drop policy if exists "Members remove their own reaction" on public.announcement_reactions;

create policy "Announcement reactions are viewable by everyone" on public.announcement_reactions
  for select using (true);

-- Insert is always the caller's own row: a member can neither react on behalf
-- of somebody else nor write a row for another user id.
create policy "Members add their own reaction" on public.announcement_reactions
  for insert with check (auth.uid() = user_id);

create policy "Members remove their own reaction" on public.announcement_reactions
  for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------
-- 3. Re-assert the announcements policies
-- ---------------------------------------------------------
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

notify pgrst, 'reload schema';
