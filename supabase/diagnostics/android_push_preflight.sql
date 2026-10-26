-- =========================================================
-- UCC 2.0 — Android push pipeline preflight (READ-ONLY)
-- Date: 2026-10-26
--
-- Run against the target database after applying the push migrations:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/diagnostics/android_push_preflight.sql
--
-- It changes nothing. It checks the database half of the pipeline:
--   push outbox shape/RLS, push preference, fan-out triggers,
--   the INSERT webhook trigger, a push cron job if pg_cron is installed,
--   and the current outbox status distribution.
--
-- It cannot verify the OneSignal/FCM dashboard, the Edge Function secrets,
-- or the Android build. Those require the operator checks in
-- docs/android-push-notifications-deployment.md.
-- =========================================================

\pset pager off
\echo '=== Android push pipeline preflight (read-only) ==='

with o as (
  select to_regclass('public.notification_push_outbox') as oid
),
checks as (
  select 'push outbox table' as check_name,
         case when (select oid from o) is not null then 'PASS' else 'FAIL' end as status,
         coalesce((select oid::text from o), 'missing') as detail

  union all
  select 'push outbox columns',
         case when (
           select count(*) from information_schema.columns
           where table_schema='public' and table_name='notification_push_outbox'
             and column_name in (
               'id','notification_id','user_id','source_type','source_id','status',
               'attempts','last_error','next_attempt_at','locked_at','provider',
               'provider_message_id','sent_at','created_at','updated_at','finished_at'
             )
         ) = 16 then 'PASS' else 'FAIL' end,
         (select count(*)::text || '/16 expected columns'
          from information_schema.columns
          where table_schema='public' and table_name='notification_push_outbox'
            and column_name in (
              'id','notification_id','user_id','source_type','source_id','status',
              'attempts','last_error','next_attempt_at','locked_at','provider',
              'provider_message_id','sent_at','created_at','updated_at','finished_at'
            ))

  union all
  select 'push preference column',
         case when exists (
           select 1 from information_schema.columns
           where table_schema='public' and table_name='notification_preferences'
             and column_name='push_enabled'
         ) then 'PASS' else 'FAIL' end,
         'notification_preferences.push_enabled'

  union all
  select 'notification publish types',
         case when exists (
           select 1 from pg_constraint
           where conrelid = to_regclass('public.notifications')
             and conname = 'notifications_type_check'
             and pg_get_constraintdef(oid) like '%event_published%'
             and pg_get_constraintdef(oid) like '%announcement%'
             and pg_get_constraintdef(oid) like '%showcase_top2%'
         ) then 'PASS' else 'FAIL' end,
         'notifications_type_check includes push types'

  union all
  select 'announcement push fan-out trigger',
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
  select 'event push fan-out trigger',
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
  select 'push outbox RLS',
         case when exists (
           select 1 from pg_class
           where oid = to_regclass('public.notification_push_outbox') and relrowsecurity
         ) then 'PASS' else 'FAIL' end,
         'relrowsecurity'

  union all
  select 'push outbox client lockout',
         case
           when (select oid from o) is null then 'FAIL'
           when not has_table_privilege('authenticated','public.notification_push_outbox','SELECT')
            and not has_table_privilege('authenticated','public.notification_push_outbox','INSERT')
            and not has_table_privilege('authenticated','public.notification_push_outbox','UPDATE')
            and not has_table_privilege('authenticated','public.notification_push_outbox','DELETE')
           then 'PASS' else 'FAIL'
         end,
         'authenticated has no direct outbox access'

  union all
  select 'push INSERT webhook trigger',
         case
           when (select oid from o) is null then 'FAIL'
           when exists (
             select 1
             from pg_trigger t
             join pg_proc p on p.oid = t.tgfoid
             join pg_namespace n on n.oid = p.pronamespace
             where t.tgrelid = to_regclass('public.notification_push_outbox')
               and not t.tgisinternal
               -- AFTER INSERT only; this must not match the table's own
               -- BEFORE UPDATE updated_at trigger.
               and (t.tgtype & 2) = 0
               and (t.tgtype & 4) = 4
               and (
                 n.nspname = 'supabase_functions'
                 or p.proname = 'http_request'
                 or t.tgname in (
                   'push-outbox-insert',
                   'on_notification_push_outbox_insert',
                   'notify_push_outbox',
                   'trg_push_outbox_insert'
                 )
               )
           ) then 'PASS'
           else 'WARN'
         end,
         'Database Webhook on INSERT (a cron sweep can substitute)'
)
select check_name, status, detail
from (
  select check_name, status, detail from checks
  union all
  select 'SUMMARY',
         case when exists (select 1 from checks where status = 'FAIL') then 'FAIL' else 'PASS' end,
         case when exists (select 1 from checks where status = 'FAIL')
              then 'required push objects are missing'
              else 'push database objects are present; verify worker + device separately' end
) q
order by case when check_name = 'SUMMARY' then 1 else 0 end, check_name;

\echo '--- outbox status distribution ---'
select status, count(*) as rows
from public.notification_push_outbox
group by status
order by status;

\echo '--- due work (pending/failed) ---'
select
  count(*) filter (where status = 'pending') as pending,
  count(*) filter (where status = 'failed') as failed,
  count(*) filter (where status in ('pending','failed') and next_attempt_at <= now()) as due_now,
  min(next_attempt_at) filter (where status in ('pending','failed')) as oldest_due
from public.notification_push_outbox;

\echo '--- terminal skip/failure reasons (top 5) ---'
select
  left(coalesce(last_error, '(none)'), 140) as last_error,
  count(*) as rows
from public.notification_push_outbox
where status in ('skipped','failed')
group by 1
order by 2 desc
limit 5;

\echo '--- notification preference opt-outs ---'
select count(*) filter (where push_enabled = false) as push_disabled,
       count(*) as preference_rows
from public.notification_preferences;

\echo '--- push sweep cron (notice only) ---'
do $$
declare
  v_total integer;
  v_active integer;
begin
  if to_regclass('cron.job') is null then
    raise notice 'pg_cron is not installed; use an external scheduler or pg_cron + pg_net for retries';
  else
    execute $q$
      select count(*), count(*) filter (where active)
      from cron.job
      where command ilike '%send-push-notifications%' or jobname ilike '%push%'
    $q$ into v_total, v_active;
    raise notice 'push sweep cron jobs: % total, % active', v_total, v_active;
  end if;
end $$;

\echo '--- operator-only checks (not visible to SQL) ---'
\echo '  1. EXPO_PUBLIC_ONESIGNAL_APP_ID is set in the release build (or app.json extra.onesignalAppId)'
\echo '  2. OneSignal External ID on the device equals the Supabase user UUID'
\echo '  3. Device permission granted and OneSignal subscription is SUBSCRIBED'
\echo '  4. PUSH_HOOK_SECRET, ONESIGNAL_APP_ID, ONESIGNAL_REST_API_KEY set and worker deployed'
\echo '=== end preflight ==='
