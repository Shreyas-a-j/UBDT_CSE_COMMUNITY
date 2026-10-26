-- =========================================================
-- UCC 2.0 — notification retention, dedupe ledger, push log pruning
--
-- Covers:
--   1. notifications younger than 24h remain; older ones are deleted
--   2. repeated cleanup is harmless
--   3. batched deletion drains every eligible row
--   4. pending push work blocks notification deletion
--   5. retryable failed push work blocks deletion; parked failures do not
--   6. terminal sent/skipped logs expire after 7 days; terminal failed
--      logs after 30 days
--   7. deleting the in-app row never authorizes a duplicate notification
--      or push; the ledger is pruned only after its released window
--   8. a showcase tenure survives notification deletion and does not
--      re-notify; a genuine re-entry still gets its new seq notification
--   9. timezone changes do not move the 24-hour cutoff
--  10. events, announcements, posts and profiles survive cleanup
--  11. client RLS/privilege boundaries remain intact
--  12. detached outbox logs may share NULL notification_id; the unique
--      constraint still rejects two jobs for one notification
--  13. the terminal predicate matches the documented states
--  14. the schedule helper is safe when pg_cron is absent
--
-- Style: every section is its own do-block (transaction). Fixtures are
-- removed before commit. The script never disables a trigger, RLS, or a
-- security policy.
-- =========================================================

\echo ''
\echo 'TEST 1: younger notifications remain, older notifications are deleted'

do $test$
declare
  v_user uuid := gen_random_uuid();
  v_young uuid;
  v_old uuid;
  v_result jsonb;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
  values (v_user, 'retention-t1-' || gen_random_uuid()::text || '@example.com',
          encode(gen_random_bytes(16), 'base64'), now(), '{}'::jsonb, now(), now());
  delete from public.profiles where id = v_user;
  insert into public.profiles (id, name) values (v_user, 'Retention T1');

  insert into public.notifications (user_id, type, title, created_at, dedupe_key)
  values (v_user, 'announcement', 'young notification', now() - interval '23 hours', 'retention-t1-young')
  returning id into v_young;

  insert into public.notifications (user_id, type, title, created_at, dedupe_key)
  values (v_user, 'announcement', 'old notification', now() - interval '25 hours', 'retention-t1-old')
  returning id into v_old;

  v_result := public.cleanup_expired_notifications();

  if exists (select 1 from public.notifications where id = v_old) then
    raise exception 'FAIL: a 25-hour-old notification survived cleanup';
  end if;
  if not exists (select 1 from public.notifications where id = v_young) then
    raise exception 'FAIL: a 23-hour-old notification was deleted';
  end if;
  if (v_result->>'deleted_notifications')::int < 1 then
    raise exception 'FAIL: cleanup reported no deleted notifications: %', v_result;
  end if;

  if not exists (
    select 1 from public.notification_dedupe_ledger
    where user_id = v_user and dedupe_key = 'retention-t1-old'
      and released_at is not null
  ) then
    raise exception 'FAIL: deleted notification did not release its dedupe key';
  end if;
  if not exists (
    select 1 from public.notification_dedupe_ledger
    where user_id = v_user and dedupe_key = 'retention-t1-young'
      and released_at is null
  ) then
    raise exception 'FAIL: live notification ledger row was released early';
  end if;

  -- A second run must not error and must not delete the live row.
  v_result := public.cleanup_expired_notifications();
  if (v_result->>'deleted_notifications')::int <> 0 then
    raise exception 'FAIL: repeated cleanup deleted % rows', v_result->>'deleted_notifications';
  end if;
  if not exists (select 1 from public.notifications where id = v_young) then
    raise exception 'FAIL: repeated cleanup deleted the live notification';
  end if;

  delete from auth.users where id = v_user;
  raise notice 'PASS 1: 24-hour boundary and repeat-run safety';
end $test$;

\echo ''
\echo 'TEST 2: batched cleanup drains every eligible row'

do $test$
declare
  v_user uuid := gen_random_uuid();
  v_result jsonb;
  v_before int;
  v_after int;
  i int;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
  values (v_user, 'retention-t2-' || gen_random_uuid()::text || '@example.com',
          encode(gen_random_bytes(16), 'base64'), now(), '{}'::jsonb, now(), now());
  delete from public.profiles where id = v_user;
  insert into public.profiles (id, name) values (v_user, 'Retention T2');

  select count(*) into v_before
  from public.notifications
  where user_id = v_user;

  for i in 1..5 loop
    insert into public.notifications (user_id, type, title, created_at, dedupe_key)
    values (v_user, 'announcement', 'batch notification ' || i,
            now() - interval '25 hours', 'retention-t2-' || i);
  end loop;

  v_result := public.cleanup_expired_notifications(
    p_batch_size => 2,
    p_max_batches => 10
  );

  select count(*) into v_after
  from public.notifications
  where user_id = v_user;

  if v_after <> v_before then
    raise exception 'FAIL: batched cleanup left % row(s) behind', v_after - v_before;
  end if;
  if (v_result->>'deleted_notifications')::int < 5 then
    raise exception 'FAIL: cleanup reported % deletions for 5 eligible rows', v_result->>'deleted_notifications';
  end if;
  if (v_result->>'batches')::int < 3 then
    raise exception 'FAIL: 5 rows with batch size 2 used only % batch(es)', v_result->>'batches';
  end if;
  if (v_result->>'remaining_expired_notifications')::int <> 0 then
    raise exception 'FAIL: cleanup reported % remaining expired rows', v_result->>'remaining_expired_notifications';
  end if;

  delete from auth.users where id = v_user;
  raise notice 'PASS 2: batch loop drained all eligible rows';
end $test$;

\echo ''
\echo 'TEST 3: pending push work blocks deletion; a terminal log detaches'

do $test$
declare
  v_user uuid := gen_random_uuid();
  v_n uuid;
  v_o uuid;
  v_result jsonb;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
  values (v_user, 'retention-t3-' || gen_random_uuid()::text || '@example.com',
          encode(gen_random_bytes(16), 'base64'), now(), '{}'::jsonb, now(), now());
  delete from public.profiles where id = v_user;
  insert into public.profiles (id, name) values (v_user, 'Retention T3');

  insert into public.notifications (user_id, type, title, created_at, dedupe_key)
  values (v_user, 'event_published', 'pending push', now() - interval '30 hours', 'retention-t3')
  returning id into v_n;

  insert into public.notification_push_outbox (
    notification_id, user_id, source_type, source_id, status
  ) values (
    v_n, v_user, 'event', gen_random_uuid(), 'pending'
  ) returning id into v_o;

  v_result := public.cleanup_expired_notifications();
  if not exists (select 1 from public.notifications where id = v_n) then
    raise exception 'FAIL: cleanup deleted a notification with a pending push';
  end if;
  if not exists (select 1 from public.notification_push_outbox where id = v_o and status = 'pending') then
    raise exception 'FAIL: cleanup changed the pending push row';
  end if;

  update public.notification_push_outbox
  set status = 'sent', sent_at = now(), finished_at = now(), locked_at = null
  where id = v_o;

  v_result := public.cleanup_expired_notifications();
  if exists (select 1 from public.notifications where id = v_n) then
    raise exception 'FAIL: cleanup kept the notification after its push became terminal';
  end if;
  if not exists (
    select 1 from public.notification_push_outbox
    where id = v_o and notification_id is null and status = 'sent' and finished_at is not null
  ) then
    raise exception 'FAIL: terminal push log was not retained and detached';
  end if;
  if (select count(*) from public.notification_push_outbox where user_id = v_user) <> 1 then
    raise exception 'FAIL: notification deletion created or removed push rows';
  end if;

  delete from auth.users where id = v_user;
  raise notice 'PASS 3: pending work protected; terminal log retained and detached';
end $test$;

\echo ''
\echo 'TEST 4: retryable failures block deletion; parked failures are terminal'

do $test$
declare
  v_user uuid := gen_random_uuid();
  v_retry uuid;
  v_parked uuid;
  v_o_retry uuid;
  v_o_parked uuid;
  v_result jsonb;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
  values (v_user, 'retention-t4-' || gen_random_uuid()::text || '@example.com',
          encode(gen_random_bytes(16), 'base64'), now(), '{}'::jsonb, now(), now());
  delete from public.profiles where id = v_user;
  insert into public.profiles (id, name) values (v_user, 'Retention T4');

  insert into public.notifications (user_id, type, title, created_at, dedupe_key)
  values (v_user, 'event_published', 'retryable push', now() - interval '30 hours', 'retention-t4-retry')
  returning id into v_retry;
  insert into public.notification_push_outbox (
    notification_id, user_id, source_type, source_id, status, attempts,
    last_error, next_attempt_at
  ) values (
    v_retry, v_user, 'event', gen_random_uuid(), 'failed', 2,
    'temporary provider error', now() + interval '1 hour'
  ) returning id into v_o_retry;

  insert into public.notifications (user_id, type, title, created_at, dedupe_key)
  values (v_user, 'event_published', 'parked push', now() - interval '30 hours', 'retention-t4-parked')
  returning id into v_parked;
  insert into public.notification_push_outbox (
    notification_id, user_id, source_type, source_id, status, attempts,
    last_error, next_attempt_at, updated_at
  ) values (
    v_parked, v_user, 'event', gen_random_uuid(), 'failed', 5,
    'permanent provider error', now() + interval '365 days', now() - interval '2 days'
  ) returning id into v_o_parked;

  v_result := public.cleanup_expired_notifications();

  if not exists (select 1 from public.notifications where id = v_retry) then
    raise exception 'FAIL: cleanup deleted a notification with a retryable failed push';
  end if;
  if exists (select 1 from public.notifications where id = v_parked) then
    raise exception 'FAIL: cleanup kept a notification whose push was parked terminally';
  end if;
  if not exists (
    select 1 from public.notification_push_outbox
    where id = v_o_parked and finished_at is not null and last_error = 'permanent provider error'
  ) then
    raise exception 'FAIL: parked failure was not stamped terminal or lost its concise error';
  end if;

  update public.notification_push_outbox
  set status = 'failed', finished_at = now(), next_attempt_at = now()
  where id = v_o_retry;

  v_result := public.cleanup_expired_notifications();
  if exists (select 1 from public.notifications where id = v_retry) then
    raise exception 'FAIL: cleanup kept the notification after the retry became terminal';
  end if;

  delete from auth.users where id = v_user;
  raise notice 'PASS 4: retryable failures protected; parked failures pruned safely';
end $test$;

\echo ''
\echo 'TEST 5: terminal log retention windows'

do $test$
declare
  v_user uuid := gen_random_uuid();
  v_n uuid;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
  values (v_user, 'retention-t5-' || gen_random_uuid()::text || '@example.com',
          encode(gen_random_bytes(16), 'base64'), now(), '{}'::jsonb, now(), now());
  delete from public.profiles where id = v_user;
  insert into public.profiles (id, name) values (v_user, 'Retention T5');

  -- Sent log older than 7 days: notification and log are both pruned.
  insert into public.notifications (user_id, type, title, created_at, dedupe_key)
  values (v_user, 'event_published', 'old sent', now() - interval '30 hours', 'retention-t5-sent')
  returning id into v_n;
  insert into public.notification_push_outbox (
    notification_id, user_id, source_type, source_id, status,
    sent_at, finished_at
  ) values (
    v_n, v_user, 'event', gen_random_uuid(), 'sent',
    now() - interval '8 days', now() - interval '8 days'
  );

  -- Skipped log within 7 days: notification goes, log remains.
  insert into public.notifications (user_id, type, title, created_at, dedupe_key)
  values (v_user, 'event_published', 'recent skipped', now() - interval '30 hours', 'retention-t5-skipped')
  returning id into v_n;
  insert into public.notification_push_outbox (
    notification_id, user_id, source_type, source_id, status,
    last_error, finished_at
  ) values (
    v_n, v_user, 'event', gen_random_uuid(), 'skipped',
    'no subscribed Android devices matched this user', now() - interval '2 days'
  );

  -- Failed log older than 30 days: pruned.
  insert into public.notifications (user_id, type, title, created_at, dedupe_key)
  values (v_user, 'event_published', 'old failed', now() - interval '40 days', 'retention-t5-failed-old')
  returning id into v_n;
  insert into public.notification_push_outbox (
    notification_id, user_id, source_type, source_id, status,
    last_error, next_attempt_at, finished_at
  ) values (
    v_n, v_user, 'event', gen_random_uuid(), 'failed',
    'permanent provider rejection', now(), now() - interval '31 days'
  );

  -- Failed log within 30 days: notification goes, concise error remains.
  insert into public.notifications (user_id, type, title, created_at, dedupe_key)
  values (v_user, 'event_published', 'recent failed', now() - interval '30 hours', 'retention-t5-failed-new')
  returning id into v_n;
  insert into public.notification_push_outbox (
    notification_id, user_id, source_type, source_id, status,
    last_error, next_attempt_at, finished_at
  ) values (
    v_n, v_user, 'event', gen_random_uuid(), 'failed',
    'permanent provider rejection', now(), now() - interval '10 days'
  );

  perform public.cleanup_expired_notifications();

  if exists (select 1 from public.notification_push_outbox where user_id = v_user and status = 'sent') then
    raise exception 'FAIL: sent log survived its 7-day window';
  end if;
  if not exists (
    select 1 from public.notification_push_outbox
    where user_id = v_user and status = 'skipped'
      and notification_id is null
      and last_error = 'no subscribed Android devices matched this user'
  ) then
    raise exception 'FAIL: recent skipped log was not retained';
  end if;
  if exists (
    select 1 from public.notification_push_outbox
    where user_id = v_user and last_error = 'permanent provider rejection'
      and finished_at < now() - interval '30 days'
  ) then
    raise exception 'FAIL: failed log survived its 30-day window';
  end if;
  if not exists (
    select 1 from public.notification_push_outbox
    where user_id = v_user and status = 'failed'
      and finished_at > now() - interval '11 days'
      and last_error = 'permanent provider rejection'
  ) then
    raise exception 'FAIL: recent failed log lost its concise error';
  end if;
  if exists (
    select 1 from public.notifications
    where user_id = v_user
  ) then
    raise exception 'FAIL: cleanup left an expired notification behind';
  end if;

  delete from auth.users where id = v_user;
  raise notice 'PASS 5: success/skip logs 7 days, terminal failure logs 30 days';
end $test$;

\echo ''
\echo 'TEST 6: dedupe survives deletion and is pruned after release'

do $test$
declare
  v_user uuid := gen_random_uuid();
  v_n uuid;
  v_new uuid;
  v_result jsonb;
  v_outbox_before int;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
  values (v_user, 'retention-t6-' || gen_random_uuid()::text || '@example.com',
          encode(gen_random_bytes(16), 'base64'), now(), '{}'::jsonb, now(), now());
  delete from public.profiles where id = v_user;
  insert into public.profiles (id, name) values (v_user, 'Retention T6');

  insert into public.notifications (user_id, type, title, created_at, dedupe_key)
  values (v_user, 'announcement', 'dedupe original', now() - interval '30 hours', 'retention-t6-key')
  returning id into v_n;
  insert into public.notification_push_outbox (
    notification_id, user_id, source_type, source_id, status, sent_at, finished_at
  ) values (
    v_n, v_user, 'announcement', gen_random_uuid(), 'sent', now(), now()
  );

  perform public.cleanup_expired_notifications();

  if exists (select 1 from public.notifications where user_id = v_user and dedupe_key = 'retention-t6-key') then
    raise exception 'FAIL: original notification survived cleanup';
  end if;
  if not exists (
    select 1 from public.notification_dedupe_ledger
    where user_id = v_user and dedupe_key = 'retention-t6-key' and released_at is not null
  ) then
    raise exception 'FAIL: released dedupe key was not retained';
  end if;

  select count(*) into v_outbox_before
  from public.notification_push_outbox
  where user_id = v_user;

  insert into public.notifications (user_id, type, title, dedupe_key)
  values (v_user, 'announcement', 'duplicate after delete', 'retention-t6-key')
  returning id into v_new;
  if v_new is not null then
    raise exception 'FAIL: a deleted notification key was allowed to insert again';
  end if;

  perform public.emit_notification(
    v_user, 'announcement', 'second duplicate', null, null, null, null,
    'retention-t6-key'
  );
  if exists (select 1 from public.notifications where user_id = v_user and dedupe_key = 'retention-t6-key') then
    raise exception 'FAIL: emit_notification recreated a deleted key';
  end if;
  if (select count(*) from public.notification_push_outbox where user_id = v_user) <> v_outbox_before then
    raise exception 'FAIL: duplicate suppression created a push row';
  end if;

  update public.notification_dedupe_ledger
  set released_at = now() - interval '31 days'
  where user_id = v_user and dedupe_key = 'retention-t6-key';

  v_result := public.cleanup_expired_notifications();
  if exists (
    select 1 from public.notification_dedupe_ledger
    where user_id = v_user and dedupe_key = 'retention-t6-key'
  ) then
    raise exception 'FAIL: released dedupe key survived its 30-day window';
  end if;

  -- Outside the ledger window a manual replay can insert again. This is
  -- documented as a residual risk, not a normal publish path.
  insert into public.notifications (user_id, type, title, dedupe_key)
  values (v_user, 'announcement', 'post-window replay', 'retention-t6-key')
  returning id into v_new;
  if v_new is null then
    raise exception 'FAIL: key remained blocked after its released window';
  end if;

  delete from auth.users where id = v_user;
  raise notice 'PASS 6: ledger blocks duplicates and ages out after release';
end $test$;

\echo ''
\echo 'TEST 7: showcase tenure survives deletion; re-entry still notifies once'

do $test$
declare
  v_author uuid := gen_random_uuid();
  v_upvoter uuid := gen_random_uuid();
  v_post uuid;
  v_notif uuid;
  v_outbox uuid;
  v_entry uuid;
  v_seq int;
  v_open int;
begin
  if exists (
    select 1
    from public.posts p
    join public.upvotes u on u.post_id = p.id
    where p.type = 'showcase'
  ) then
    raise exception 'PRECONDITION FAILED: showcase fixtures from another suite are still present';
  end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
  values
    (v_author,  'retention-t7-a-' || gen_random_uuid()::text || '@example.com',
     encode(gen_random_bytes(16), 'base64'), now(), '{}'::jsonb, now(), now()),
    (v_upvoter, 'retention-t7-u-' || gen_random_uuid()::text || '@example.com',
     encode(gen_random_bytes(16), 'base64'), now(), '{}'::jsonb, now(), now());

  insert into public.posts (author_id, type, title, body)
  values (v_author, 'showcase', 'Retention showcase', 'body')
  returning id into v_post;

  insert into public.upvotes (post_id, user_id) values (v_post, v_upvoter);
  perform public.recompute_showcase_top2();

  select e.id, e.entry_seq into v_entry, v_seq
  from public.showcase_top_entries e
  where e.post_id = v_post and e.left_at is null;
  if v_entry is null or v_seq <> 1 then
    raise exception 'FAIL: first showcase tenure was not created';
  end if;

  select notification_id into v_notif
  from public.showcase_top_entries where id = v_entry;
  if v_notif is null then
    raise exception 'FAIL: first tenure has no notification link';
  end if;

  select id into v_outbox
  from public.notification_push_outbox
  where source_type = 'showcase_top2' and source_id = v_post and user_id = v_author;
  if v_outbox is null then
    raise exception 'FAIL: first tenure did not enqueue a push';
  end if;

  update public.notifications
  set created_at = now() - interval '25 hours'
  where id = v_notif;
  update public.notification_push_outbox
  set status = 'sent', sent_at = now(), finished_at = now()
  where id = v_outbox;

  perform public.cleanup_expired_notifications();

  if exists (select 1 from public.notifications where id = v_notif) then
    raise exception 'FAIL: showcase notification survived retention';
  end if;
  if not exists (
    select 1 from public.showcase_top_entries
    where id = v_entry and left_at is null and notification_id is null
  ) then
    raise exception 'FAIL: active showcase tenure did not survive with a detached link';
  end if;

  -- Recalculation after deletion must not re-notify.
  perform public.recompute_showcase_top2();
  perform public.recompute_showcase_top2();
  if exists (
    select 1 from public.notifications
    where content_type = 'showcase' and content_id = v_post
  ) then
    raise exception 'FAIL: recomputation re-notified a surviving showcase tenure';
  end if;

  -- Genuine departure then re-entry gets a new tenure and a new key.
  delete from public.upvotes where post_id = v_post and user_id = v_upvoter;
  perform public.recompute_showcase_top2();
  if not exists (
    select 1 from public.showcase_top_entries
    where id = v_entry and left_at is not null
  ) then
    raise exception 'FAIL: departure did not close the showcase tenure';
  end if;

  insert into public.upvotes (post_id, user_id) values (v_post, v_upvoter);
  perform public.recompute_showcase_top2();

  select count(*) into v_open
  from public.showcase_top_entries
  where post_id = v_post and left_at is null;
  if v_open <> 1 then
    raise exception 'FAIL: re-entry produced % active tenures; expected 1', v_open;
  end if;
  if not exists (
    select 1 from public.showcase_top_entries
    where post_id = v_post and left_at is null and entry_seq = 2
  ) then
    raise exception 'FAIL: re-entry did not use entry_seq 2';
  end if;
  if not exists (
    select 1 from public.notifications
    where user_id = v_author
      and content_type = 'showcase' and content_id = v_post
      and dedupe_key = 'showcase_top2:' || v_post || ':2'
  ) then
    raise exception 'FAIL: genuine re-entry did not create its seq-2 notification';
  end if;
  if not exists (
    select 1 from public.notification_push_outbox
    where source_type = 'showcase_top2' and source_id = v_post and user_id = v_author
      and notification_id is not null
  ) then
    raise exception 'FAIL: genuine re-entry did not enqueue a push';
  end if;

  delete from public.posts where id = v_post;
  delete from auth.users where id in (v_author, v_upvoter);
  raise notice 'PASS 7: tenure survives deletion; only a genuine re-entry notifies';
end $test$;

\echo ''
\echo 'TEST 8: timezone changes do not move the cutoff'

do $test$
declare
  v_user uuid := gen_random_uuid();
  v_young uuid;
  v_old uuid;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
  values (v_user, 'retention-t8-' || gen_random_uuid()::text || '@example.com',
          encode(gen_random_bytes(16), 'base64'), now(), '{}'::jsonb, now(), now());
  delete from public.profiles where id = v_user;
  insert into public.profiles (id, name) values (v_user, 'Retention T8');

  -- UTC+14 session. timestamptz comparisons remain absolute.
  set local timezone = 'Pacific/Kiritimati';

  insert into public.notifications (user_id, type, title, created_at, dedupe_key)
  values (v_user, 'announcement', 'tz young', now() - interval '23 hours', 'retention-t8-young')
  returning id into v_young;
  insert into public.notifications (user_id, type, title, created_at, dedupe_key)
  values (v_user, 'announcement', 'tz old', now() - interval '25 hours', 'retention-t8-old')
  returning id into v_old;

  perform public.cleanup_expired_notifications();

  if exists (select 1 from public.notifications where id = v_old) then
    raise exception 'FAIL: 25-hour-old row survived under a non-UTC session timezone';
  end if;
  if not exists (select 1 from public.notifications where id = v_young) then
    raise exception 'FAIL: 23-hour-old row was deleted under a non-UTC session timezone';
  end if;

  delete from auth.users where id = v_user;
  raise notice 'PASS 8: absolute 24-hour cutoff preserved across timezones';
end $test$;

\echo ''
\echo 'TEST 9: events, announcements, posts and profiles survive cleanup'

do $test$
declare
  v_author uuid := gen_random_uuid();
  v_post uuid;
  v_ann uuid;
  v_event uuid;
  v_old uuid;
  v_before_profiles int;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
  values (v_author, 'retention-t9-' || gen_random_uuid()::text || '@example.com',
          encode(gen_random_bytes(16), 'base64'), now(), '{}'::jsonb, now(), now());
  delete from public.profiles where id = v_author;
  insert into public.profiles (id, name) values (v_author, 'Retention T9');

  select count(*) into v_before_profiles from public.profiles;

  insert into public.posts (author_id, type, title, body)
  values (v_author, 'discussion', 'Retention discussion', 'body')
  returning id into v_post;

  insert into public.announcements (author_id, title, body)
  values (v_author, 'Retention announcement', 'body')
  returning id into v_ann;

  insert into public.events (host_id, title, description, type, event_date, event_time)
  values (v_author, 'Retention event', 'body', 'Workshop', current_date + 1, '10:00')
  returning id into v_event;

  insert into public.notifications (user_id, type, title, created_at, dedupe_key)
  values (v_author, 'announcement', 'retention fixture', now() - interval '25 hours', 'retention-t9-old')
  returning id into v_old;

  perform public.cleanup_expired_notifications();

  if exists (select 1 from public.notifications where id = v_old) then
    raise exception 'FAIL: retention fixture notification survived';
  end if;
  if not exists (select 1 from public.posts where id = v_post and author_id = v_author) then
    raise exception 'FAIL: cleanup deleted a discussion post';
  end if;
  if not exists (select 1 from public.announcements where id = v_ann and author_id = v_author) then
    raise exception 'FAIL: cleanup deleted an announcement';
  end if;
  if not exists (select 1 from public.events where id = v_event and host_id = v_author) then
    raise exception 'FAIL: cleanup deleted an event';
  end if;
  if not exists (select 1 from public.profiles where id = v_author) then
    raise exception 'FAIL: cleanup deleted a profile';
  end if;
  if (select count(*) from public.profiles) <> v_before_profiles then
    raise exception 'FAIL: cleanup changed the profile count';
  end if;

  -- Remove the fan-out side effects written to seeded members, then the
  -- fixture rows themselves.
  delete from public.notification_push_outbox
  where (source_type = 'announcement' and source_id = v_ann)
     or (source_type = 'event' and source_id = v_event);
  delete from public.notification_dedupe_ledger
  where dedupe_key in (
    'publish:announcement:' || v_ann,
    'publish:event:' || v_event
  );
  delete from public.notifications
  where dedupe_key in (
    'publish:announcement:' || v_ann,
    'publish:event:' || v_event
  );
  delete from auth.users where id = v_author;

  raise notice 'PASS 9: business content untouched; only in-app notifications were deleted';
end $test$;

\echo ''
\echo 'TEST 10: RLS and client privileges remain intact'

do $test$
declare
  v_a uuid := gen_random_uuid();
  v_b uuid := gen_random_uuid();
  n int;
  v_denied boolean;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
  values
    (v_a, 'retention-t10-a-' || gen_random_uuid()::text || '@example.com',
     encode(gen_random_bytes(16), 'base64'), now(), '{}'::jsonb, now(), now()),
    (v_b, 'retention-t10-b-' || gen_random_uuid()::text || '@example.com',
     encode(gen_random_bytes(16), 'base64'), now(), '{}'::jsonb, now(), now());
  delete from public.profiles where id in (v_a, v_b);
  insert into public.profiles (id, name) values (v_a, 'Retention T10 A'), (v_b, 'Retention T10 B');

  insert into public.notifications (user_id, type, title, dedupe_key)
  values (v_a, 'announcement', 'A private row', 'retention-t10-a');
  insert into public.notifications (user_id, type, title, dedupe_key)
  values (v_b, 'announcement', 'B private row', 'retention-t10-b');

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', v_a::text, true);

  select count(*) into n from public.notifications where user_id = v_a;
  if n <> 1 then
    raise exception 'FAIL: owner cannot read their own notification (saw %)', n;
  end if;
  select count(*) into n from public.notifications where user_id = v_b;
  if n <> 0 then
    raise exception 'FAIL: cross-user notification read leaked % row(s)', n;
  end if;

  update public.notifications set read = true where user_id = v_b;
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'FAIL: cross-user notification update changed % row(s)', n;
  end if;

  v_denied := false;
  begin
    select count(*) into n from public.notification_dedupe_ledger;
  exception when insufficient_privilege then
    v_denied := true;
  end;
  if not v_denied then
    raise exception 'FAIL: authenticated can read the dedupe ledger';
  end if;

  v_denied := false;
  begin
    insert into public.notification_dedupe_ledger (user_id, dedupe_key)
    values (v_a, 'retention-t10-forbidden');
  exception when insufficient_privilege then
    v_denied := true;
  end;
  if not v_denied then
    raise exception 'FAIL: authenticated can write the dedupe ledger';
  end if;

  v_denied := false;
  begin
    perform public.cleanup_expired_notifications();
  exception when insufficient_privilege then
    v_denied := true;
  end;
  if not v_denied then
    raise exception 'FAIL: authenticated can execute retention cleanup';
  end if;

  v_denied := false;
  begin
    perform public.ensure_notification_retention_schedule();
  exception when insufficient_privilege then
    v_denied := true;
  end;
  if not v_denied then
    raise exception 'FAIL: authenticated can execute the schedule helper';
  end if;

  reset role;
  delete from auth.users where id in (v_a, v_b);
  raise notice 'PASS 10: owner-only RLS and client lockout on the ledger/functions';
end $test$;

\echo ''
\echo 'TEST 11: detached logs may share NULL; one job per notification remains unique'

do $test$
declare
  v_user uuid := gen_random_uuid();
  v_n1 uuid;
  v_n2 uuid;
  v_n3 uuid;
  n int;
  v_duplicate boolean := false;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
  values (v_user, 'retention-t11-' || gen_random_uuid()::text || '@example.com',
          encode(gen_random_bytes(16), 'base64'), now(), '{}'::jsonb, now(), now());
  delete from public.profiles where id = v_user;
  insert into public.profiles (id, name) values (v_user, 'Retention T11');

  insert into public.notifications (user_id, type, title, dedupe_key)
  values (v_user, 'announcement', 'detach one', 'retention-t11-1') returning id into v_n1;
  insert into public.notification_push_outbox (notification_id, user_id, source_type, source_id, status)
  values (v_n1, v_user, 'announcement', gen_random_uuid(), 'sent');
  delete from public.notifications where id = v_n1;

  insert into public.notifications (user_id, type, title, dedupe_key)
  values (v_user, 'announcement', 'detach two', 'retention-t11-2') returning id into v_n2;
  insert into public.notification_push_outbox (notification_id, user_id, source_type, source_id, status)
  values (v_n2, v_user, 'announcement', gen_random_uuid(), 'skipped');
  delete from public.notifications where id = v_n2;

  select count(*) into n
  from public.notification_push_outbox
  where user_id = v_user and notification_id is null;
  if n <> 2 then
    raise exception 'FAIL: expected 2 detached logs, found %', n;
  end if;

  insert into public.notifications (user_id, type, title, dedupe_key)
  values (v_user, 'announcement', 'unique target', 'retention-t11-3') returning id into v_n3;
  insert into public.notification_push_outbox (notification_id, user_id, source_type, source_id)
  values (v_n3, v_user, 'announcement', gen_random_uuid());

  begin
    insert into public.notification_push_outbox (notification_id, user_id, source_type, source_id)
    values (v_n3, v_user, 'announcement', gen_random_uuid());
  exception when unique_violation then
    v_duplicate := true;
  end;
  if not v_duplicate then
    raise exception 'FAIL: a second push job was accepted for one notification';
  end if;

  delete from auth.users where id = v_user;
  raise notice 'PASS 11: detached logs coexist; per-notification uniqueness intact';
end $test$;

\echo ''
\echo 'TEST 12: terminal predicate matches the delivery state machine'

do $test$
begin
  if not public.notification_push_outbox_is_terminal('sent', null, now()) then
    raise exception 'FAIL: sent is not terminal';
  end if;
  if not public.notification_push_outbox_is_terminal('skipped', null, now()) then
    raise exception 'FAIL: skipped is not terminal';
  end if;
  if not public.notification_push_outbox_is_terminal('failed', now(), now()) then
    raise exception 'FAIL: failed with finished_at is not terminal';
  end if;
  if not public.notification_push_outbox_is_terminal('failed', null, now() + interval '2 days') then
    raise exception 'FAIL: failed parked beyond one day is not terminal';
  end if;
  if public.notification_push_outbox_is_terminal('failed', null, now() + interval '1 hour') then
    raise exception 'FAIL: near-term retryable failed was treated as terminal';
  end if;
  if public.notification_push_outbox_is_terminal('pending', now(), now()) then
    raise exception 'FAIL: pending was treated as terminal';
  end if;
  if public.notification_push_outbox_is_terminal('sending', now(), now()) then
    raise exception 'FAIL: sending was treated as terminal';
  end if;

  raise notice 'PASS 12: one terminal predicate used by cleanup and tests';
end $test$;

\echo ''
\echo 'TEST 13: schedule helper is safe without pg_cron and idempotent with it'

do $test$
declare
  v_installed boolean;
  v_ok boolean;
  n int;
begin
  select exists (select 1 from pg_extension where extname = 'pg_cron') into v_installed;

  v_ok := public.ensure_notification_retention_schedule();

  if not v_installed then
    if v_ok then
      raise exception 'FAIL: schedule helper claimed success without pg_cron';
    end if;
  else
    if not v_ok then
      raise exception 'FAIL: schedule helper failed with pg_cron installed';
    end if;
    select count(*) into n
    from cron.job
    where jobname = 'ucc2-cleanup-expired-notifications'
      and schedule = '*/15 * * * *'
      and command = 'select public.cleanup_expired_notifications();'
      and active;
    if n <> 1 then
      raise exception 'FAIL: expected one active retention job, found %', n;
    end if;
  end if;

  raise notice 'PASS 13: schedule helper handles both extension states';
end $test$;

\echo ''
\echo 'All notification retention SQL tests passed'
