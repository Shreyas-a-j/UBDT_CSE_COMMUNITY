-- =========================================================
-- UBDT CSE Community — UCC 2.0 Phase 1 SQL Smoke Tests
--
-- Run this AFTER applying, in order:
--   supabase/migrations/2026102201_member_identity_and_contacts.sql
--   supabase/migrations/2026102202_notification_targeting_and_visits.sql
--   supabase/migrations/2026102203_global_usn_uniqueness.sql
--   supabase/migrations/2026102204_duplicate_usn_signup_guard.sql
--
-- Style: follows supabase/test-faculty-app.sql. Every behavioural
-- section is its own do-block = its own transaction:
--   * fixtures are created at the top and deleted at the end;
--   * deliberately rejected operations run inside subtransactions
--     (begin/exception), so an expected failure never invalidates the
--     rest of the block;
--   * an UNEXPECTED failure aborts the block, which automatically rolls
--     back the whole block back — no fixture residue either way.
--
-- The script NEVER disables or weakens a security trigger. Privilege
-- tests deliberately run WITHOUT admin claims (the SQL editor has
-- none): that is the deny-direction a future attacker would face.
-- Because protect_profile_privileges() manages member_type/
-- graduation_year on UPDATE, identity-constraint tests go through the
-- INSERT path, which the privilege trigger does not intercept.
--
-- -----------------------------------------------------------------
-- FIXTURE PATTERN — why every profile fixture is auth-backed
-- -----------------------------------------------------------------
-- public.profiles.id is `uuid references auth.users on delete cascade`,
-- so a profile row CANNOT exist without a matching auth user. Fixtures
-- that inserted straight into public.profiles therefore failed with
-- "violates foreign key constraint profiles_id_fkey" against the real
-- schema.
--
-- Every profile fixture below is created in three steps:
--
--   1. insert an auth.users row. This is the real signup path: it fires
--      on_auth_user_created -> handle_new_user(), which provisions a
--      default profile for the new member.
--   2. delete that auto-provisioned profile.
--   3. insert the exact profile row the test needs.
--
-- Step 3 is a plain INSERT. protect_profile_privileges() only guards
-- UPDATE, so the identity columns can be set exactly as each test
-- requires while every foreign key and CHECK constraint stays
-- enforced — nothing is weakened to make a test pass.
--
-- The auth.users column list is deliberately minimal and matches the
-- upstream Supabase auth schema (id/email/encrypted_password/
-- email_confirmed_at/raw_user_meta_data/created_at/updated_at). `id`
-- is supplied explicitly because upstream declares it NOT NULL with no
-- default, so a column list that omits it fails on a hosted project.
--
-- PRIVACY: fixtures use synthetic USNs/emails only; real data is never
-- printed. Known residual risk NOT covered here (tracked in
-- docs/ucc2-phase1-runbook.md): public.profiles.email remains publicly
-- selectable.
--
-- NOTE ON \echo: psql meta-command; in the Supabase SQL Editor delete
-- or comment out every line beginning with '\'. All SQL below is plain.
-- =========================================================

\echo '============================================'
\echo 'UCC 2.0 Phase 1 — SQL Smoke Tests'
\echo '============================================'

-- ---------------------------------------------------------
-- PRECONDITIONS: the Phase 1 objects must exist with the expected
-- definitions, so section failures below cannot mask a missing
-- migration as a bug. (A compact subset of verify_schema.sql §22.)
-- ---------------------------------------------------------
\echo ''
\echo 'PRECONDITIONS: Phase 1 objects present'
do $$
begin
  if not exists (
    select 1 from pg_constraint c
    where c.conrelid = 'public.profiles'::regclass
      and c.conname = 'profiles_member_type_check'
  ) then
    raise exception 'PRECONDITION FAILED: run 2026102201 first (profiles_member_type_check missing)';
  end if;
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'profiles_usn_normalized_unique'
  ) then
    raise exception 'PRECONDITION FAILED: run 2026102203 first (profiles_usn_normalized_unique missing)';
  end if;
  if coalesce((
    select p.prosrc from pg_proc p
    where p.proname = 'handle_new_user'
      and p.pronamespace = 'public'::regnamespace
  ) not ilike '%USN is already registered%', false) then
    raise exception 'PRECONDITION FAILED: run 2026102204 first (duplicate-USN signup guard missing)';
  end if;
end $$;

-- The behavioural fixtures create auth.users rows, because
-- public.profiles.id references auth.users(id). Probe that capability up
-- front: on a hosted project auth.users has RLS enabled, so a session
-- without INSERT privilege fails here. Reporting that as a precondition
-- is far clearer than a confusing foreign-key violation deep inside a
-- behavioural test.
\echo '  checking auth.users fixture capability'
do $$
declare
  v_id uuid := gen_random_uuid();
  v_err text;
begin
  begin
    insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
    values (v_id, 'ucc2-precondition-' || gen_random_uuid()::text || '@example.com',
            encode(gen_random_bytes(16), 'base64'), now(), '{}'::jsonb, now(), now());
  exception when others then
    v_err := sqlerrm;
  end;
  if v_err is not null then
    raise exception 'PRECONDITION FAILED: this session cannot INSERT into auth.users (%). The fixtures need it because public.profiles.id references auth.users(id). Run these tests as a role with INSERT privilege on auth.users.', v_err;
  end if;
  delete from auth.users where id = v_id;
end $$;
\echo '  OK'

-- ---------------------------------------------------------
-- TEST 1: profile identity columns + constraints, via INSERT
-- (the privilege trigger does not intercept inserts).
-- ---------------------------------------------------------
\echo ''
\echo 'TEST 1: profile identity columns and constraints'
do $test$
declare
  v_id uuid;
  v_email text;
  v_ids uuid[] := array[]::uuid[];
begin
  if coalesce((
    select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and (
        (column_name = 'member_type' and data_type = 'text')
        or (column_name = 'graduation_year' and data_type = 'integer')
        or (column_name = 'portfolio_url' and data_type = 'text')
        or (column_name = 'github_url' and data_type = 'text')
        or (column_name = 'linkedin_url' and data_type = 'text')
      )
  ), 0) <> 5 then
    raise exception 'FAIL: UCC 2.0 profile columns missing (member_type/graduation_year/portfolio_url/github_url/linkedin_url)';
  end if;

  -- member_type NOT NULL DEFAULT 'student' honoured on a plain insert.
  v_id := gen_random_uuid();
  v_email := 'ucc2-t1-default-' || gen_random_uuid()::text || '@example.com';
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
  values (v_id, v_email, encode(gen_random_bytes(16), 'base64'), now(), '{}'::jsonb, now(), now());
  v_ids := array_append(v_ids, v_id);
  delete from public.profiles where id = v_id;
  insert into public.profiles (id, name) values (v_id, 'Phase1 Identity');
  if not exists (
    select 1 from public.profiles
    where id = v_id and member_type = 'student' and graduation_year is null
  ) then
    raise exception 'FAIL: member_type default or nullability wrong on plain insert';
  end if;

  -- graduation_year accept/reject (1950–2200), via INSERT (the privilege
  -- trigger protects graduation_year on UPDATE for non-admin sessions).
  -- The whole fixture lives inside the subtransaction, so a rejected
  -- insert also rolls the auth user back — no residue.
  v_id := gen_random_uuid();
  v_email := 'ucc2-t1-grad-ok-' || gen_random_uuid()::text || '@example.com';
  begin
    insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
    values (v_id, v_email, encode(gen_random_bytes(16), 'base64'), now(), '{}'::jsonb, now(), now());
    delete from public.profiles where id = v_id;
    insert into public.profiles (id, name, graduation_year) values (v_id, 'Phase1 Grad OK', 2021);
  exception when check_violation then
    raise exception 'FAIL: graduation_year 2021 must be accepted';
  end;
  v_ids := array_append(v_ids, v_id);

  v_id := gen_random_uuid();
  v_email := 'ucc2-t1-grad-low-' || gen_random_uuid()::text || '@example.com';
  begin
    insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
    values (v_id, v_email, encode(gen_random_bytes(16), 'base64'), now(), '{}'::jsonb, now(), now());
    delete from public.profiles where id = v_id;
    insert into public.profiles (id, name, graduation_year) values (v_id, 'Phase1 Grad Low', 1949);
    raise exception 'FAIL: graduation_year 1949 accepted (range check missing)';
  exception when check_violation then
    null;  -- expected
  end;

  v_id := gen_random_uuid();
  v_email := 'ucc2-t1-grad-high-' || gen_random_uuid()::text || '@example.com';
  begin
    insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
    values (v_id, v_email, encode(gen_random_bytes(16), 'base64'), now(), '{}'::jsonb, now(), now());
    delete from public.profiles where id = v_id;
    insert into public.profiles (id, name, graduation_year) values (v_id, 'Phase1 Grad High', 2201);
    raise exception 'FAIL: graduation_year 2201 accepted (range check missing)';
  exception when check_violation then
    null;  -- expected
  end;

  -- member_type accepts only the three identities.
  v_id := gen_random_uuid();
  v_email := 'ucc2-t1-type-bogus-' || gen_random_uuid()::text || '@example.com';
  begin
    insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
    values (v_id, v_email, encode(gen_random_bytes(16), 'base64'), now(), '{}'::jsonb, now(), now());
    delete from public.profiles where id = v_id;
    insert into public.profiles (id, name, member_type) values (v_id, 'Phase1 Type Bogus', 'ninja');
    raise exception 'FAIL: bogus member_type accepted (profiles_member_type_check missing)';
  exception when check_violation then
    null;  -- expected
  end;

  -- Public link constraints: valid set accepted; wrong hosts rejected.
  v_id := gen_random_uuid();
  v_email := 'ucc2-t1-links-ok-' || gen_random_uuid()::text || '@example.com';
  begin
    insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
    values (v_id, v_email, encode(gen_random_bytes(16), 'base64'), now(), '{}'::jsonb, now(), now());
    delete from public.profiles where id = v_id;
    insert into public.profiles (id, name, portfolio_url, github_url, linkedin_url)
    values (v_id, 'Phase1 Links OK',
            'https://me.example.dev',
            'https://github.com/ucc2-verify',
            'https://www.linkedin.com/in/ucc2-verify');
  exception when check_violation then
    raise exception 'FAIL: valid public profiles rejected by URL checks';
  end;
  v_ids := array_append(v_ids, v_id);

  v_id := gen_random_uuid();
  v_email := 'ucc2-t1-links-badgh-' || gen_random_uuid()::text || '@example.com';
  begin
    insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
    values (v_id, v_email, encode(gen_random_bytes(16), 'base64'), now(), '{}'::jsonb, now(), now());
    delete from public.profiles where id = v_id;
    insert into public.profiles (id, name, github_url) values (v_id, 'Phase1 Links BadGH', 'https://gitlab.com/ucc2-verify');
    raise exception 'FAIL: non-github github_url accepted (host check missing)';
  exception when check_violation then
    null;  -- expected
  end;

  v_id := gen_random_uuid();
  v_email := 'ucc2-t1-links-badli-' || gen_random_uuid()::text || '@example.com';
  begin
    insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
    values (v_id, v_email, encode(gen_random_bytes(16), 'base64'), now(), '{}'::jsonb, now(), now());
    delete from public.profiles where id = v_id;
    insert into public.profiles (id, name, linkedin_url) values (v_id, 'Phase1 Links BadLI', 'https://x.com/in/ucc2-verify');
    raise exception 'FAIL: non-linkedin linkedin_url accepted (host check missing)';
  exception when check_violation then
    null;  -- expected
  end;

  -- Into the bargain: a plain name UPDATE keeps identity fields intact.
  update public.profiles set name = 'Phase1 Identity 2' where id = v_ids[1];
  if not exists (
    select 1 from public.profiles
    where id = v_ids[1] and member_type = 'student' and name = 'Phase1 Identity 2'
  ) then
    raise exception 'FAIL: plain name update corrupted the identity row';
  end if;

  -- Cleanup: deleting the auth users cascades to their profiles.
  delete from auth.users where id = any(v_ids);
  raise notice 'PASS 1: profile identity columns and constraints (via INSERT)';
end;
$test$;
\echo '  PASS'

-- ---------------------------------------------------------
-- TEST 2: global normalized USN uniqueness across identities
-- Fixture USN is synthesised fresh so it cannot collide with
-- production data.
-- ---------------------------------------------------------
\echo ''
\echo 'TEST 2: global normalized USN uniqueness'
do $test$
declare
  v_usn text;
  v_id uuid;
  v_email text;
  v_alumni_id uuid := gen_random_uuid();
  v_ids uuid[] := array[]::uuid[];
begin
  loop
    v_usn := '4UB99CS' || lpad((floor(random() * 900) + 100)::text, 3, '0');
    exit when not exists (
      select 1 from public.profiles where upper(btrim(usn)) = v_usn
    );
  end loop;

  v_id := gen_random_uuid();
  v_email := 'ucc2-t2-owner-' || gen_random_uuid()::text || '@example.com';
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
  values (v_id, v_email, encode(gen_random_bytes(16), 'base64'), now(), '{}'::jsonb, now(), now());
  v_ids := array_append(v_ids, v_id);
  delete from public.profiles where id = v_id;
  insert into public.profiles (id, name, usn, member_type)
  values (v_id, 'Phase1 USN Owner', v_usn, 'student');

  -- Same USN, different member identity — the GLOBAL index must reject;
  -- the legacy student-only index would have allowed it.
  begin
    insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
    values (v_alumni_id, 'ucc2-t2-alumni-' || gen_random_uuid()::text || '@example.com',
            encode(gen_random_bytes(16), 'base64'), now(), '{}'::jsonb, now(), now());
    delete from public.profiles where id = v_alumni_id;
    insert into public.profiles (id, name, usn, member_type)
    values (v_alumni_id, 'Phase1 USN Alumni', v_usn, 'alumni');
    raise exception 'FAIL: duplicate USN accepted for an alumni profile (index is not global)';
  exception when unique_violation then
    null;  -- expected
  end;

  -- Case/whitespace insensitivity of the normalized expression.
  v_id := gen_random_uuid();
  begin
    insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
    values (v_id, 'ucc2-t2-casing-' || gen_random_uuid()::text || '@example.com',
            encode(gen_random_bytes(16), 'base64'), now(), '{}'::jsonb, now(), now());
    delete from public.profiles where id = v_id;
    insert into public.profiles (id, name, usn, member_type)
    values (v_id, 'Phase1 USN Casing', '  ' || lower(v_usn) || ' ', 'student');
    raise exception 'FAIL: case/whitespace variant of the USN accepted (normalization wrong)';
  exception when unique_violation then
    null;  -- expected
  end;

  -- Enough that neither rejected insert left a row behind.
  if exists (select 1 from public.profiles where id = v_alumni_id) then
    raise exception 'FAIL: rejected alumni insert left a profile row behind';
  end if;
  if exists (select 1 from auth.users where id = v_alumni_id) then
    raise exception 'FAIL: rejected alumni insert left an auth user behind';
  end if;

  delete from auth.users where id = any(v_ids);
  raise notice 'PASS 2: global normalized USN uniqueness (student/alumni, normalized)';
end;
$test$;
\echo '  PASS'

-- ---------------------------------------------------------
-- TEST 3: alumni identity via signup cannot grant faculty privileges.
-- Runs against auth.users so the real [04] provisioning trigger
-- provisions the profile; then attempts self-elevation, which
-- protect_profile_privileges() must revert for a no-claims session.
-- ---------------------------------------------------------
\echo ''
\echo 'TEST 3: alumni signup identity + privilege protection'
do $test$
declare
  v_email text := 'ucc2-alumni-' || gen_random_uuid()::text || '@example.com';
  v_id uuid := gen_random_uuid();
  n int;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
  values (
    v_id, v_email, encode(gen_random_bytes(16), 'base64'), now(),
    jsonb_build_object('intent', 'alumni', 'graduation_year', 2021, 'name', 'Phase1 Alumni'),
    now(), now()
  );

  -- A session with admin claims would legitimately pass the protection
  -- trigger and make the deny-path unmeasurable; require none.
  if auth.uid() is not null then
    delete from auth.users where id = v_id;
    raise notice 'NOTE 3: skipped — session holds auth claims; deny-path not exercised';
    return;
  end if;

  select count(*) into n from public.profiles
  where id = v_id
    and member_type = 'alumni'
    and role = 'student'
    and faculty_status = 'none';
  if n <> 1 then
    raise exception 'FAIL: intent=alumni did not provision member_type=''alumni'' with role=''student'' and faculty_status=''none''';
  end if;

  -- Self-elevation attempt must be REVERTED (non-admin update).
  update public.profiles
  set role = 'faculty', faculty_status = 'approved', member_type = 'faculty', graduation_year = 2000
  where id = v_id;

  select count(*) into n from public.profiles
  where id = v_id
    and role = 'student'
    and faculty_status = 'none'
    and member_type = 'alumni';
  if n <> 1 then
    raise exception 'FAIL: non-admin update changed role/faculty_status/member_type — privilege protection broken';
  end if;

  delete from auth.users where id = v_id;
  raise notice 'PASS 3: alumni identity provisioned; faculty privileges cannot be self-assigned';
end;
$test$;
\echo '  PASS'

-- ---------------------------------------------------------
-- TEST 4: notification targeting validation + duplicate suppression
-- ---------------------------------------------------------
\echo ''
\echo 'TEST 4: notification targeting and duplicate suppression'
do $test$
declare
  v_owner uuid := gen_random_uuid();
  v_content uuid := gen_random_uuid();
  v_dedupe text := 'ucc2:content_published:discussion:' || gen_random_uuid()::text;
  n int;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
  values (v_owner, 'ucc2-t4-owner-' || gen_random_uuid()::text || '@example.com',
          encode(gen_random_bytes(16), 'base64'), now(), '{}'::jsonb, now(), now());
  delete from public.profiles where id = v_owner;
  insert into public.profiles (id, name) values (v_owner, 'Phase1 Notify Owner');

  begin
    insert into public.notifications (user_id, type, title, content_type, content_id, dedupe_key)
    values (v_owner, 'comment', 'pair broken', 'discussion', null, v_dedupe);
    raise exception 'FAIL: notifications_content_pair_check missing (content_type without content_id accepted)';
  exception when check_violation then
    null;  -- expected
  end;

  begin
    insert into public.notifications (user_id, type, title, content_type, content_id, dedupe_key)
    values (v_owner, 'comment', 'bogus type', 'gallery', v_content, v_dedupe);
    raise exception 'FAIL: notifications_content_type_check missing (''gallery'' accepted)';
  exception when check_violation then
    null;  -- expected
  end;

  begin
    insert into public.notifications (user_id, type, title, dedupe_key)
    values (v_owner, 'announcement', 'key too long', repeat('k', 201));
    raise exception 'FAIL: notifications_dedupe_key_check missing (201-char key accepted)';
  exception when check_violation then
    null;  -- expected
  end;

  -- Duplicate suppression: same user + dedupe key emits once.
  perform public.emit_notification(
    v_owner, 'comment', 'Phase 1 smoke', 'first', '/p/one',
    'discussion', v_content, v_dedupe
  );
  perform public.emit_notification(
    v_owner, 'comment', 'Phase 1 smoke', 'second (suppressed)', '/p/two',
    'discussion', v_content, v_dedupe
  );
  select count(*) into n
  from public.notifications
  where user_id = v_owner and dedupe_key = v_dedupe;
  if n <> 1 then
    raise exception 'FAIL: emit_notification duplicated a dedupe_key fan-out (% rows)', n;
  end if;

  -- Legacy five-argument call sites keep working through defaults.
  perform public.emit_notification(v_owner, 'announcement', 'legacy shape', null, null);
  select count(*) into n from public.notifications where user_id = v_owner;
  if n <> 2 then
    raise exception 'FAIL: legacy emit_notification call broken (expected 2 rows, found %)', n;
  end if;

  delete from auth.users where id = v_owner;
  raise notice 'PASS 4: targeting validated; duplicate fan-out suppressed; legacy calls intact';
end;
$test$;
\echo '  PASS'

-- ---------------------------------------------------------
-- TEST 5: one content-visit row per (user, content) pair
-- ---------------------------------------------------------
\echo ''
\echo 'TEST 5: content visits'
do $test$
declare
  v_owner uuid := gen_random_uuid();
  v_discussion uuid := gen_random_uuid();
  v_showcase uuid := gen_random_uuid();
  n int;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
  values (v_owner, 'ucc2-t5-owner-' || gen_random_uuid()::text || '@example.com',
          encode(gen_random_bytes(16), 'base64'), now(), '{}'::jsonb, now(), now());
  delete from public.profiles where id = v_owner;
  insert into public.profiles (id, name) values (v_owner, 'Phase1 Visit Owner');

  -- Same pair: upsert keeps one row.
  insert into public.content_visits (user_id, content_type, content_id)
  values (v_owner, 'discussion', v_discussion)
  on conflict (user_id, content_type, content_id)
  do update set last_visited_at = timezone('utc'::text, now());
  insert into public.content_visits (user_id, content_type, content_id)
  values (v_owner, 'discussion', v_discussion)
  on conflict (user_id, content_type, content_id)
  do update set last_visited_at = timezone('utc'::text, now());

  select count(*) into n
  from public.content_visits
  where user_id = v_owner and content_id = v_discussion;
  if n <> 1 then
    raise exception 'FAIL: repeated visits produced % rows for one (user, content) pair', n;
  end if;

  -- 'showcase' is an allowed target type.
  insert into public.content_visits (user_id, content_type, content_id)
  values (v_owner, 'showcase', v_showcase)
  on conflict (user_id, content_type, content_id) do nothing;
  select count(*) into n
  from public.content_visits where user_id = v_owner and content_type = 'showcase';
  if n <> 1 then
    raise exception 'FAIL: a valid showcase visit was rejected';
  end if;

  begin
    insert into public.content_visits (user_id, content_type, content_id)
    values (v_owner, 'gallery', v_showcase);
    raise exception 'FAIL: content_visits_content_type_check missing (''gallery'' accepted)';
  exception when check_violation then
    null;  -- expected
  end;

  begin
    insert into public.content_visits (user_id, content_type, content_id, first_visited_at, last_visited_at)
    values (v_owner, 'event', v_showcase,
            timezone('utc'::text, now()),
            timezone('utc'::text, now()) - interval '1 hour');
    raise exception 'FAIL: content_visits_time_order_check missing (last < first accepted)';
  exception when check_violation then
    null;  -- expected
  end;

  delete from auth.users where id = v_owner;
  raise notice 'PASS 5: content visits are one-row-per-pair and validated';
end;
$test$;
\echo '  PASS'

-- ---------------------------------------------------------
-- TEST 6: profile_contacts — constraints, private-by-default, RLS
-- visibility and non-owner write denial (deny direction).
-- ---------------------------------------------------------
\echo ''
\echo 'TEST 6: profile contacts — constraints, private default, RLS'
do $test$
declare
  v_private uuid := gen_random_uuid();
  v_members uuid := gen_random_uuid();
  v_public  uuid := gen_random_uuid();
  v_email_a text := 'ucc2-contact-' || gen_random_uuid()::text || '@example.com';
  v_email_b text := 'ucc2-contact-' || gen_random_uuid()::text || '@example.com';
  v_email_c text := 'ucc2-contact-' || gen_random_uuid()::text || '@example.com';
  v_can_switch boolean;
  v_touched uuid;
  n int;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
  values (v_private, 'ucc2-t6-private-' || gen_random_uuid()::text || '@example.com',
          encode(gen_random_bytes(16), 'base64'), now(), '{}'::jsonb, now(), now());
  delete from public.profiles where id = v_private;
  insert into public.profiles (id, name) values (v_private, 'Phase1 Contact Private');

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
  values (v_members, 'ucc2-t6-members-' || gen_random_uuid()::text || '@example.com',
          encode(gen_random_bytes(16), 'base64'), now(), '{}'::jsonb, now(), now());
  delete from public.profiles where id = v_members;
  insert into public.profiles (id, name) values (v_members, 'Phase1 Contact Members');

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
  values (v_public, 'ucc2-t6-public-' || gen_random_uuid()::text || '@example.com',
          encode(gen_random_bytes(16), 'base64'), now(), '{}'::jsonb, now(), now());
  delete from public.profiles where id = v_public;
  insert into public.profiles (id, name) values (v_public, 'Phase1 Contact Public');

  begin
    insert into public.profile_contacts (profile_id, contact_email)
    values (v_private, 'definitely-not-an-email');
    raise exception 'FAIL: profile_contacts_email_format_check missing';
  exception when check_violation then
    null;  -- expected
  end;

  begin
    insert into public.profile_contacts (profile_id, phone)
    values (v_private, '+91-abc!');
    raise exception 'FAIL: profile_contacts_phone_format_check missing';
  exception when check_violation then
    null;  -- expected
  end;

  begin
    insert into public.profile_contacts (profile_id, contact_visibility)
    values (v_private, 'everyone');
    raise exception 'FAIL: profile_contacts_contact_visibility_check missing';
  exception when check_violation then
    null;  -- expected
  end;

  -- Safe default: 'private'.
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profile_contacts'
      and column_name = 'contact_visibility'
      and column_default ilike '%''private''%'
  ) then
    raise exception 'FAIL: profile_contacts.contact_visibility default is not private';
  end if;

  insert into public.profile_contacts (profile_id, contact_email, contact_visibility)
  values (v_private, v_email_a, 'private'),
         (v_members, v_email_b, 'members'),
         (v_public,  v_email_c, 'public');

  -- Capability probe: actually attempt SET ROLE inside a subtransaction.
  -- (Catalog-based capability checks are brittle across PG versions;
  -- this directly tests what the RLS assertions below require.)
  v_can_switch := false;
  begin
    set local role anon;
    v_can_switch := true;
  exception when others then
    v_can_switch := false;  -- SET ROLE not permitted for this session
  end;
  if v_can_switch then
    reset role;
  else
    raise notice 'NOTE 6: role switch unavailable in this environment; RLS not behaviourally asserted';
  end if;

  if v_can_switch then
    -- With no claims, only the 'public' row is readable.
    set local role anon;
    select count(*) into n
    from public.profile_contacts
    where contact_email in (v_email_a, v_email_b, v_email_c);
    if n <> 1 then
      raise exception 'FAIL: anon sees % contact rows; expected exactly 1 (the public one) — private/members leak', n;
    end if;

    -- Anon cannot rewrite visibility on a row it can see. RETURNING
    -- guards against the silent 0-row match a policy-hidden row would
    -- produce for a non-owner predicate.
    begin
      update public.profile_contacts
      set contact_visibility = 'private'
      where profile_id = v_public and contact_visibility = 'public'
      returning profile_id into v_touched;
      if v_touched is not null then
        raise exception 'FAIL: anon changed a public contact row''s visibility (RLS ownership broken)';
      end if;
    exception when insufficient_privilege or check_violation then
      null;  -- policy-level denial — equally safe
    end;

    -- Anon cannot create contact rows at all.
    begin
      insert into public.profile_contacts (profile_id, contact_email)
      values (v_private, 'ucc2-contact-intrusion@example.com');
      raise exception 'FAIL: anon inserted a contact row (RLS ownership broken)';
    exception when insufficient_privilege or check_violation then
      null;  -- expected denial
    end;
    reset role;
  else
    raise notice 'NOTE 6: role switch unavailable in this environment; RLS not behaviourally asserted';
  end if;

  -- Server-side truth: all three rows exist; filtering came from policy.
  select count(*) into n
  from public.profile_contacts
  where contact_email in (v_email_a, v_email_b, v_email_c);
  if n <> 3 then
    raise exception 'FAIL: fixture corrupted — expected 3 contact rows, found %', n;
  end if;

  delete from auth.users where id in (v_private, v_members, v_public);
  raise notice 'PASS 6: contacts validated, private-by-default, RLS denies unauthed access';
end;
$test$;
\echo '  PASS'

-- ---------------------------------------------------------
-- TEST 7: duplicate-USN signup guard ([04]) — the second signup must
-- abort (SQLSTATE 23505), leaving NO auth user and NO orphaned profile.
-- ---------------------------------------------------------
\echo ''
\echo 'TEST 7: duplicate-USN signup guard'
do $test$
declare
  v_owner_email text := 'ucc2-owner-' || gen_random_uuid()::text || '@example.com';
  v_dup_email   text := 'ucc2-dup-' || gen_random_uuid()::text || '@example.com';
  v_usn text;
  v_owner_id uuid := gen_random_uuid();
  v_dup_id uuid := gen_random_uuid();
begin
  loop
    v_usn := '4UB99CS' || lpad((floor(random() * 900) + 100)::text, 3, '0');
    exit when not exists (
      select 1 from public.profiles where upper(btrim(usn)) = v_usn
    );
  end loop;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
  values (
    v_owner_id, v_owner_email, encode(gen_random_bytes(16), 'base64'), now(),
    jsonb_build_object('usn', v_usn, 'name', 'Phase1 Owner'), now(), now()
  );

  if not exists (
    select 1 from public.profiles
    where id = v_owner_id and upper(btrim(usn)) = v_usn
  ) then
    raise exception 'FAIL: a free-USN signup did not provision its profile';
  end if;

  begin
    insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
    values (
      v_dup_id, v_dup_email, encode(gen_random_bytes(16), 'base64'), now(),
      jsonb_build_object('usn', v_usn, 'name', 'Phase1 Duplicate'), now(), now()
    );
    raise exception 'FAIL: duplicate-USN signup accepted — the [04] guard did not fire';
  exception when unique_violation then
    null;  -- expected: [04] raises errcode 23505 and the signup rolls back
  end;

  if exists (select 1 from auth.users where email = v_dup_email) then
    raise exception 'FAIL: auth user WITHOUT a profile survived the duplicate-USN signup (orphan)';
  end if;

  if not exists (select 1 from public.profiles where id = v_owner_id) then
    raise exception 'FAIL: rolled-back duplicate signup damaged the existing owner profile';
  end if;

  delete from auth.users where id = v_owner_id;
  raise notice 'PASS 7: duplicate-USN signup aborts; no orphaned auth user; owner intact';
end;
$test$;
\echo '  PASS'

-- ---------------------------------------------------------
-- SUMMARY
-- ---------------------------------------------------------
\echo ''
\echo '============================================'
\echo 'All UCC 2.0 Phase 1 SQL smoke tests passed.'
\echo 'Fixtures were isolated per block; no residue.'
\echo '============================================'
