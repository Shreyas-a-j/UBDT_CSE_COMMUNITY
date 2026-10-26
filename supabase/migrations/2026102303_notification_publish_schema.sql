-- =========================================================
-- UCC 2.0 — publish fan-out, part 1: schema & compatibility
-- Date: 2026-10-23
--
-- Forward-only and additive. Safe to re-run.
--
-- Part 1 of notifications for published announcements/events. Part 2
-- (2026102304) adds the AFTER INSERT fan-out triggers that consume
-- these objects.
--
-- Objects changed:
--   * public.notifications
--       - notifications_content_type_check gains 'announcement'
--       - notifications_type_check gains 'event_published'
--     (both rebuilds preserve every previously accepted value)
--   * public.notification_preferences (new) — per-user email opt-out.
--     Missing row = default-on; the delivery path reads it as
--     coalesce(email_enabled, true). RLS: users manage their own row
--     only; cross-user changes are service-role territory.
--   * public.notification_email_outbox (new) — durable email delivery
--     queue: one row per (source, recipient), explicit delivery state,
--     retry bookkeeping, and a unique idempotency key. RLS enabled
--     with NO client policies and privileges revoked from anon and
--     authenticated: only the service role (the Edge Function worker)
--     reads or writes it. source_type is deliberately restricted to
--     ('announcement', 'event') so discussions/comments can never be
--     queued for email at the schema level.
--
-- Rollback (manual; the chain is forward-only):
--   drop trigger if exists trg_update_notification_email_outbox_updated_at
--     on public.notification_email_outbox;
--   drop trigger if exists trg_update_notification_preferences_updated_at
--     on public.notification_preferences;
--   drop table if exists public.notification_email_outbox;
--   drop table if exists public.notification_preferences;
--   -- then restore the previous check bodies:
--   alter table public.notifications drop constraint if exists notifications_content_type_check;
--   alter table public.notifications add constraint notifications_content_type_check
--     check (content_type is null or content_type in ('discussion', 'event', 'showcase'));
--   alter table public.notifications drop constraint if exists notifications_type_check;
--   alter table public.notifications add constraint notifications_type_check
--     check (type in ('comment', 'rsvp', 'event_reminder', 'like', 'upvote',
--                     'connection_request', 'connection_accepted', 'message',
--                     'announcement', 'faculty_decision'));
--   -- rows in the dropped tables are removed with their tables; existing
--   -- public.notifications rows are untouched by this migration either way.
-- =========================================================

-- ---------------------------------------------------------
-- 1. Notification compatibility: additive check extensions
--
-- Dropped and re-added with the FULL previous value list plus the new
-- value, so a hand-migrated database holding an older body still lands
-- on the canonical definition.
-- ---------------------------------------------------------

alter table public.notifications drop constraint if exists notifications_content_type_check;
alter table public.notifications add constraint notifications_content_type_check
  check (
    content_type is null
    or content_type in ('discussion', 'event', 'showcase', 'announcement')
  );

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (
    type in (
      'comment', 'rsvp', 'event_reminder', 'like', 'upvote',
      'connection_request', 'connection_accepted', 'message',
      'announcement', 'faculty_decision', 'event_published'
    )
  );

-- ---------------------------------------------------------
-- 2. Email preference (opt-out), default-on
--
-- No row means enabled: every read coalesces a missing row to true, so
-- there is nothing to backfill and no write path can "forget" a user
-- into a disabled state. The column is the email channel's flag; the
-- table shape extends to future channels without a general framework.
-- ---------------------------------------------------------

create table if not exists public.notification_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  email_enabled boolean not null default true,
  updated_at timestamp with time zone not null default timezone('utc'::text, now())
);

alter table public.notification_preferences enable row level security;

drop policy if exists "Users manage own notification preferences" on public.notification_preferences;
create policy "Users manage own notification preferences"
  on public.notification_preferences
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop trigger if exists trg_update_notification_preferences_updated_at on public.notification_preferences;
create trigger trg_update_notification_preferences_updated_at
  before update on public.notification_preferences
  for each row execute procedure public.update_updated_at_column();

-- ---------------------------------------------------------
-- 3. Email outbox (durable delivery queue)
--
-- Written by the publish trigger in the same transaction as the
-- publication (an email work item can never exist without its publish,
-- and a rolled-back publish leaves no work). Delivered asynchronously
-- by supabase/functions/send-notification-emails, which claims rows via
-- status transitions (pending -> sending -> sent | failed | skipped).
--
-- Idempotency: UNIQUE (source_type, source_id, user_id) makes enqueue
-- ON CONFLICT DO NOTHING deterministic, so trigger re-fires, workflow
-- retries and webhook replays cannot multiply work items.
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

-- The worker sweep reads due rows (pending/failed past next_attempt_at,
-- or stale 'sending' claims) in id order.
create index if not exists notification_email_outbox_due_idx
  on public.notification_email_outbox (next_attempt_at)
  where status in ('pending', 'failed');

-- Recipient-level lookup: "what happened to this user's email?"
create index if not exists notification_email_outbox_user_idx
  on public.notification_email_outbox (user_id, created_at desc);

alter table public.notification_email_outbox enable row level security;

-- No policies on purpose: with RLS enabled and zero policies every
-- anon/authenticated read and write is denied. The explicit revoke also
-- removes the default table privileges Supabase grants those roles, so
-- the denial shows up as a plain permission error instead of an
-- RLS error. service_role keeps its grant — that is the Edge Function.
revoke all on public.notification_email_outbox from anon, authenticated;

drop trigger if exists trg_update_notification_email_outbox_updated_at on public.notification_email_outbox;
create trigger trg_update_notification_email_outbox_updated_at
  before update on public.notification_email_outbox
  for each row execute procedure public.update_updated_at_column();

-- ---------------------------------------------------------
-- 4. Reload PostgREST schema cache
-- ---------------------------------------------------------

notify pgrst, 'reload schema';
