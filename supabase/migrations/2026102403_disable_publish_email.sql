-- =========================================================
-- UCC 2.0 — Android push, part 3: disable new email delivery
-- Date: 2026-10-24
--
-- Forward-only. Historical email rows are NOT deleted and the table is
-- NOT dropped. This migration only:
--   * removes Database Webhook triggers from the email outbox;
--   * blocks every new INSERT into the email outbox, so no database
--     path (old trigger, manual SQL, future code) can enqueue more mail.
--
-- The email worker itself is tombstoned in application code. Re-enabling
-- email requires an explicit future migration that drops
-- trg_block_new_email_enqueue.
-- =========================================================

-- ---------------------------------------------------------
-- 1. Remove Database Webhook triggers on the old outbox
--
-- Supabase Database Webhooks are triggers pointing at functions in the
-- supabase_functions schema. Drop only those, leaving the table's own
-- updated_at trigger intact.
-- ---------------------------------------------------------

do $$
declare
  r record;
begin
  for r in
    select t.tgname
    from pg_trigger t
    join pg_proc p on p.oid = t.tgfoid
    join pg_namespace n on n.oid = p.pronamespace
    where t.tgrelid = 'public.notification_email_outbox'::regclass
      and not t.tgisinternal
      and n.nspname = 'supabase_functions'
  loop
    execute format(
      'drop trigger if exists %I on public.notification_email_outbox',
      r.tgname
    );
  end loop;
end $$;

-- Cover the conventional dashboard-generated names even when the hook
-- function has already been removed from the schema.
drop trigger if exists notify_email_outbox on public.notification_email_outbox;
drop trigger if exists on_notification_email_outbox_insert on public.notification_email_outbox;
drop trigger if exists trg_notify_email_outbox on public.notification_email_outbox;

-- ---------------------------------------------------------
-- 2. Hard stop for new email work
-- ---------------------------------------------------------

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

revoke all on function public.block_new_email_enqueue() from public;
revoke all on function public.block_new_email_enqueue() from anon, authenticated;

comment on table public.notification_email_outbox is
  'HISTORICAL ONLY since 2026102403. New inserts are blocked; android push uses notification_push_outbox.';

comment on function public.block_new_email_enqueue() is
  'Fail-closed guard: email delivery is disabled. Drop this trigger only with an approved re-enable migration.';

notify pgrst, 'reload schema';
