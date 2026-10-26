-- =========================================================
-- UCC 2.0 — Android push, part 1: schema & state
-- Date: 2026-10-24
--
-- Forward-only and additive. Safe to re-run.
--
-- Adds:
--   * notifications.type += 'showcase_top2' (full previous list kept)
--   * notification_preferences.push_enabled (default-on app preference)
--   * notification_push_outbox — one durable OneSignal work item per
--     in-app notification. The outbox row UUID is the provider
--     idempotency key; notification_id is UNIQUE so a notification can
--     never produce two push jobs, including on trigger re-fire.
--   * showcase_top_entries — durable top-two tenures. entry_seq is
--     per-post and monotonically increasing, so the notification dedupe
--     key (showcase_top2:<post>:<seq>) is stable across retries and
--     distinct for a genuine later re-entry.
--
-- Email is not removed here. 2026102403 disables new email enqueue after
-- the publish trigger has stopped writing it. Historical rows stay.
--
-- Rollback (manual; forward-only chain):
--   drop table if exists public.notification_push_outbox;
--   drop table if exists public.showcase_top_entries;
--   alter table public.notification_preferences drop column if exists push_enabled;
--   alter table public.notifications drop constraint if exists notifications_type_check;
--   alter table public.notifications add constraint notifications_type_check
--     check (type in ('comment','rsvp','event_reminder','like','upvote',
--                     'connection_request','connection_accepted','message',
--                     'announcement','faculty_decision','event_published'));
-- =========================================================

-- ---------------------------------------------------------
-- 1. Notification type for a showcase's first moment in the top two
-- ---------------------------------------------------------

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (
    type in (
      'comment', 'rsvp', 'event_reminder', 'like', 'upvote',
      'connection_request', 'connection_accepted', 'message',
      'announcement', 'faculty_decision', 'event_published',
      'showcase_top2'
    )
  );

-- ---------------------------------------------------------
-- 2. Push preference
--
-- Default-on at the application layer. Platform permission is still the
-- actual opt-in: the worker sends only to devices OneSignal can address
-- through the Supabase UUID external_id. A missing row means enabled.
-- ---------------------------------------------------------

alter table public.notification_preferences
  add column if not exists push_enabled boolean not null default true;

comment on column public.notification_preferences.push_enabled is
  'App-level push opt-out. Missing row = true. Platform permission remains the device-level opt-in.';

-- ---------------------------------------------------------
-- 3. Push outbox
--
-- One row per in-app notification. notification_id UNIQUE is the
-- idempotency boundary; ON CONFLICT (notification_id) DO NOTHING is
-- safe on trigger re-fire. status is a delivery state machine:
-- pending -> sending -> sent | failed | skipped.
-- ---------------------------------------------------------

create table if not exists public.notification_push_outbox (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null
    references public.notifications(id) on delete cascade,
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

alter table public.notification_push_outbox enable row level security;
revoke all on public.notification_push_outbox from anon, authenticated;

drop trigger if exists trg_update_notification_push_outbox_updated_at
  on public.notification_push_outbox;
create trigger trg_update_notification_push_outbox_updated_at
  before update on public.notification_push_outbox
  for each row execute procedure public.update_updated_at_column();

-- ---------------------------------------------------------
-- 4. Showcase top-two tenures
--
-- One active row per post (partial unique index). entry_seq increments
-- per post only after a previous tenure is closed. left_at marks a
-- genuine departure; a later re-entry creates seq+1 and therefore a new
-- notification. Continuing membership never creates a row.
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

alter table public.showcase_top_entries enable row level security;
revoke all on public.showcase_top_entries from anon, authenticated;

notify pgrst, 'reload schema';
