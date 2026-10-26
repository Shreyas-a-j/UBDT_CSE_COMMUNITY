-- =========================================================
-- UCC 2.0 — verified faculty discussion pinning (SQL tests)
--
-- Run after the migration chain (or supabase/schema.sql) has been applied
-- to a disposable PostgreSQL 16 database with the Supabase auth stub:
--
--   psql ... -f supabase/local-rehearsal/auth-stub.sql
--   psql ... -f supabase/schema.sql
--   psql ... -v ON_ERROR_STOP=1 -f supabase/test-discussion-pins.sql
--
-- The suite covers:
--   1. verified faculty can pin their own discussion
--   2. verified faculty can pin another user's discussion
--   3. students cannot pin or unpin
--   4. unapproved faculty cannot pin or unpin
--   5. three active pins succeed; the fourth is rejected
--   6. expired pins do not count toward the limit
--   7. pins expire after 7 days through query logic (no cleanup job)
--   8. unpinning frees a slot immediately
--   9. concurrent pin requests cannot exceed three active pins (dblink)
--  10. discussions, comments, reactions, authors and pagination survive
--
-- It also asserts the RLS/grant surface: active pins are readable by
-- everyone who can read discussions, expired pins are not, and direct
-- table writes are denied to API roles.
-- =========================================================

\echo '============================================'
\echo 'Discussion pinning — SQL Tests'
\echo '============================================'

-- Test-only concurrency helper. dblink ships with the official PostgreSQL
-- image; it is never installed in the application schema.
create extension if not exists dblink;

-- ---------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------
drop function if exists public.pin_test_expect_error(text, text);
create or replace function public.pin_test_expect_error(p_sql text, p_fragment text)
returns void
language plpgsql
as $$
declare
  v_msg text;
begin
  begin
    execute p_sql;
  exception when others then
    v_msg := sqlerrm;
  end;

  if v_msg is null then
    raise exception 'FAIL: expected error containing "%", but the statement succeeded', p_fragment;
  end if;
  if position(p_fragment in v_msg) = 0 then
    raise exception 'FAIL: expected error containing "%", got "%"', p_fragment, v_msg;
  end if;
end;
$$;
grant execute on function public.pin_test_expect_error(text, text) to public;

drop table if exists pg_temp.pin_test_ids;
create temp table pin_test_ids (
  name text primary key,
  id uuid not null
);

-- ---------------------------------------------------------
-- Cleanup from an interrupted previous run
-- ---------------------------------------------------------
delete from public.discussion_pins
where post_id in (select id from public.posts where title like 'PinTest %');
delete from public.posts where title like 'PinTest %';
delete from auth.users where email like 'pin-%@example.com';

-- ---------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------
do $$
declare
  v_own uuid;
  v_other uuid;
  v_d2 uuid;
  v_d3 uuid;
  v_d4 uuid;
  v_showcase uuid;
  v_student uuid;
begin
  insert into auth.users (
    id, email, encrypted_password, email_confirmed_at,
    raw_user_meta_data, created_at, updated_at
  )
  values
    (gen_random_uuid(), 'pin-faculty-a@example.com', 'x', now(),
     '{"name":"Pin Faculty A","intent":"student"}'::jsonb, now(), now()),
    (gen_random_uuid(), 'pin-faculty-b@example.com', 'x', now(),
     '{"name":"Pin Faculty B","intent":"student"}'::jsonb, now(), now()),
    (gen_random_uuid(), 'pin-faculty-pending@example.com', 'x', now(),
     '{"name":"Pin Pending Faculty","intent":"student"}'::jsonb, now(), now()),
    (gen_random_uuid(), 'pin-faculty-rejected@example.com', 'x', now(),
     '{"name":"Pin Rejected Faculty","intent":"student"}'::jsonb, now(), now()),
    (gen_random_uuid(), 'pin-admin@example.com', 'x', now(),
     '{"name":"Pin Admin","intent":"student"}'::jsonb, now(), now()),
    (gen_random_uuid(), 'pin-student@example.com', 'x', now(),
     '{"name":"Pin Student","intent":"student"}'::jsonb, now(), now());

  -- Promote two approved faculty, one pending faculty, one rejected faculty,
  -- and one administrator. Disabling the protection trigger is the same
  -- fixture pattern used by the Phase 8/12 suites: this is an owner-run test,
  -- never an application path.
  --
  -- The admin row must satisfy profiles_admin_requires_approved (from
  -- 2026102208), so its stored status is approved. TEST 0 below temporarily
  -- forces is_verified_faculty() to return false inside a rolled-back
  -- transaction, proving pin/unpin succeeds through the independent
  -- is_admin() branch rather than through faculty verification.
  alter table public.profiles disable trigger trg_protect_profile_privileges;
  update public.profiles
  set role = 'faculty', faculty_status = 'approved', member_type = 'faculty'
  where email in ('pin-faculty-a@example.com', 'pin-faculty-b@example.com');
  update public.profiles
  set role = 'faculty', faculty_status = 'pending', member_type = 'faculty'
  where email = 'pin-faculty-pending@example.com';
  update public.profiles
  set role = 'faculty', faculty_status = 'rejected', member_type = 'faculty'
  where email = 'pin-faculty-rejected@example.com';
  update public.profiles
  set role = 'admin', faculty_status = 'approved', member_type = 'faculty'
  where email = 'pin-admin@example.com';
  alter table public.profiles enable trigger trg_protect_profile_privileges;

  select id into v_student from public.profiles where email = 'pin-student@example.com';

  insert into public.posts (author_id, type, title, body, target_years, created_at)
  values
    ((select id from public.profiles where email = 'pin-faculty-a@example.com'),
     'discussion', 'PinTest own', 'Faculty A wrote this.', '{1,2,3,4}',
     now() - interval '50 minutes')
  returning id into v_own;

  insert into public.posts (author_id, type, title, body, target_years, created_at)
  values
    (v_student, 'discussion', 'PinTest other', 'Student wrote this.', '{1,2,3,4}',
     now() - interval '40 minutes')
  returning id into v_other;

  insert into public.posts (author_id, type, title, body, target_years, created_at)
  values
    (v_student, 'discussion', 'PinTest d2', 'Second fixture.', '{1,2,3,4}',
     now() - interval '30 minutes')
  returning id into v_d2;

  insert into public.posts (author_id, type, title, body, target_years, created_at)
  values
    (v_student, 'discussion', 'PinTest d3', 'Third fixture.', '{1,2,3,4}',
     now() - interval '20 minutes')
  returning id into v_d3;

  insert into public.posts (author_id, type, title, body, target_years, created_at)
  values
    (v_student, 'discussion', 'PinTest d4', 'Fourth fixture.', '{1,2,3,4}',
     now() - interval '10 minutes')
  returning id into v_d4;

  insert into public.posts (author_id, type, title, body, target_years, created_at)
  values
    (v_student, 'showcase', 'PinTest showcase', 'Not a discussion.', '{1,2,3,4}',
     now() - interval '5 minutes')
  returning id into v_showcase;

  -- Content that pinning must never disturb.
  insert into public.comments (post_id, author_id, body)
  values (v_own, v_student, 'A comment that must survive pinning.');
  insert into public.likes (post_id, user_id) values (v_own, v_student);
  insert into public.upvotes (post_id, user_id) values (v_own, v_student);

  insert into pg_temp.pin_test_ids (name, id) values
    ('own', v_own),
    ('other', v_other),
    ('d2', v_d2),
    ('d3', v_d3),
    ('d4', v_d4),
    ('showcase', v_showcase),
    ('faculty_a', (select id from public.profiles where email = 'pin-faculty-a@example.com')),
    ('faculty_b', (select id from public.profiles where email = 'pin-faculty-b@example.com')),
    ('faculty_pending', (select id from public.profiles where email = 'pin-faculty-pending@example.com')),
    ('faculty_rejected', (select id from public.profiles where email = 'pin-faculty-rejected@example.com')),
    ('admin', (select id from public.profiles where email = 'pin-admin@example.com')),
    ('student', v_student);
end $$;

-- ---------------------------------------------------------
-- TEST 0: an admin needs no faculty verification at all
--
-- The admin fixture satisfies the database's admin/profile invariant, so its
-- stored faculty_status is 'approved'. To prove the RPC does not depend on
-- is_verified_faculty(), this transaction temporarily replaces that helper
-- with `select false`, performs a real pin and unpin as the admin, then rolls
-- the whole transaction back (including the helper replacement and the pin).
-- ---------------------------------------------------------
\echo ''
\echo 'TEST 0: admin without faculty verification can pin and unpin'
begin;

create or replace function public.is_verified_faculty(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select false;
$$;

do $$
declare
  v_own uuid := (select id from pg_temp.pin_test_ids where name = 'own');
  v_admin uuid := (select id from pg_temp.pin_test_ids where name = 'admin');
  v_pinned_by uuid;
  v_active int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  if public.is_verified_faculty(v_admin) then
    raise exception 'FAIL: test helper did not disable faculty verification';
  end if;
  if not public.is_admin(v_admin) then
    raise exception 'FAIL: admin fixture is not an admin';
  end if;

  perform public.pin_discussion(v_own);

  reset role;

  select pinned_by into v_pinned_by
  from public.discussion_pins
  where post_id = v_own and unpinned_at is null and pin_expires_at > now();

  if v_pinned_by is distinct from v_admin then
    raise exception 'FAIL: admin pin recorded pinned_by=% (expected %)', v_pinned_by, v_admin;
  end if;

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform public.unpin_discussion(v_own);
  reset role;

  select count(*) into v_active
  from public.discussion_pins
  where post_id = v_own
    and unpinned_at is null
    and pin_expires_at > now();
  if v_active <> 0 then
    raise exception 'FAIL: admin unpin left % active pin(s) on the discussion', v_active;
  end if;

  raise notice 'PASS 0: admin pinned and unpinned with is_verified_faculty() forced false';
end $$;

rollback;

-- ---------------------------------------------------------
-- TEST 1: verified faculty can pin their own discussion
-- ---------------------------------------------------------
\echo ''
\echo 'TEST 1: verified faculty pins their own discussion'
do $$
declare
  v_own uuid := (select id from pg_temp.pin_test_ids where name = 'own');
  v_faculty uuid := (select id from pg_temp.pin_test_ids where name = 'faculty_a');
  v_active int;
  v_pinned_by uuid;
  v_duration interval;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_faculty, 'role', 'authenticated')::text, true);

  perform public.pin_discussion(v_own);

  reset role;

  select count(*) into v_active
  from public.discussion_pins
  where post_id = v_own and unpinned_at is null and pin_expires_at > now();

  select pinned_by, pin_expires_at - pinned_at
    into v_pinned_by, v_duration
  from public.discussion_pins
  where post_id = v_own and unpinned_at is null and pin_expires_at > now();

  if v_active <> 1 then
    raise exception 'FAIL: expected 1 active pin on own discussion, found %', v_active;
  end if;
  if v_pinned_by is distinct from v_faculty then
    raise exception 'FAIL: pinned_by was % (expected %)', v_pinned_by, v_faculty;
  end if;
  if v_duration <> interval '7 days' then
    raise exception 'FAIL: pin duration was % (expected exactly 7 days)', v_duration;
  end if;

  raise notice 'PASS 1: own discussion pinned for exactly 7 days';
end $$;

-- ---------------------------------------------------------
-- TEST 2: verified faculty can pin another user's discussion
-- ---------------------------------------------------------
\echo ''
\echo 'TEST 2: verified faculty pins another user''s discussion'
do $$
declare
  v_other uuid := (select id from pg_temp.pin_test_ids where name = 'other');
  v_faculty_b uuid := (select id from pg_temp.pin_test_ids where name = 'faculty_b');
  v_pinned_by uuid;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_faculty_b, 'role', 'authenticated')::text, true);

  perform public.pin_discussion(v_other);

  -- A duplicate pin is rejected with a clear message.
  perform public.pin_test_expect_error(
    format('select public.pin_discussion(%L)', v_other),
    'already pinned'
  );

  reset role;

  select pinned_by into v_pinned_by
  from public.discussion_pins
  where post_id = v_other and unpinned_at is null and pin_expires_at > now();

  if v_pinned_by is distinct from v_faculty_b then
    raise exception 'FAIL: cross-user pin was recorded as % (expected %)', v_pinned_by, v_faculty_b;
  end if;

  raise notice 'PASS 2: faculty B pinned faculty A/student content; duplicate rejected';
end $$;

-- ---------------------------------------------------------
-- TEST 3: students cannot pin or unpin
-- ---------------------------------------------------------
\echo ''
\echo 'TEST 3: students cannot pin or unpin'
do $$
declare
  v_d2 uuid := (select id from pg_temp.pin_test_ids where name = 'd2');
  v_own uuid := (select id from pg_temp.pin_test_ids where name = 'own');
  v_student uuid := (select id from pg_temp.pin_test_ids where name = 'student');
  v_active int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_student, 'role', 'authenticated')::text, true);

  perform public.pin_test_expect_error(
    format('select public.pin_discussion(%L)', v_d2),
    'Only admins and verified faculty'
  );
  perform public.pin_test_expect_error(
    format('select public.unpin_discussion(%L)', v_own),
    'Only admins and verified faculty'
  );

  reset role;

  select count(*) into v_active
  from public.discussion_pins
  where unpinned_at is null and pin_expires_at > now();

  if v_active <> 2 then
    raise exception 'FAIL: student attempts changed the active pin count to %', v_active;
  end if;

  raise notice 'PASS 3: student pin/unpin calls rejected';
end $$;

-- ---------------------------------------------------------
-- TEST 4: unapproved faculty cannot pin or unpin
-- ---------------------------------------------------------
\echo ''
\echo 'TEST 4: unapproved faculty cannot pin or unpin'
do $$
declare
  v_d2 uuid := (select id from pg_temp.pin_test_ids where name = 'd2');
  v_own uuid := (select id from pg_temp.pin_test_ids where name = 'own');
  v_pending uuid := (select id from pg_temp.pin_test_ids where name = 'faculty_pending');
  v_rejected uuid := (select id from pg_temp.pin_test_ids where name = 'faculty_rejected');
  v_active int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_pending, 'role', 'authenticated')::text, true);

  perform public.pin_test_expect_error(
    format('select public.pin_discussion(%L)', v_d2),
    'Only admins and verified faculty'
  );
  perform public.pin_test_expect_error(
    format('select public.unpin_discussion(%L)', v_own),
    'Only admins and verified faculty'
  );

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_rejected, 'role', 'authenticated')::text, true);

  perform public.pin_test_expect_error(
    format('select public.pin_discussion(%L)', v_d2),
    'Only admins and verified faculty'
  );
  perform public.pin_test_expect_error(
    format('select public.unpin_discussion(%L)', v_own),
    'Only admins and verified faculty'
  );

  reset role;

  select count(*) into v_active
  from public.discussion_pins
  where unpinned_at is null and pin_expires_at > now();

  if v_active <> 2 then
    raise exception 'FAIL: unapproved faculty attempts changed the active pin count to %', v_active;
  end if;

  raise notice 'PASS 4: pending/rejected faculty calls rejected';
end $$;

-- ---------------------------------------------------------
-- TEST 5: three active pins succeed; the fourth is rejected
-- ---------------------------------------------------------
\echo ''
\echo 'TEST 5: global limit of three active pins'
do $$
declare
  v_d2 uuid := (select id from pg_temp.pin_test_ids where name = 'd2');
  v_d3 uuid := (select id from pg_temp.pin_test_ids where name = 'd3');
  v_showcase uuid := (select id from pg_temp.pin_test_ids where name = 'showcase');
  v_faculty uuid := (select id from pg_temp.pin_test_ids where name = 'faculty_a');
  v_active int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_faculty, 'role', 'authenticated')::text, true);

  perform public.pin_discussion(v_d2);

  select count(*) into v_active
  from public.discussion_pins
  where unpinned_at is null and pin_expires_at > now();

  if v_active <> 3 then
    raise exception 'FAIL: expected 3 active pins, found %', v_active;
  end if;

  perform public.pin_test_expect_error(
    format('select public.pin_discussion(%L)', v_d3),
    'The community already has 3 active pinned discussions. Wait for a pin to expire or unpin one first.'
  );

  perform public.pin_test_expect_error(
    format('select public.pin_discussion(%L)', v_showcase),
    'Only discussions can be pinned'
  );

  reset role;

  select count(*) into v_active
  from public.discussion_pins
  where unpinned_at is null and pin_expires_at > now();

  if v_active <> 3 then
    raise exception 'FAIL: rejected fourth pin changed the active count to %', v_active;
  end if;

  raise notice 'PASS 5: third pin accepted, fourth rejected with the limit message';
end $$;

-- ---------------------------------------------------------
-- TEST S: RLS/grant surface
-- ---------------------------------------------------------
\echo ''
\echo 'TEST S: active pins are readable; direct writes are denied'
do $$
declare
  v_student uuid := (select id from pg_temp.pin_test_ids where name = 'student');
  v_own uuid := (select id from pg_temp.pin_test_ids where name = 'own');
  v_n int;
  v_write_policies int;
begin
  -- Anonymous visitors and signed-in students see active pin information.
  set local role anon;
  perform set_config('request.jwt.claims', '', true);
  select count(*) into v_n from public.discussion_pins;
  reset role;
  if v_n <> 3 then
    raise exception 'FAIL: anon saw % active pin rows (expected 3)', v_n;
  end if;

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_student, 'role', 'authenticated')::text, true);
  select count(*) into v_n from public.discussion_pins;
  reset role;
  if v_n <> 3 then
    raise exception 'FAIL: student saw % active pin rows (expected 3)', v_n;
  end if;

  -- Direct writes are denied at the privilege layer (and there are no
  -- write policies either).
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_student, 'role', 'authenticated')::text, true);
  perform public.pin_test_expect_error(
    format('insert into public.discussion_pins (post_id, pinned_by) values (%L, %L)', v_own, v_student),
    'permission denied'
  );
  perform public.pin_test_expect_error(
    format('update public.discussion_pins set unpinned_at = now() where post_id = %L', v_own),
    'permission denied'
  );
  perform public.pin_test_expect_error(
    format('delete from public.discussion_pins where post_id = %L', v_own),
    'permission denied'
  );
  reset role;

  select count(*) into v_write_policies
  from pg_policies
  where schemaname = 'public' and tablename = 'discussion_pins'
    and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL');
  if v_write_policies <> 0 then
    raise exception 'FAIL: % direct write policy/policies exist on discussion_pins', v_write_policies;
  end if;

  if has_function_privilege('anon', 'public.pin_discussion(uuid)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute pin_discussion';
  end if;
  if has_function_privilege('anon', 'public.unpin_discussion(uuid)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute unpin_discussion';
  end if;
  if not has_function_privilege('authenticated', 'public.pin_discussion(uuid)', 'EXECUTE') then
    raise exception 'FAIL: authenticated cannot execute pin_discussion';
  end if;

  raise notice 'PASS S: active rows readable; writes denied; RPC grants correct';
end $$;

-- ---------------------------------------------------------
-- TEST 6: expired pins do not count toward the limit
-- ---------------------------------------------------------
\echo ''
\echo 'TEST 6: expired pins do not count toward the limit'
do $$
declare
  v_d2 uuid := (select id from pg_temp.pin_test_ids where name = 'd2');
  v_d3 uuid := (select id from pg_temp.pin_test_ids where name = 'd3');
  v_faculty uuid := (select id from pg_temp.pin_test_ids where name = 'faculty_a');
  v_active int;
begin
  -- Simulate the passage of time for d2's pin. Both instants move into the
  -- past so the row still satisfies pin_expires_at > pinned_at; no cleanup
  -- job runs.
  update public.discussion_pins
  set pinned_at = now() - interval '8 days',
      pin_expires_at = now() - interval '1 day'
  where post_id = v_d2 and unpinned_at is null;

  select count(*) into v_active
  from public.discussion_pins
  where unpinned_at is null and pin_expires_at > now();
  if v_active <> 2 then
    raise exception 'FAIL: expired pin still counted (active = %)', v_active;
  end if;

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_faculty, 'role', 'authenticated')::text, true);
  perform public.pin_discussion(v_d3);
  reset role;

  select count(*) into v_active
  from public.discussion_pins
  where unpinned_at is null and pin_expires_at > now();
  if v_active <> 3 then
    raise exception 'FAIL: expected 3 active pins after reusing an expired slot, found %', v_active;
  end if;

  raise notice 'PASS 6: expired pin excluded from the count and its slot reused';
end $$;

-- ---------------------------------------------------------
-- TEST 7: expiry works through query logic; re-pin starts a new period
-- ---------------------------------------------------------
\echo ''
\echo 'TEST 7: 7-day expiry without a cleanup job; re-pin restarts the clock'
do $$
declare
  v_d3 uuid := (select id from pg_temp.pin_test_ids where name = 'd3');
  v_faculty uuid := (select id from pg_temp.pin_test_ids where name = 'faculty_a');
  v_n int;
  v_old_unpinned timestamptz;
  v_new_expires timestamptz;
  v_new_pinned timestamptz;
begin
  -- Simulate d3's pin reaching its expiry instant.
  update public.discussion_pins
  set pinned_at = now() - interval '8 days',
      pin_expires_at = now() - interval '1 second'
  where post_id = v_d3 and unpinned_at is null;

  -- Expired rows are invisible to the API even though the row still exists
  -- and no cleanup job has touched it.
  set local role anon;
  perform set_config('request.jwt.claims', '', true);
  select count(*) into v_n from public.discussion_pins where post_id = v_d3;
  reset role;
  if v_n <> 0 then
    raise exception 'FAIL: expired pin was still visible through RLS (rows = %)', v_n;
  end if;

  -- Unpinning an already-expired pin reports the truthful state.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_faculty, 'role', 'authenticated')::text, true);
  perform public.pin_test_expect_error(
    format('select public.unpin_discussion(%L)', v_d3),
    'already expired'
  );

  -- Re-pinning starts a fresh 7-day period and closes the expired row.
  perform public.pin_discussion(v_d3);
  reset role;

  select unpinned_at into v_old_unpinned
  from public.discussion_pins
  where post_id = v_d3 and unpinned_at is not null
  order by pinned_at desc
  limit 1;

  select pinned_at, pin_expires_at into v_new_pinned, v_new_expires
  from public.discussion_pins
  where post_id = v_d3 and unpinned_at is null
  order by pinned_at desc
  limit 1;

  if v_old_unpinned is null then
    raise exception 'FAIL: expired row was not closed on re-pin';
  end if;
  if v_new_pinned is null or v_new_expires - v_new_pinned <> interval '7 days' then
    raise exception 'FAIL: re-pin did not start a fresh 7-day period';
  end if;
  if v_new_expires <= now() then
    raise exception 'FAIL: re-pinned row is already expired';
  end if;

  raise notice 'PASS 7: expired pin hidden by queries; re-pin restarted 7-day clock';
end $$;

-- ---------------------------------------------------------
-- TEST 8: unpinning frees a slot immediately (any verified faculty)
-- ---------------------------------------------------------
\echo ''
\echo 'TEST 8: any verified faculty may unpin; the slot frees immediately'
do $$
declare
  v_own uuid := (select id from pg_temp.pin_test_ids where name = 'own');
  v_d4 uuid := (select id from pg_temp.pin_test_ids where name = 'd4');
  v_faculty_b uuid := (select id from pg_temp.pin_test_ids where name = 'faculty_b');
  v_active int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_faculty_b, 'role', 'authenticated')::text, true);

  -- own was pinned by faculty A; faculty B can unpin it.
  perform public.unpin_discussion(v_own);

  select count(*) into v_active
  from public.discussion_pins
  where unpinned_at is null and pin_expires_at > now();
  if v_active <> 2 then
    raise exception 'FAIL: unpin did not free the slot (active = %)', v_active;
  end if;

  perform public.pin_discussion(v_d4);
  reset role;

  select count(*) into v_active
  from public.discussion_pins
  where unpinned_at is null and pin_expires_at > now();
  if v_active <> 3 then
    raise exception 'FAIL: freed slot was not reusable (active = %)', v_active;
  end if;

  raise notice 'PASS 8: cross-faculty unpin freed a slot and a new pin used it';
end $$;

-- ---------------------------------------------------------
-- TEST 9: concurrent pin requests cannot exceed three active pins
--
-- Two real sessions race for the last slot. Session A holds the
-- transaction-scoped advisory lock and commits the third pin; session B
-- waits, then re-reads the count and is rejected.
-- ---------------------------------------------------------
\echo ''
\echo 'TEST 9: concurrent pin requests cannot exceed three'
do $$
declare
  v_own uuid := (select id from pg_temp.pin_test_ids where name = 'own');
  v_other uuid := (select id from pg_temp.pin_test_ids where name = 'other');
  v_faculty_a uuid := (select id from pg_temp.pin_test_ids where name = 'faculty_a');
begin
  -- Reset to exactly two active pins. This must COMMIT before the race:
  -- pin_discussion() takes a transaction-scoped advisory lock, so calling it
  -- in the same transaction that waits on dblink would deadlock the test.
  update public.discussion_pins
  set unpinned_at = now()
  where unpinned_at is null;

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_faculty_a, 'role', 'authenticated')::text, true);
  perform public.pin_discussion(v_own);
  perform public.pin_discussion(v_other);
  reset role;
end $$;

do $$
declare
  v_d2 uuid := (select id from pg_temp.pin_test_ids where name = 'd2');
  v_d3 uuid := (select id from pg_temp.pin_test_ids where name = 'd3');
  v_faculty_a uuid := (select id from pg_temp.pin_test_ids where name = 'faculty_a');
  v_faculty_b uuid := (select id from pg_temp.pin_test_ids where name = 'faculty_b');
  v_active int;
  v_result uuid;
  v_error text;
  v_wait int;
begin
  perform dblink_connect('pin_a', format('dbname=%s user=%s', current_database(), current_user));
  perform dblink_connect('pin_b', format('dbname=%s user=%s', current_database(), current_user));

  perform dblink_exec('pin_a', format('set request.jwt.claims = %L',
    json_build_object('sub', v_faculty_a, 'role', 'authenticated')::text));
  perform dblink_exec('pin_b', format('set request.jwt.claims = %L',
    json_build_object('sub', v_faculty_b, 'role', 'authenticated')::text));

  perform dblink_exec('pin_a', 'begin');
  perform dblink_send_query('pin_a', format('select public.pin_discussion(%L)', v_d2));

  -- Wait until session A actually holds the pin advisory lock, so B is
  -- guaranteed to race against a live transaction rather than starting
  -- first by accident.
  for v_wait in 1..50 loop
    exit when exists (
      select 1
      from pg_locks
      where locktype = 'advisory'
        and granted
        and ((classid::bigint << 32) | objid::bigint) = 2026102301
    );
    perform pg_sleep(0.1);
  end loop;

  if not exists (
    select 1
    from pg_locks
    where locktype = 'advisory'
      and granted
      and ((classid::bigint << 32) | objid::bigint) = 2026102301
  ) then
    raise exception 'FAIL: session A never acquired the pin advisory lock';
  end if;

  perform dblink_exec('pin_b', 'begin');
  perform dblink_send_query('pin_b', format('select public.pin_discussion(%L)', v_d3));
  perform pg_sleep(0.3);

  select pin_id into v_result
  from dblink_get_result('pin_a') as t(pin_id uuid);
  if v_result is null then
    raise exception 'FAIL: session A did not receive a pin id';
  end if;
  -- Consume the command-complete result before issuing another command on
  -- the same dblink connection, then commit to release the advisory lock.
  perform * from dblink_get_result('pin_a') as t(pin_id uuid);
  perform dblink_exec('pin_a', 'commit');
  perform dblink_disconnect('pin_a');

  begin
    select pin_id into v_result
    from dblink_get_result('pin_b') as t(pin_id uuid);
    v_error := null;
  exception when others then
    v_error := sqlerrm;
  end;

  -- The losing transaction is aborted; disconnect rolls it back and avoids
  -- leaving an outstanding result on the connection.
  perform dblink_disconnect('pin_b');

  if v_error is null then
    raise exception 'FAIL: concurrent fourth pin succeeded';
  end if;
  if position('The community already has 3 active pinned discussions' in v_error) = 0 then
    raise exception 'FAIL: concurrent loser got "%" instead of the global-limit message', v_error;
  end if;

  select count(*) into v_active
  from public.discussion_pins
  where unpinned_at is null and pin_expires_at > now();
  if v_active <> 3 then
    raise exception 'FAIL: concurrency produced % active pins (expected 3)', v_active;
  end if;

  raise notice 'PASS 9: two concurrent requests produced exactly three active pins';
exception when others then
  begin perform dblink_disconnect('pin_a'); exception when others then null; end;
  begin perform dblink_disconnect('pin_b'); exception when others then null; end;
  raise;
end $$;

-- ---------------------------------------------------------
-- TEST 10: discussions, comments, reactions, authors and pagination
-- ---------------------------------------------------------
\echo ''
\echo 'TEST 10: existing feed data and pagination are unchanged'
do $$
declare
  v_own uuid := (select id from pg_temp.pin_test_ids where name = 'own');
  v_student uuid := (select id from pg_temp.pin_test_ids where name = 'student');
  v_author uuid;
  v_comments int;
  v_likes int;
  v_upvotes int;
  v_discussions int;
  v_page1 int;
  v_page2 int;
  v_overlap int;
begin
  select author_id into v_author from public.posts where id = v_own;
  if v_author is distinct from (select id from public.profiles where email = 'pin-faculty-a@example.com') then
    raise exception 'FAIL: discussion author changed';
  end if;

  select count(*) into v_comments from public.comments where post_id = v_own;
  select count(*) into v_likes from public.likes where post_id = v_own;
  select count(*) into v_upvotes from public.upvotes where post_id = v_own;
  if v_comments <> 1 or v_likes <> 1 or v_upvotes <> 1 then
    raise exception 'FAIL: comments/likes/upvotes changed (c=%, l=%, u=%)', v_comments, v_likes, v_upvotes;
  end if;

  select count(*) into v_discussions
  from public.posts
  where title like 'PinTest %' and type = 'discussion';
  if v_discussions <> 5 then
    raise exception 'FAIL: expected 5 fixture discussions, found %', v_discussions;
  end if;

  -- The regular feed's ordering + pagination is still deterministic.
  with page1 as (
    select id from public.posts
    where title like 'PinTest %'
    order by created_at desc, id desc
    limit 2 offset 0
  ), page2 as (
    select id from public.posts
    where title like 'PinTest %'
    order by created_at desc, id desc
    limit 2 offset 2
  )
  select
    (select count(*) from page1),
    (select count(*) from page2),
    (select count(*) from page1 p join page2 q on p.id = q.id)
  into v_page1, v_page2, v_overlap;

  if v_page1 <> 2 or v_page2 <> 2 or v_overlap <> 0 then
    raise exception 'FAIL: pagination changed (page1=%, page2=%, overlap=%)', v_page1, v_page2, v_overlap;
  end if;

  raise notice 'PASS 10: authors, comments, reactions and pagination preserved';
end $$;

-- ---------------------------------------------------------
-- Cleanup (fixtures only; the migration ledger stays)
-- ---------------------------------------------------------
delete from public.discussion_pins
where post_id in (select id from public.posts where title like 'PinTest %');
delete from public.posts where title like 'PinTest %';
delete from auth.users where email like 'pin-%@example.com';
drop function if exists public.pin_test_expect_error(text, text);

\echo ''
\echo 'All discussion pin SQL tests passed'
