-- =========================================================
-- UCC 2.0 — notification pipeline preflight (READ-ONLY)
-- Date: 2026-10-26
--
-- Run this against the target database before claiming web notifications
-- work, and after applying the notification migrations:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/diagnostics/notification_pipeline_preflight.sql
--
-- It changes nothing. It reports PASS/FAIL for the objects the in-app
-- pipeline needs:
--   notifications table/columns/type constraints
--   emit_notification + publish_recipient_ids
--   announcement/event fan-out triggers
--   dedupe guard + ledger
--   Realtime publication membership
--   owner-scoped RLS policies
--
-- Optionally pass a user id to inspect that user's row counts:
--   -v target_user=<uuid>
-- =========================================================

\pset pager off
\echo '=== Notification pipeline preflight (read-only) ==='

with n as (
  select to_regclass('public.notifications') as oid
),
checks as (
  select 'notifications table' as check_name,
         case when (select oid from n) is not null then 'PASS' else 'FAIL' end as status,
         coalesce((select oid::text from n), 'missing') as detail

  union all
  select 'notifications columns',
         case when (
           select count(*) from information_schema.columns
           where table_schema='public' and table_name='notifications'
             and column_name in ('id','user_id','type','title','body','link','read','created_at','content_type','content_id','dedupe_key')
         ) = 11 then 'PASS' else 'FAIL' end,
         (select count(*)::text || '/11 expected columns'
          from information_schema.columns
          where table_schema='public' and table_name='notifications'
            and column_name in ('id','user_id','type','title','body','link','read','created_at','content_type','content_id','dedupe_key'))

  union all
  select 'type check accepts publish/showcase types',
         case when exists (
           select 1 from pg_constraint
           where conrelid = to_regclass('public.notifications')
             and conname = 'notifications_type_check'
             and pg_get_constraintdef(oid) like '%announcement%'
             and pg_get_constraintdef(oid) like '%event_published%'
             and pg_get_constraintdef(oid) like '%showcase_top2%'
         ) then 'PASS' else 'FAIL' end,
         'notifications_type_check'

  union all
  select 'content_type accepts announcement',
         case when exists (
           select 1 from pg_constraint
           where conrelid = to_regclass('public.notifications')
             and conname = 'notifications_content_type_check'
             and pg_get_constraintdef(oid) like '%announcement%'
         ) then 'PASS' else 'FAIL' end,
         'notifications_content_type_check'

  union all
  select 'emit_notification(uuid,text,text,text,text,text,uuid,text)',
         case when to_regprocedure('public.emit_notification(uuid,text,text,text,text,text,uuid,text)') is not null
              then 'PASS' else 'FAIL' end,
         'SECURITY DEFINER insert path'

  union all
  select 'publish_recipient_ids(uuid)',
         case when to_regprocedure('public.publish_recipient_ids(uuid)') is not null
              then 'PASS' else 'FAIL' end,
         'recipient selection'

  union all
  select 'on_publish_notification()',
         case when to_regprocedure('public.on_publish_notification()') is not null
              then 'PASS' else 'FAIL' end,
         'fan-out trigger function'

  union all
  select 'announcement fan-out trigger',
         case
           when to_regclass('public.announcements') is null then 'FAIL'
           when exists (
             select 1 from pg_trigger t
             join pg_proc p on p.oid = t.tgfoid
             where t.tgrelid = to_regclass('public.announcements')
               and t.tgname = 'trg_publish_fanout_announcement'
               and not t.tgisinternal
               and p.proname = 'on_publish_notification'
           ) then 'PASS' else 'FAIL'
         end,
         'trg_publish_fanout_announcement'

  union all
  select 'event fan-out trigger',
         case
           when to_regclass('public.events') is null then 'FAIL'
           when exists (
             select 1 from pg_trigger t
             join pg_proc p on p.oid = t.tgfoid
             where t.tgrelid = to_regclass('public.events')
               and t.tgname = 'trg_publish_fanout_event'
               and not t.tgisinternal
               and p.proname = 'on_publish_notification'
           ) then 'PASS' else 'FAIL'
         end,
         'trg_publish_fanout_event'

  union all
  select 'dedupe ledger',
         case when to_regclass('public.notification_dedupe_ledger') is not null
              then 'PASS' else 'FAIL' end,
         'notification_dedupe_ledger'

  union all
  select 'dedupe guard trigger',
         case
           when to_regclass('public.notifications') is null then 'FAIL'
           when exists (
             select 1 from pg_trigger
             where tgrelid = to_regclass('public.notifications')
               and tgname = 'trg_guard_notification_dedupe'
               and not tgisinternal
           ) then 'PASS' else 'FAIL'
         end,
         'trg_guard_notification_dedupe'

  union all
  select 'notifications in supabase_realtime publication',
         case when exists (
           select 1 from pg_publication_tables
           where pubname = 'supabase_realtime'
             and schemaname = 'public'
             and tablename = 'notifications'
         ) then 'PASS' else 'FAIL' end,
         'postgres_changes delivery'

  union all
  select 'notifications RLS enabled',
         case when exists (
           select 1 from pg_class
           where oid = to_regclass('public.notifications') and relrowsecurity
         ) then 'PASS' else 'FAIL' end,
         'relrowsecurity'

  union all
  select 'owner-scoped RLS policies',
         case when (
           select count(*) from pg_policies
           where schemaname='public' and tablename='notifications'
             and policyname in ('Users view own notifications','Users can update own notifications')
         ) = 2 then 'PASS' else 'FAIL' end,
         'select + update own rows'

  union all
  select 'notification_push_outbox',
         case when to_regclass('public.notification_push_outbox') is not null
              then 'PASS' else 'FAIL' end,
         'Android push queue (separate from in-app)'
)
select check_name, status, detail
from (
  select check_name, status, detail
  from checks
  union all
  select 'SUMMARY',
         case when exists (select 1 from checks where status = 'FAIL') then 'FAIL' else 'PASS' end,
         case when exists (select 1 from checks where status = 'FAIL')
              then 'one or more required objects are missing'
              else 'all in-app notification objects are present' end
) q
order by case when check_name = 'SUMMARY' then 1 else 0 end, check_name;

-- Aggregate activity only; no notification bodies, titles, links or user ids.
select
  count(*) as total_rows,
  count(*) filter (where read = false) as unread_rows,
  count(*) filter (where created_at > now() - interval '24 hours') as last_24h
from public.notifications;

\if :{?target_user}
\echo '--- target user row counts ---'
select
  count(*) as total_rows,
  count(*) filter (where read = false) as unread_rows,
  max(created_at) as latest_created_at
from public.notifications
where user_id = :'target_user'::uuid;
\endif

\echo '=== end preflight ==='
