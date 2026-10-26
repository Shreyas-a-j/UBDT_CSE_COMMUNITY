-- =========================================================
-- UCC 2.0 — publish fan-out + Android push SQL tests
--
-- Covers the acceptance criteria for the push migration:
--   * one in-app notification per eligible recipient, idempotent
--   * exactly one push-outbox row per in-app notification
--   * push opt-out suppresses push but preserves the in-app row
--   * updates (edits) never publish
--   * eligibility: confirmed email, not banned/deleted, not the publisher
--   * new email enqueue is blocked; historical rows are retained
--   * showcase top-two: owner-only, once per distinct tenure, no repeat on
--     recalculation, genuine leave/re-entry gets a new notification
--   * outboxes/tenures are invisible and unwritable to clients; fan-out
--     functions are not callable by clients
--   * existing notification RLS still denies cross-user read/write
--   * anon cannot publish announcements or events
--
-- Style: every section is its own do-block (= its own transaction);
-- fixtures are created and destroyed inside the block; expected
-- rejections run inside nested subtransactions (begin/exception) so they
-- never invalidate the rest. The script never disables or weakens a
-- security trigger or policy.
--
-- FIXTURES are auth-backed (public.profiles.id references auth.users),
-- created by inserting an auth.users row (which provisions a profile via
-- handle_new_user()). Synthetic emails are prefixed 'notif-' or
-- 'showcase-' so the rehearsal can sweep residue.
--
-- NOTE ON \echo: psql meta-command; in the Supabase SQL Editor delete or
-- comment out every line beginning with '\'. All SQL below is plain.
-- =========================================================

\echo '========================================================'
\echo 'Publish fan-out — notifications, push outbox, email block'
\echo '========================================================'

-- ---------------------------------------------------------
-- PRECONDITIONS
-- ---------------------------------------------------------
\echo ''
\echo 'PRECONDITIONS: push schema objects present'
do $$
declare
  v_def text;
begin
  if to_regclass('public.notification_preferences') is null then
    raise exception 'PRECONDITION FAILED: notification_preferences missing';
  end if;
  if to_regclass('public.notification_email_outbox') is null then
    raise exception 'PRECONDITION FAILED: notification_email_outbox missing';
  end if;
  if to_regclass('public.notification_push_outbox') is null then
    raise exception 'PRECONDITION FAILED: run 2026102401_android_push_schema.sql first (notification_push_outbox missing)';
  end if;
  if to_regclass('public.showcase_top_entries') is null then
    raise exception 'PRECONDITION FAILED: run 2026102401_android_push_schema.sql first (showcase_top_entries missing)';
  end if;

  select pg_get_constraintdef(c.oid, true) into v_def
  from pg_constraint c
  where c.conrelid = 'public.notifications'::regclass
    and c.conname = 'notifications_content_type_check';
  if v_def is null or v_def not ilike '%''announcement''%' then
    raise exception 'PRECONDITION FAILED: notifications_content_type_check does not accept announcement';
  end if;

  select pg_get_constraintdef(c.oid, true) into v_def
  from pg_constraint c
  where c.conrelid = 'public.notifications'::regclass
    and c.conname = 'notifications_type_check';
  if v_def is null
     or v_def not ilike '%''event_published''%'
     or v_def not ilike '%''showcase_top2''%' then
    raise exception 'PRECONDITION FAILED: run 2026102401 first (notifications_type_check must accept event_published and showcase_top2)';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'notification_preferences'
      and column_name = 'push_enabled'
  ) then
    raise exception 'PRECONDITION FAILED: notification_preferences.push_enabled missing';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.notification_email_outbox'::regclass
      and tgname = 'trg_block_new_email_enqueue'
      and tgenabled <> 'D'
  ) then
    raise exception 'PRECONDITION FAILED: run 2026102403 first (email enqueue guard missing)';
  end if;
end $$;
\echo '  OK'

-- ---------------------------------------------------------
-- PROBE
-- ---------------------------------------------------------
\echo 'PROBE: auth.users fixture capability + role switch'
do $$
declare
  v_id uuid := gen_random_uuid();
  v_err text := null;
  v_can_switch boolean := false;
begin
  begin
    insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
    values (v_id, 'notif-probe-' || gen_random_uuid()::text || '@example.com',
            encode(gen_random_bytes(16), 'base64'), now(), '{}'::jsonb, now(), now());
  exception when others then
    v_err := sqlerrm;
  end;
  if v_err is not null then
    raise exception 'PRECONDITION FAILED: this session cannot INSERT into auth.users (%)', v_err;
  end if;
  delete from auth.users where id = v_id;

  begin
    set local role anon;
    v_can_switch := true;
  exception when others then
    v_can_switch := false;
  end;
  if not v_can_switch then
    raise exception 'PRECONDITION FAILED: SET ROLE unavailable — the RLS deny-direction assertions in this suite cannot run';
  end if;
  reset role;
end $$;
\echo '  OK'

-- ---------------------------------------------------------
-- TEST 1: constraint extensions
-- ---------------------------------------------------------
\echo ''
\echo 'TEST 1: notification constraint extensions'
do $test$
declare
  v_user uuid;
  v_n uuid;
begin
  v_user := gen_random_uuid();
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
  values (v_user, 'notif-t1-' || gen_random_uuid()::text || '@example.com',
          encode(gen_random_bytes(16), 'base64'), now(), '{}'::jsonb, now(), now());

  begin
    insert into public.notifications (user_id, type, title, body, link, content_type, content_id, dedupe_key)
    values (v_user, 'showcase_top2', 'T1 showcase', 'body', '/#showcase-x', 'showcase', gen_random_uuid(), 't1-showcase')
    returning id into v_n;
  exception when check_violation then
    raise exception 'FAIL: type showcase_top2 or content_type showcase rejected by check constraints';
  end;
  delete from public.notifications where id = v_n;

  begin
    insert into public.notifications (user_id, type, title, body, link, content_type, content_id, dedupe_key)
    values (v_user, 'event_published', 'T1 publish', 'body', '/x', 'announcement', gen_random_uuid(), 't1-new-shape')
    returning id into v_n;
  exception when check_violation then
    raise exception 'FAIL: type event_published or content_type announcement rejected by check constraints';
  end;
  delete from public.notifications where id = v_n;

  begin
    insert into public.notifications (user_id, type, title, content_type, content_id, dedupe_key)
    values (v_user, 'comment', 'T1 legacy comment', 'discussion', gen_random_uuid(), 't1-legacy-1')
    returning id into v_n;
  exception when check_violation then
    raise exception 'FAIL: legacy type comment or content_type discussion no longer accepted';
  end;
  delete from public.notifications where id = v_n;

  begin
    insert into public.notifications (user_id, type, title, content_type, content_id, dedupe_key)
    values (v_user, 'announcement', 'T1 legacy announcement', 'event', gen_random_uuid(), 't1-legacy-2')
    returning id into v_n;
  exception when check_violation then
    raise exception 'FAIL: legacy content_type event no longer accepted';
  end;
  delete from public.notifications where id = v_n;

  delete from auth.users where id = v_user;
  raise notice 'PASS 1: constraint extensions accept push values, legacy values intact';
end $test$;

-- ---------------------------------------------------------
-- TEST 2: notification_preferences
-- ---------------------------------------------------------
\echo ''
\echo 'TEST 2: push preference schema + own-row RLS'
do $test$
declare
  v_a uuid := gen_random_uuid();
  v_b uuid := gen_random_uuid();
  v_touched uuid;
  v_email boolean;
  v_push boolean;
  n int;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
  values (v_a, 'notif-t2-a-' || gen_random_uuid()::text || '@example.com',
          encode(gen_random_bytes(16), 'base64'), now(), '{}'::jsonb, now(), now()),
         (v_b, 'notif-t2-b-' || gen_random_uuid()::text || '@example.com',
          encode(gen_random_bytes(16), 'base64'), now(), '{}'::jsonb, now(), now());

  insert into public.notification_preferences (user_id) values (v_a);
  select email_enabled, push_enabled into v_email, v_push
  from public.notification_preferences where user_id = v_a;

  if v_email is distinct from true then
    raise exception 'FAIL: notification_preferences.email_enabled must default to true';
  end if;
  if v_push is distinct from true then
    raise exception 'FAIL: notification_preferences.push_enabled must default to true (missing row = enabled)';
  end if;

  insert into public.notification_preferences (user_id, push_enabled) values (v_b, false);

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', v_a::text, true);

  select count(*) into n from public.notification_preferences where user_id = v_b;
  if n <> 0 then
    raise exception 'FAIL: user A can SELECT user B''s notification preference (RLS leak)';
  end if;

  update public.notification_preferences set push_enabled = true where user_id = v_b
  returning user_id into v_touched;
  if v_touched is not null then
    raise exception 'FAIL: user A can UPDATE user B''s notification preference';
  end if;

  delete from public.notification_preferences where user_id = v_b
  returning user_id into v_touched;
  if v_touched is not null then
    raise exception 'FAIL: user A can DELETE user B''s notification preference';
  end if;

  update public.notification_preferences set push_enabled = false where user_id = v_a
  returning user_id into v_touched;
  if v_touched is null then
    raise exception 'FAIL: user A cannot update their own push preference';
  end if;

  set local role anon;
  perform set_config('request.jwt.claim.sub', '', true);
  select count(*) into n from public.notification_preferences;
  if n <> 0 then
    raise exception 'FAIL: anon can read % notification preference rows (expected 0)', n;
  end if;

  reset role;
  delete from auth.users where id in (v_a, v_b);
  raise notice 'PASS 2: push preference default-on, own-row RLS holds';
end $test$;

-- ---------------------------------------------------------
-- TEST 3: push outbox shape, uniqueness, client invisibility
-- ---------------------------------------------------------
\echo ''
\echo 'TEST 3: push outbox shape, uniqueness, client invisibility'
do $test$
declare
  v_user uuid := gen_random_uuid();
  v_src uuid := gen_random_uuid();
  v_notif uuid;
  v_notif2 uuid;
  v_outbox uuid;
  v_dup int;
  v_err text;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
  values (v_user, 'notif-t3-' || gen_random_uuid()::text || '@example.com',
          encode(gen_random_bytes(16), 'base64'), now(), '{}'::jsonb, now(), now());

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'notification_push_outbox'
      and column_name = 'status' and column_default like '%pending%'
  ) then
    raise exception 'FAIL: notification_push_outbox.status missing or not defaulting to pending';
  end if;
  if coalesce((
    select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'notification_push_outbox'
      and column_name in ('source_type','source_id','user_id','attempts','last_error',
                          'next_attempt_at','locked_at','provider','provider_message_id',
                          'created_at','updated_at','sent_at')
  ), 0) <> 12 then
    raise exception 'FAIL: notification_push_outbox is missing worker columns';
  end if;

  insert into public.notifications (user_id, type, title, body, dedupe_key)
  values (v_user, 'announcement', 'T3 notification', 'body', 't3-notification')
  returning id into v_notif;
  insert into public.notifications (user_id, type, title, body, dedupe_key)
  values (v_user, 'announcement', 'T3 notification 2', 'body', 't3-notification-2')
  returning id into v_notif2;

  insert into public.notification_push_outbox (notification_id, user_id, source_type, source_id)
  values (v_notif, v_user, 'announcement', v_src)
  returning id into v_outbox;

  if v_outbox is null then
    raise exception 'FAIL: push outbox did not assign a UUID idempotency key';
  end if;

  begin
    insert into public.notification_push_outbox (notification_id, user_id, source_type, source_id)
    values (v_notif, v_user, 'event', v_src);
    raise exception 'FAIL: push outbox accepted two rows for one notification_id';
  exception when unique_violation then
    null;
  end;

  begin
    insert into public.notification_push_outbox (notification_id, user_id, source_type, source_id, status)
    values (v_notif2, v_user, 'announcement', v_src, 'bogus');
    raise exception 'FAIL: push outbox accepted an unknown status';
  exception when check_violation then
    null;
  end;

  begin
    insert into public.notification_push_outbox (notification_id, user_id, source_type, source_id)
    values (v_notif2, v_user, 'discussion', v_src);
    raise exception 'FAIL: push outbox accepted source_type discussion';
  exception when check_violation then
    null;
  end;

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', v_user::text, true);
  begin
    select count(*) into v_dup from public.notification_push_outbox;
    raise exception 'FAIL: authenticated client can SELECT the push outbox (got % rows)', v_dup;
  exception when insufficient_privilege then
    null;
  end;
  begin
    insert into public.notification_push_outbox (notification_id, user_id, source_type, source_id)
    values (v_notif2, v_user, 'event', gen_random_uuid());
    raise exception 'FAIL: authenticated client can INSERT into the push outbox';
  exception when insufficient_privilege or check_violation then
    null;
  end;
  reset role;

  set local role anon;
  begin
    select count(*) into v_dup from public.notification_push_outbox;
    raise exception 'FAIL: anon can SELECT the push outbox';
  exception when insufficient_privilege then
    null;
  end;
  reset role;

  delete from auth.users where id = v_user;
  raise notice 'PASS 3: push outbox shape, one-per-notification, client lockout';
end $test$;

-- ---------------------------------------------------------
-- TEST 4: announcement publication fans out in-app + push
-- ---------------------------------------------------------
\echo ''
\echo 'TEST 4: announcement publish fan-out (push, no email)'
do $test$
declare
  v_publisher uuid := gen_random_uuid();
  v_a uuid := gen_random_uuid();
  v_b uuid := gen_random_uuid();
  v_unconfirmed uuid := gen_random_uuid();
  v_banned uuid := gen_random_uuid();
  v_expired_ban uuid := gen_random_uuid();
  v_deleted uuid := gen_random_uuid();
  v_ann uuid;
  n int;
  v_users text;
  v_expected text;
  v_expected_ids uuid[];
  v_expected_push text;
  v_email int;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
  values
    (v_publisher, 'notif-t4-pub-' || gen_random_uuid()::text || '@example.com', encode(gen_random_bytes(16),'base64'), now(), '{}'::jsonb, now(), now()),
    (v_a,        'notif-t4-a-'    || gen_random_uuid()::text || '@example.com', encode(gen_random_bytes(16),'base64'), now(), '{}'::jsonb, now(), now()),
    (v_b,        'notif-t4-b-'    || gen_random_uuid()::text || '@example.com', encode(gen_random_bytes(16),'base64'), now(), '{}'::jsonb, now(), now()),
    (v_unconfirmed, 'notif-t4-u-' || gen_random_uuid()::text || '@example.com', encode(gen_random_bytes(16),'base64'), null,  '{}'::jsonb, now(), now()),
    (v_banned,   'notif-t4-ban-'  || gen_random_uuid()::text || '@example.com', encode(gen_random_bytes(16),'base64'), now(), '{}'::jsonb, now(), now()),
    (v_expired_ban, 'notif-t4-exp-' || gen_random_uuid()::text || '@example.com', encode(gen_random_bytes(16),'base64'), now(), '{}'::jsonb, now(), now()),
    (v_deleted,  'notif-t4-del-'  || gen_random_uuid()::text || '@example.com', encode(gen_random_bytes(16),'base64'), now(), '{}'::jsonb, now(), now());

  update auth.users set banned_until = now() + interval '1 day' where id = v_banned;
  update auth.users set banned_until = now() - interval '1 day' where id = v_expired_ban;
  update auth.users set deleted_at = now() where id = v_deleted;

  -- A opts out of push; B keeps the default. The in-app row must still
  -- reach both; only the push row is suppressed for A.
  insert into public.notification_preferences (user_id, push_enabled) values (v_a, false);

  insert into public.announcements (author_id, title, body)
  values (v_publisher, 'T4 announcement ' || gen_random_uuid()::text, 'fan-out body')
  returning id into v_ann;

  select coalesce(array_agg(s.eligible), '{}') into v_expected_ids
  from (
    select p.id as eligible
    from public.profiles p
    join auth.users u on u.id = p.id
    where u.email_confirmed_at is not null
      and (u.banned_until is null or u.banned_until <= now())
      and u.deleted_at is null
    except
    select v_publisher
  ) s;
  select string_agg(x::text, ',' order by x::text) into v_expected
  from unnest(v_expected_ids) x;
  select string_agg(x::text, ',' order by x::text) into v_expected_push
  from unnest(v_expected_ids) x where x <> v_a;

  select count(*), string_agg(user_id::text, ',' order by user_id::text)
  into n, v_users
  from public.notifications
  where dedupe_key = 'publish:announcement:' || v_ann;

  if n <> coalesce(array_length(v_expected_ids, 1), 0) then
    raise exception 'FAIL: announcement fan-out produced % in-app rows; expected %', n, coalesce(array_length(v_expected_ids, 1), 0);
  end if;
  if v_users is distinct from v_expected then
    raise exception 'FAIL: announcement in-app recipients mismatch: got % expected %', v_users, v_expected;
  end if;

  if exists (
    select 1 from public.notifications
    where dedupe_key = 'publish:announcement:' || v_ann
      and (type <> 'announcement'
           or content_type is distinct from 'announcement'
           or content_id is distinct from v_ann
           or link is distinct from '/announcements#announcement-' || v_ann
           or read)
  ) then
    raise exception 'FAIL: announcement publish notification has wrong shape';
  end if;

  if exists (
    select 1 from public.notifications
    where dedupe_key = 'publish:announcement:' || v_ann
      and user_id in (v_publisher, v_unconfirmed, v_banned, v_deleted)
  ) then
    raise exception 'FAIL: ineligible recipient received an announcement notification';
  end if;

  select count(*), string_agg(o.user_id::text, ',' order by o.user_id::text)
  into n, v_users
  from public.notification_push_outbox o
  join public.notifications ntf on ntf.id = o.notification_id
  where ntf.dedupe_key = 'publish:announcement:' || v_ann;

  if n <> coalesce(array_length(v_expected_ids, 1), 0) - 1 then
    raise exception 'FAIL: announcement push enqueue produced % rows; expected % (all eligible except opt-out A)', n, coalesce(array_length(v_expected_ids, 1), 0) - 1;
  end if;
  if v_users is distinct from v_expected_push then
    raise exception 'FAIL: push recipients mismatch: got % expected %', v_users, v_expected_push;
  end if;
  if exists (
    select 1 from public.notification_push_outbox
    where source_type = 'announcement' and source_id = v_ann
      and (status <> 'pending' or attempts <> 0 or provider <> 'onesignal')
  ) then
    raise exception 'FAIL: push rows must start pending, 0 attempts, provider onesignal';
  end if;
  if exists (
    select 1 from public.notification_push_outbox
    where source_type = 'announcement' and source_id = v_ann and user_id = v_a
  ) then
    raise exception 'FAIL: push-disabled recipient A received a push row';
  end if;

  select count(*) into v_email
  from public.notification_email_outbox
  where source_type = 'announcement' and source_id = v_ann;
  if v_email <> 0 then
    raise exception 'FAIL: email outbox received % rows after email was disabled', v_email;
  end if;

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', v_a::text, true);
  select count(*) into n from public.notifications where user_id = v_b;
  if n <> 0 then
    raise exception 'FAIL: user A can read % of user B''s notifications (RLS leak)', n;
  end if;
  reset role;

  -- Remove fan-out rows written to seeded members; fixture-recipient rows
  -- disappear with their profiles. The retention FK detaches outbox rows
  -- instead of cascading, so remove the push rows and dedupe ledger first.
  delete from public.notification_push_outbox
  where source_type = 'announcement' and source_id = v_ann;
  delete from public.notification_dedupe_ledger
  where dedupe_key = 'publish:announcement:' || v_ann;
  delete from public.notifications
  where dedupe_key = 'publish:announcement:' || v_ann;

  delete from auth.users
  where id in (v_publisher, v_a, v_b, v_unconfirmed, v_banned, v_expired_ban, v_deleted);
  raise notice 'PASS 4: announcement fan-out pushes to eligible opted-in recipients only; A in-app only; no email';
end $test$;

-- ---------------------------------------------------------
-- TEST 5: event publication fans out in-app + push
-- ---------------------------------------------------------
\echo ''
\echo 'TEST 5: event publish fan-out (push, no email)'
do $test$
declare
  v_host uuid := gen_random_uuid();
  v_a uuid := gen_random_uuid();
  v_unconfirmed uuid := gen_random_uuid();
  v_banned uuid := gen_random_uuid();
  v_event uuid;
  n int;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
  values
    (v_host,       'notif-t5-h-' || gen_random_uuid()::text || '@example.com', encode(gen_random_bytes(16),'base64'), now(), '{}'::jsonb, now(), now()),
    (v_a,          'notif-t5-a-' || gen_random_uuid()::text || '@example.com', encode(gen_random_bytes(16),'base64'), now(), '{}'::jsonb, now(), now()),
    (v_unconfirmed,'notif-t5-u-' || gen_random_uuid()::text || '@example.com', encode(gen_random_bytes(16),'base64'), null,  '{}'::jsonb, now(), now()),
    (v_banned,     'notif-t5-b-' || gen_random_uuid()::text || '@example.com', encode(gen_random_bytes(16),'base64'), now(), '{}'::jsonb, now(), now());

  update auth.users set banned_until = now() + interval '1 day' where id = v_banned;

  insert into public.events (host_id, title, description, type, event_date, event_time)
  values (v_host, 'T5 event ' || gen_random_uuid()::text, 'fan-out body', 'Workshop', current_date + 7, '10:00')
  returning id into v_event;

  if not exists (
    select 1 from public.notifications
    where dedupe_key = 'publish:event:' || v_event and user_id = v_a
  ) then
    raise exception 'FAIL: eligible member A did not receive the event notification';
  end if;

  if exists (
    select 1 from public.notifications
    where dedupe_key = 'publish:event:' || v_event
      and (type <> 'event_published'
           or content_type is distinct from 'event'
           or content_id is distinct from v_event
           or link is distinct from '/#event-' || v_event
           or read)
  ) then
    raise exception 'FAIL: event publish notification has wrong shape';
  end if;

  if exists (
    select 1 from public.notifications
    where dedupe_key = 'publish:event:' || v_event
      and user_id in (v_host, v_unconfirmed, v_banned)
  ) then
    raise exception 'FAIL: ineligible recipient received an event notification';
  end if;

  select count(*) into n
  from public.notification_push_outbox
  where source_type = 'event' and source_id = v_event and user_id = v_a;
  if n <> 1 then
    raise exception 'FAIL: event enqueue produced % push rows for A; expected 1', n;
  end if;

  if exists (
    select 1 from public.notification_push_outbox
    where source_type = 'event' and source_id = v_event
      and user_id in (v_host, v_unconfirmed, v_banned)
  ) then
    raise exception 'FAIL: ineligible recipient has an event push row';
  end if;

  if exists (
    select 1 from public.notification_email_outbox
    where source_type = 'event' and source_id = v_event
  ) then
    raise exception 'FAIL: event publication created email rows while email is disabled';
  end if;

  delete from public.notification_push_outbox
  where source_type = 'event' and source_id = v_event;
  delete from public.notification_dedupe_ledger
  where dedupe_key = 'publish:event:' || v_event;
  delete from public.notifications
  where dedupe_key = 'publish:event:' || v_event;

  delete from auth.users where id in (v_host, v_a, v_unconfirmed, v_banned);
  raise notice 'PASS 5: event fan-out pushes to eligible recipients; host/unverified/banned excluded; no email';
end $test$;

-- ---------------------------------------------------------
-- TEST 6: UPDATEs (edits) never publish
-- ---------------------------------------------------------
\echo ''
\echo 'TEST 6: updates create no publish notifications or pushes'
do $test$
declare
  v_publisher uuid := gen_random_uuid();
  v_a uuid := gen_random_uuid();
  v_ann uuid;
  v_event uuid;
  v_n_before int;
  v_o_before int;
  v_n_after int;
  v_o_after int;
  v_expected_count int;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
  values
    (v_publisher, 'notif-t6-p-' || gen_random_uuid()::text || '@example.com', encode(gen_random_bytes(16),'base64'), now(), '{}'::jsonb, now(), now()),
    (v_a,         'notif-t6-a-' || gen_random_uuid()::text || '@example.com', encode(gen_random_bytes(16),'base64'), now(), '{}'::jsonb, now(), now());

  insert into public.announcements (author_id, title, body)
  values (v_publisher, 'T6 announcement', 'body') returning id into v_ann;
  insert into public.events (host_id, title, description, type, event_date, event_time)
  values (v_publisher, 'T6 event', 'body', 'Seminar', current_date + 3, '11:00') returning id into v_event;

  select count(*) into v_expected_count
  from (
    select p.id
    from public.profiles p
    join auth.users u on u.id = p.id
    where u.email_confirmed_at is not null
      and (u.banned_until is null or u.banned_until <= now())
      and u.deleted_at is null
    except
    select v_publisher
  ) s;

  select count(*) into v_n_before from public.notifications
  where dedupe_key in ('publish:announcement:' || v_ann, 'publish:event:' || v_event);
  select count(*) into v_o_before from public.notification_push_outbox
  where (source_type, source_id) in (('announcement', v_ann), ('event', v_event));

  if v_n_before <> 2 * v_expected_count or v_o_before <> 2 * v_expected_count then
    raise exception 'FAIL: precondition — expected % in-app and % push rows after inserts, got % and %',
      2 * v_expected_count, 2 * v_expected_count, v_n_before, v_o_before;
  end if;

  update public.announcements set title = 'T6 announcement edited', body = 'edited' where id = v_ann;
  update public.events set title = 'T6 event edited', description = 'edited' where id = v_event;

  select count(*) into v_n_after from public.notifications
  where dedupe_key in ('publish:announcement:' || v_ann, 'publish:event:' || v_event);
  select count(*) into v_o_after from public.notification_push_outbox
  where (source_type, source_id) in (('announcement', v_ann), ('event', v_event));

  if v_n_after <> v_n_before then
    raise exception 'FAIL: editing created new publish notifications (% -> %)', v_n_before, v_n_after;
  end if;
  if v_o_after <> v_o_before then
    raise exception 'FAIL: editing created new push rows (% -> %)', v_o_before, v_o_after;
  end if;
  if exists (
    select 1 from public.notification_email_outbox
    where (source_type, source_id) in (('announcement', v_ann), ('event', v_event))
  ) then
    raise exception 'FAIL: editing enqueued email';
  end if;

  delete from public.notification_push_outbox
  where (source_type = 'announcement' and source_id = v_ann)
     or (source_type = 'event' and source_id = v_event);
  delete from public.notification_dedupe_ledger
  where dedupe_key in ('publish:announcement:' || v_ann, 'publish:event:' || v_event);
  delete from public.notifications
  where dedupe_key in ('publish:announcement:' || v_ann, 'publish:event:' || v_event);

  delete from auth.users where id in (v_publisher, v_a);
  raise notice 'PASS 6: announcement and event edits created no publish or push rows';
end $test$;

-- ---------------------------------------------------------
-- TEST 7: duplicate trigger execution is idempotent
-- ---------------------------------------------------------
\echo ''
\echo 'TEST 7: double trigger fire is idempotent'
do $test$
declare
  v_host uuid := gen_random_uuid();
  v_a uuid := gen_random_uuid();
  v_ann uuid;
  v_event uuid;
  v_n int;
  v_o int;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
  values
    (v_host, 'notif-t7-h-' || gen_random_uuid()::text || '@example.com', encode(gen_random_bytes(16),'base64'), now(), '{}'::jsonb, now(), now()),
    (v_a,    'notif-t7-a-' || gen_random_uuid()::text || '@example.com', encode(gen_random_bytes(16),'base64'), now(), '{}'::jsonb, now(), now());

  drop trigger if exists trg_publish_fanout_dup_test on public.announcements;
  create trigger trg_publish_fanout_dup_test
    after insert on public.announcements
    for each row execute procedure public.on_publish_notification();
  drop trigger if exists trg_publish_fanout_dup_test on public.events;
  create trigger trg_publish_fanout_dup_test
    after insert on public.events
    for each row execute procedure public.on_publish_notification();

  insert into public.announcements (author_id, title, body)
  values (v_host, 'T7 announcement', 'body') returning id into v_ann;
  insert into public.events (host_id, title, description, type, event_date, event_time)
  values (v_host, 'T7 event', 'body', 'Meeting', current_date + 5, '09:30') returning id into v_event;

  select count(*) into v_n from public.notifications
  where user_id = v_a and dedupe_key = 'publish:announcement:' || v_ann;
  if v_n <> 1 then
    raise exception 'FAIL: double-fired announcement fan-out produced % in-app rows for A; expected 1', v_n;
  end if;

  select count(*) into v_n from public.notifications
  where user_id = v_a and dedupe_key = 'publish:event:' || v_event;
  if v_n <> 1 then
    raise exception 'FAIL: double-fired event fan-out produced % in-app rows for A; expected 1', v_n;
  end if;

  select count(*) into v_o from public.notification_push_outbox
  where (source_type, source_id, user_id) in
        (('announcement', v_ann, v_a), ('event', v_event, v_a));
  if v_o <> 2 then
    raise exception 'FAIL: double-fired enqueue produced % push rows for A; expected 2 (one per source)', v_o;
  end if;

  drop trigger if exists trg_publish_fanout_dup_test on public.announcements;
  drop trigger if exists trg_publish_fanout_dup_test on public.events;

  delete from public.notification_push_outbox
  where (source_type = 'announcement' and source_id = v_ann)
     or (source_type = 'event' and source_id = v_event);
  delete from public.notification_dedupe_ledger
  where dedupe_key in ('publish:announcement:' || v_ann, 'publish:event:' || v_event);
  delete from public.notifications
  where dedupe_key in ('publish:announcement:' || v_ann, 'publish:event:' || v_event);

  delete from auth.users where id in (v_host, v_a);
  raise notice 'PASS 7: duplicate trigger fire collapsed to one in-app row and one push row per source';
end $test$;

-- ---------------------------------------------------------
-- TEST 8: security
-- ---------------------------------------------------------
\echo ''
\echo 'TEST 8: fan-out/security and client lockout'
do $test$
declare
  v_student uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
  values
    (v_student, 'notif-t8-s-' || gen_random_uuid()::text || '@example.com', encode(gen_random_bytes(16),'base64'), now(), '{}'::jsonb, now(), now()),
    (v_other,   'notif-t8-o-' || gen_random_uuid()::text || '@example.com', encode(gen_random_bytes(16),'base64'), now(), '{}'::jsonb, now(), now());

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', v_student::text, true);

  begin
    perform public.publish_recipient_ids(null);
    raise exception 'FAIL: authenticated can execute public.publish_recipient_ids';
  exception when insufficient_privilege then
    null;
  end;

  begin
    perform public.on_publish_notification();
    raise exception 'FAIL: authenticated can execute public.on_publish_notification';
  exception when insufficient_privilege then
    null;
  end;

  begin
    perform public.recompute_showcase_top2();
    raise exception 'FAIL: authenticated can execute public.recompute_showcase_top2';
  exception when insufficient_privilege then
    null;
  end;

  begin
    perform public.on_showcase_ranking_change();
    raise exception 'FAIL: authenticated can execute public.on_showcase_ranking_change';
  exception when insufficient_privilege then
    null;
  end;

  begin
    perform public.block_new_email_enqueue();
    raise exception 'FAIL: authenticated can execute public.block_new_email_enqueue';
  exception when insufficient_privilege then
    null;
  end;

  begin
    select count(*) from public.showcase_top_entries;
    raise exception 'FAIL: authenticated can SELECT showcase_top_entries';
  exception when insufficient_privilege then
    null;
  end;

  begin
    insert into public.announcements (author_id, title, body)
    values (v_student, 'T8 unauthorized announcement', 'body');
    raise exception 'FAIL: a student was allowed to publish an announcement';
  exception when insufficient_privilege then
    null;
  end;

  set local role anon;
  perform set_config('request.jwt.claim.sub', '', true);

  begin
    perform public.publish_recipient_ids(null);
    raise exception 'FAIL: anon can execute public.publish_recipient_ids';
  exception when insufficient_privilege then
    null;
  end;

  begin
    insert into public.announcements (author_id, title, body)
    values (v_other, 'T8 anon announcement', 'body');
    raise exception 'FAIL: anon was allowed to publish an announcement';
  exception when insufficient_privilege then
    null;
  end;

  begin
    insert into public.events (host_id, title, description, type, event_date, event_time)
    values (v_other, 'T8 anon event', 'body', 'Workshop', current_date + 1, '10:00');
    raise exception 'FAIL: anon was allowed to publish an event';
  exception when insufficient_privilege then
    null;
  end;

  reset role;
  delete from auth.users where id in (v_student, v_other);
  raise notice 'PASS 8: fan-out functions and tenures locked out of clients; publish authorization intact';
end $test$;

-- ---------------------------------------------------------
-- TEST 9: email enqueue is blocked, history is retained
-- ---------------------------------------------------------
\echo ''
\echo 'TEST 9: new email enqueue blocked; historical table retained'
do $test$
declare
  v_user uuid := gen_random_uuid();
  v_before int;
  v_after int;
  v_err text;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
  values (v_user, 'notif-t9-' || gen_random_uuid()::text || '@example.com',
          encode(gen_random_bytes(16), 'base64'), now(), '{}'::jsonb, now(), now());

  select count(*) into v_before from public.notification_email_outbox;

  begin
    insert into public.notification_email_outbox (source_type, source_id, user_id)
    values ('announcement', gen_random_uuid(), v_user);
    raise exception 'FAIL: new email enqueue was accepted while email is disabled';
  exception when feature_not_supported then
    v_err := SQLERRM;
  end;

  if v_err is null or v_err not ilike '%Email delivery is disabled%' then
    raise exception 'FAIL: email block raised the wrong error: %', coalesce(v_err, '(no error)');
  end if;

  select count(*) into v_after from public.notification_email_outbox;
  if v_after <> v_before then
    raise exception 'FAIL: blocked insert changed historical email row count (% -> %)', v_before, v_after;
  end if;

  if exists (
    select 1
    from pg_trigger t
    join pg_proc p on p.oid = t.tgfoid
    join pg_namespace n on n.oid = p.pronamespace
    where t.tgrelid = 'public.notification_email_outbox'::regclass
      and not t.tgisinternal
      and n.nspname = 'supabase_functions'
  ) then
    raise exception 'FAIL: an email webhook trigger still targets supabase_functions';
  end if;

  delete from auth.users where id = v_user;
  raise notice 'PASS 9: email enqueue hard-blocked, no historical rows changed, webhook triggers absent';
end $test$;

-- ---------------------------------------------------------
-- TEST 10: showcase top-two tenures
-- ---------------------------------------------------------
\echo ''
\echo 'TEST 10: showcase top-two — one notification per distinct tenure'
do $test$
declare
  v_a uuid := gen_random_uuid();
  v_b uuid := gen_random_uuid();
  v_c uuid := gen_random_uuid();
  v_d uuid := gen_random_uuid();
  v_u1 uuid := gen_random_uuid();
  v_u2 uuid := gen_random_uuid();
  v_a_post uuid;
  v_b_post uuid;
  v_c_post uuid;
  v_d_post uuid;
  n int;
  v_seq int;
  v_open int;
  v_notif uuid;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
  values
    (v_a,  'showcase-t10-a-'  || gen_random_uuid()::text || '@example.com', encode(gen_random_bytes(16),'base64'), now(), '{}'::jsonb, now(), now()),
    (v_b,  'showcase-t10-b-'  || gen_random_uuid()::text || '@example.com', encode(gen_random_bytes(16),'base64'), now(), '{}'::jsonb, now(), now()),
    (v_c,  'showcase-t10-c-'  || gen_random_uuid()::text || '@example.com', encode(gen_random_bytes(16),'base64'), now(), '{}'::jsonb, now(), now()),
    (v_d,  'showcase-t10-d-'  || gen_random_uuid()::text || '@example.com', encode(gen_random_bytes(16),'base64'), now(), '{}'::jsonb, now(), now()),
    (v_u1, 'showcase-t10-u1-' || gen_random_uuid()::text || '@example.com', encode(gen_random_bytes(16),'base64'), now(), '{}'::jsonb, now(), now()),
    (v_u2, 'showcase-t10-u2-' || gen_random_uuid()::text || '@example.com', encode(gen_random_bytes(16),'base64'), now(), '{}'::jsonb, now(), now());

  -- Explicit created_at makes the tie-break deterministic: newest first.
  insert into public.posts (author_id, type, title, body, created_at)
  values (v_a, 'showcase', 'T10 A', 'body', now() - interval '4 days')
  returning id into v_a_post;
  insert into public.posts (author_id, type, title, body, created_at)
  values (v_b, 'showcase', 'T10 B', 'body', now() - interval '3 days')
  returning id into v_b_post;
  insert into public.posts (author_id, type, title, body, created_at)
  values (v_c, 'showcase', 'T10 C', 'body', now() - interval '2 days')
  returning id into v_c_post;
  insert into public.posts (author_id, type, title, body, created_at)
  values (v_d, 'showcase', 'T10 D', 'body', now() - interval '1 day')
  returning id into v_d_post;

  -- A enters on its first upvote; its second must not duplicate.
  insert into public.upvotes (post_id, user_id) values (v_a_post, v_u1);
  insert into public.upvotes (post_id, user_id) values (v_a_post, v_u2);

  -- B enters on its first and stays; second upvote is silent.
  insert into public.upvotes (post_id, user_id) values (v_b_post, v_u1);
  insert into public.upvotes (post_id, user_id) values (v_b_post, v_u2);

  -- C has one upvote and stays outside the top two (A and B have two).
  insert into public.upvotes (post_id, user_id) values (v_c_post, v_u1);

  -- Simulate refreshes / recalculations: nothing may repeat.
  perform public.recompute_showcase_top2();
  perform public.recompute_showcase_top2();
  perform public.recompute_showcase_top2();

  select count(*) into n
  from public.notifications
  where content_type = 'showcase' and content_id in (v_a_post, v_b_post, v_c_post, v_d_post);
  if n <> 2 then
    raise exception 'FAIL: expected 2 showcase notifications (A,B), got %', n;
  end if;

  select count(*) into n
  from public.notification_push_outbox
  where source_type = 'showcase_top2' and source_id in (v_a_post, v_b_post, v_c_post, v_d_post);
  if n <> 2 then
    raise exception 'FAIL: expected 2 showcase push rows (A,B), got %', n;
  end if;

  if exists (
    select 1 from public.notifications
    where content_type = 'showcase' and content_id = v_c_post
  ) then
    raise exception 'FAIL: C was notified while it was outside the top two';
  end if;
  if exists (
    select 1 from public.notifications
    where content_type = 'showcase' and content_id = v_d_post
  ) then
    raise exception 'FAIL: D (no upvotes) was notified';
  end if;

  select count(*) into v_open from public.showcase_top_entries
  where post_id in (v_a_post, v_b_post, v_c_post, v_d_post) and left_at is null;
  if v_open <> 2 then
    raise exception 'FAIL: expected 2 active tenures after initial ranking, got %', v_open;
  end if;

  if exists (
    select 1 from public.showcase_top_entries
    where post_id in (v_a_post, v_b_post, v_c_post, v_d_post)
      and (notified_at is null or notification_id is null)
  ) then
    raise exception 'FAIL: an active tenure is missing its notified_at/notification_id link';
  end if;

  -- C opts out of push before its genuine later entry. The in-app row must
  -- still be created; the push row must not.
  update public.notification_preferences
  set push_enabled = false
  where user_id = v_c;
  if not found then
    insert into public.notification_preferences (user_id, push_enabled)
    values (v_c, false)
    on conflict (user_id) do update set push_enabled = false;
  end if;

  -- A drops to one upvote: B leads, C (newer) displaces A. A leaves.
  delete from public.upvotes where post_id = v_a_post and user_id = v_u2;

  if not exists (
    select 1 from public.showcase_top_entries
    where post_id = v_a_post and entry_seq = 1 and left_at is not null
  ) then
    raise exception 'FAIL: A''s first tenure was not closed on departure';
  end if;
  if not exists (
    select 1 from public.showcase_top_entries
    where post_id = v_c_post and left_at is null
  ) then
    raise exception 'FAIL: C did not enter the top two after A left';
  end if;
  if not exists (
    select 1 from public.notifications
    where content_type = 'showcase' and content_id = v_c_post
      and dedupe_key like 'showcase_top2:' || v_c_post || ':%'
  ) then
    raise exception 'FAIL: C received no in-app notification on genuine entry';
  end if;
  if exists (
    select 1 from public.notification_push_outbox
    where source_type = 'showcase_top2' and source_id = v_c_post
  ) then
    raise exception 'FAIL: push-disabled C received a showcase push row';
  end if;

  -- A re-enters with a second upvote: new tenure, new notification key.
  insert into public.upvotes (post_id, user_id) values (v_a_post, v_u2);

  select count(*) into n
  from public.showcase_top_entries
  where post_id = v_a_post;
  if n <> 2 then
    raise exception 'FAIL: A should have exactly 2 tenures after re-entry, got %', n;
  end if;

  select entry_seq, notification_id into v_seq, v_notif
  from public.showcase_top_entries
  where post_id = v_a_post and left_at is null;
  if v_seq <> 2 or v_notif is null then
    raise exception 'FAIL: A''s re-entry must use entry_seq 2 with a linked notification (got seq %, notif %)', v_seq, v_notif;
  end if;

  if not exists (
    select 1 from public.notifications
    where user_id = v_a
      and dedupe_key = 'showcase_top2:' || v_a_post || ':2'
  ) then
    raise exception 'FAIL: A''s re-entry did not create the seq-2 notification';
  end if;
  if not exists (
    select 1 from public.notification_push_outbox
    where source_type = 'showcase_top2' and source_id = v_a_post and user_id = v_a
  ) then
    raise exception 'FAIL: A''s re-entry did not enqueue a push';
  end if;

  select count(*) into n
  from public.notification_push_outbox
  where source_type = 'showcase_top2' and source_id in (v_a_post, v_b_post, v_c_post, v_d_post);
  if n <> 3 then
    raise exception 'FAIL: expected 3 showcase push rows (A twice, B once; C opted out), got %', n;
  end if;

  select count(*) into n
  from public.notifications
  where content_type = 'showcase' and content_id in (v_a_post, v_b_post, v_c_post, v_d_post);
  if n <> 4 then
    raise exception 'FAIL: expected 4 showcase in-app notifications (A twice, B, C), got %', n;
  end if;

  -- Continuing membership and repeated recomputation remain silent.
  perform public.recompute_showcase_top2();
  perform public.recompute_showcase_top2();
  select count(*) into n
  from public.notifications
  where content_type = 'showcase' and content_id in (v_a_post, v_b_post, v_c_post, v_d_post);
  if n <> 4 then
    raise exception 'FAIL: recalculation duplicated showcase notifications (now %)', n;
  end if;

  -- Deleting a showcase with an open tenure must not violate the tenure FK.
  -- The post delete cascades to its upvotes and tenures in the same statement;
  -- the ranking trigger must skip a post that is already gone.
  delete from public.posts where id = v_c_post;
  if exists (
    select 1 from public.showcase_top_entries where post_id = v_c_post
  ) then
    raise exception 'FAIL: showcase tenure survived its post delete';
  end if;

  delete from auth.users where id in (v_a, v_b, v_c, v_d, v_u1, v_u2);
  raise notice 'PASS 10: showcase top-two owner-only, one per tenure, opt-out respected, re-entry notified once';
end $test$;

\echo ''
\echo 'All publish fan-out SQL tests passed'
