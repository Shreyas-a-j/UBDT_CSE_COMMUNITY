-- =========================================================
-- UCC 2.0 — Phase 1C: notification targeting and content visits
-- Date: 2026-10-22
--
-- Forward-only and additive. Safe to re-run.
--
-- Content identifiers (verified against the canonical schema):
--   - discussions and project showcases both live in public.posts
--     (posts.type = 'discussion' | 'showcase', id uuid)
--   - events live in public.events (id uuid)
-- They do not share a storage model, so notifications carry an explicit
-- content_type discriminator instead of a single polymorphic FK.
--
-- This phase only establishes the data model. It does not create the
-- notification UI, broadcast triggers, or retention jobs.
--
-- Objects changed:
--   - public.notifications: content_type, content_id, dedupe_key columns,
--     checks, lookup index, per-user idempotency index
--   - public.emit_notification(): new optional content parameters;
--     duplicate dedupe keys become a no-op
--   - public.content_visits (new table, RLS)
-- =========================================================

-- ---------------------------------------------------------
-- 1. Notification targeting metadata
-- ---------------------------------------------------------

alter table public.notifications add column if not exists content_type text;
alter table public.notifications add column if not exists content_id uuid;
alter table public.notifications add column if not exists dedupe_key text;

-- content_type and content_id must either both be absent (legacy
-- notifications) or both be present.
alter table public.notifications drop constraint if exists notifications_content_pair_check;
alter table public.notifications add constraint notifications_content_pair_check
  check (
    (content_type is null and content_id is null)
    or (content_type is not null and content_id is not null)
  );

alter table public.notifications drop constraint if exists notifications_content_type_check;
alter table public.notifications add constraint notifications_content_type_check
  check (content_type is null or content_type in ('discussion', 'event', 'showcase'));

alter table public.notifications drop constraint if exists notifications_dedupe_key_check;
alter table public.notifications add constraint notifications_dedupe_key_check
  check (dedupe_key is null or char_length(dedupe_key) between 1 and 200);

create index if not exists notifications_content_idx
  on public.notifications (content_type, content_id)
  where content_id is not null;

-- Idempotency for generated notifications. A deterministic key such as
-- 'content_published:event:<uuid>' suppresses duplicate fan-out to the
-- same user. Legacy notifications have dedupe_key = NULL and are not
-- affected.
create unique index if not exists notifications_user_dedupe_key_unique
  on public.notifications (user_id, dedupe_key)
  where dedupe_key is not null;

-- ---------------------------------------------------------
-- 2. emit_notification: optional targeting + idempotency
--
-- The previous five-argument signature is dropped first. Adding
-- parameters with CREATE OR REPLACE would otherwise leave two overloads
-- behind and silently keep routing existing calls to the old body.
--
-- Execute is revoked from anon/authenticated. Notification fan-out is a
-- server-side/trigger responsibility; the old migration had granted
-- EXECUTE to authenticated, which allowed any signed-in user to insert
-- arbitrary notifications for another user.
-- ---------------------------------------------------------

drop function if exists public.emit_notification(uuid, text, text, text, text);

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

revoke all on function public.emit_notification(uuid, text, text, text, text, text, uuid, text) from public;
revoke all on function public.emit_notification(uuid, text, text, text, text, text, uuid, text) from anon, authenticated;

-- ---------------------------------------------------------
-- 3. Content visits
--
-- One row per (user, content_type, content_id). Repeated visits update
-- last_visited_at instead of appending rows, so the table cannot grow
-- without bound for a single viewer/content pair.
--
-- content_id is intentionally not a FK: it points at posts.id or
-- events.id depending on content_type. Deleted content may leave visit
-- rows; a later phase can add cleanup. The owner-only RLS policy keeps
-- personal visit history private.
-- ---------------------------------------------------------

create table if not exists public.content_visits (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  content_type text not null,
  content_id uuid not null,
  first_visited_at timestamptz not null default timezone('utc'::text, now()),
  last_visited_at timestamptz not null default timezone('utc'::text, now())
);

alter table public.content_visits drop constraint if exists content_visits_content_type_check;
alter table public.content_visits add constraint content_visits_content_type_check
  check (content_type in ('discussion', 'event', 'showcase'));

alter table public.content_visits drop constraint if exists content_visits_time_order_check;
alter table public.content_visits add constraint content_visits_time_order_check
  check (last_visited_at >= first_visited_at);

alter table public.content_visits drop constraint if exists content_visits_user_content_key;
alter table public.content_visits add constraint content_visits_user_content_key
  unique (user_id, content_type, content_id);

create index if not exists content_visits_user_recent_idx
  on public.content_visits (user_id, last_visited_at desc);

create index if not exists content_visits_content_idx
  on public.content_visits (content_type, content_id);

alter table public.content_visits enable row level security;

drop policy if exists "Users manage own content visits" on public.content_visits;

create policy "Users manage own content visits" on public.content_visits
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------
-- 4. Reload PostgREST schema cache
-- ---------------------------------------------------------

notify pgrst, 'reload schema';
