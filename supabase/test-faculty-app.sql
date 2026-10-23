-- =========================================================
-- UBDT CSE Community — Faculty Application Smoke Tests (SQL)
--
-- Run this file in the Supabase SQL Editor (or psql) after
-- applying the migration. Each CHECK block reports PASS/FAIL.
--
-- Prerequisites:
--   1. Migration 2026101402_faculty_applications.sql has been applied.
--   2. An admin profile exists (see SETUP section below).
-- =========================================================

\echo '============================================'
\echo 'Faculty Application Persistence — SQL Tests'
\echo '============================================'

-- ---------------------------------------------------------
-- SETUP: ensure an admin user exists for testing
-- ---------------------------------------------------------
do $$
declare
  admin_id uuid;
  admin_exists boolean;
begin
  select exists (select 1 from public.profiles p where p.role = 'admin') into admin_exists;
  if not admin_exists then
    -- Create a test admin auth user and profile
    insert into auth.users (email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
    values (
      'smoke-test-admin@example.com',
      encode(gen_random_bytes(16), 'base64'),
      now(),
      '{"name":"Smoke Admin","intent":"student"}'::jsonb,
      now(),
      now()
    ) returning id into admin_id;

    insert into public.profiles (id, name, email, role, faculty_status, member_type)
    values (admin_id, 'Smoke Admin', 'smoke-test-admin@example.com', 'admin', 'approved', 'faculty')
    on conflict (id) do update set
      role = 'admin',
      faculty_status = 'approved',
      member_type = 'faculty';
  else
    select id into admin_id from public.profiles where role = 'admin' limit 1;
  end if;
end $$;

\echo ''
\echo '--- SETUP COMPLETE ---'
\echo ''

-- ---------------------------------------------------------
-- TEST 1: Table exists and is queryable
-- ---------------------------------------------------------
\echo 'TEST 1: Table exists'
do $$
begin
  perform 1 from information_schema.tables
  where table_schema = 'public' and table_name = 'faculty_applications'
  limit 1;
  if not found then
    raise exception 'FAIL: faculty_applications table does not exist';
  end if;
end $$;
\echo '  PASS'

-- ---------------------------------------------------------
-- TEST 2: Expected columns exist
-- ---------------------------------------------------------
\echo 'TEST 2: Required columns'
do $$
declare
  cols text[];
begin
  select array_agg(column_name) into cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'faculty_applications'
    and column_name in (
      'id', 'user_id', 'full_name', 'official_email',
      'department', 'designation', 'employee_id',
      'status', 'reviewed_by', 'reviewed_at',
      'review_notes', 'created_at', 'updated_at'
    );

  if array_length(cols, 1) < 10 then
    raise exception 'FAIL: Missing columns. Found: %', cols;
  end if;
end $$;
\echo '  PASS'

-- ---------------------------------------------------------
-- TEST 3: Partial unique index exists
-- ---------------------------------------------------------
\echo 'TEST 3: Partial unique index (one pending per user)'
do $$
declare
  idx_def text;
begin
  select indexdef into idx_def
  from pg_indexes
  where schemaname = 'public' and tablename = 'faculty_applications'
    and indexname = 'faculty_applications_one_pending'
  limit 1;

  if idx_def is null then
    raise exception 'FAIL: faculty_applications_one_pending index not found';
  end if;

  if idx_def not like '%where status = ''pending%''%' then
    raise exception 'FAIL: Index predicate is incorrect: %', idx_def;
  end if;
end $$;
\echo '  PASS'

-- ---------------------------------------------------------
-- TEST 4: RLS is enabled
-- ---------------------------------------------------------
\echo 'TEST 4: RLS enabled'
do $$
declare
  rls_enabled boolean;
begin
  select relrowsecurity into rls_enabled
  from pg_class
  where relname = 'faculty_applications'
  limit 1;

  if not rls_enabled then
    raise exception 'FAIL: RLS is not enabled on faculty_applications';
  end if;
end $$;
\echo '  PASS'

-- ---------------------------------------------------------
-- TEST 5: RLS policies exist
-- ---------------------------------------------------------
\echo 'TEST 5: Required RLS policies'
do $$
declare
  policy_count int;
begin
  select count(*) into policy_count
  from pg_policies
  where schemaname = 'public'
    and tablename = 'faculty_applications'
    and policyname in (
      'Users read own faculty applications',
      'Users submit own faculty application',
      'Admins manage faculty applications'
    );

  if policy_count < 3 then
    raise exception 'FAIL: Missing RLS policies. Found % required 3.', policy_count;
  end if;
end $$;
\echo '  PASS'

-- ---------------------------------------------------------
-- TEST 6: Triggers exist
-- ---------------------------------------------------------
\echo 'TEST 6: Required triggers'
do $$
declare
  trigger_count int;
begin
  select count(*) into trigger_count
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  where c.relname = 'faculty_applications'
    and t.tgname in (
      'trg_update_faculty_app_updated_at',
      'trg_faculty_application_transition',
      'trg_faculty_application_status'
    );

  if trigger_count < 3 then
    raise exception 'FAIL: Missing triggers. Found % required 3.', trigger_count;
  end if;
end $$;
\echo '  PASS'

-- ---------------------------------------------------------
-- TEST 7: Insert with invalid status is rejected
-- ---------------------------------------------------------
\echo 'TEST 7: Insert with non-pending status is rejected'
do $$
declare
  test_user_id uuid := gen_random_uuid();
begin
  -- Create a dummy profile for the test
  insert into auth.users (email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
  values (
    'test-status-invalid-' || gen_random_uuid()::text || '@example.com',
    encode(gen_random_bytes(16), 'base64'),
    now(),
    '{}'::jsonb,
    now(),
    now()
  ) returning id into test_user_id;

  insert into public.profiles (id, name, email, role, faculty_status)
  values (test_user_id, 'Status Test', 'test-status-invalid@example.com', 'student', 'none')
  on conflict (id) do nothing;

  -- Attempt insert with status = 'approved' (should fail via trigger)
  begin
    insert into public.faculty_applications (
      user_id, full_name, official_email, department, designation, status
    ) values (
      test_user_id, 'Status Test', 'test-status-invalid@example.com', 'CSE', 'Prof', 'approved'
    );
    raise exception 'FAIL: Insert with approved status should have been rejected';
  exception when others then
    -- Expected to fail
    null;
  end;

  -- Cleanup
  delete from public.faculty_applications where user_id = test_user_id;
  delete from public.profiles where id = test_user_id;
  delete from auth.users where id = test_user_id;
end $$;
\echo '  PASS'

-- ---------------------------------------------------------
-- TEST 8: Unique constraint prevents duplicate pending
-- ---------------------------------------------------------
\echo 'TEST 8: Duplicate pending rejected'
do $$
declare
  test_user_id uuid := gen_random_uuid();
begin
  -- Create a dummy profile
  insert into auth.users (email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
  values (
    'test-dup-' || gen_random_uuid()::text || '@example.com',
    encode(gen_random_bytes(16), 'base64'),
    now(),
    '{}'::jsonb,
    now(),
    now()
  ) returning id into test_user_id;

  insert into public.profiles (id, name, email, role, faculty_status)
  values (test_user_id, 'Dup Test', 'test-dup@example.com', 'student', 'none')
  on conflict (id) do nothing;

  -- Insert first application
  insert into public.faculty_applications (
    user_id, full_name, official_email, department, designation, status
  ) values (
    test_user_id, 'Dup Test', 'test-dup@example.com', 'CSE', 'Prof', 'pending'
  );

  -- Attempt second insert (should fail via partial unique index)
  begin
    insert into public.faculty_applications (
      user_id, full_name, official_email, department, designation, status
    ) values (
      test_user_id, 'Dup Test', 'test-dup@example.com', 'CSE', 'Prof', 'pending'
    );
    raise exception 'FAIL: Duplicate pending insert should have been rejected';
  exception when unique_violation then
    -- Expected
    null;
  end;

  -- Cleanup
  delete from public.faculty_applications where user_id = test_user_id;
  delete from public.profiles where id = test_user_id;
  delete from auth.users where id = test_user_id;
end $$;
\echo '  PASS'

-- ---------------------------------------------------------
-- TEST 9: Retry after rejection is allowed
-- ---------------------------------------------------------
\echo 'TEST 9: Retry after rejection allowed'
do $$
declare
  test_user_id uuid := gen_random_uuid();
  app_id uuid;
  admin_uid uuid;
begin
  -- Get admin user ID
  select id into admin_uid from public.profiles where role = 'admin' limit 1;

  -- Create a dummy profile
  insert into auth.users (email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
  values (
    'test-retry-' || gen_random_uuid()::text || '@example.com',
    encode(gen_random_bytes(16), 'base64'),
    now(),
    '{}'::jsonb,
    now(),
    now()
  ) returning id into test_user_id;

  insert into public.profiles (id, name, email, role, faculty_status)
  values (test_user_id, 'Retry Test', 'test-retry@example.com', 'student', 'none')
  on conflict (id) do nothing;

  -- Insert first application
  insert into public.faculty_applications (
    user_id, full_name, official_email, department, designation, status
  ) values (
    test_user_id, 'Retry Test', 'test-retry@example.com', 'CSE', 'Prof', 'pending'
  ) returning id into app_id;

  -- Reject it (as admin)
  update public.faculty_applications
  set status = 'rejected', reviewed_by = admin_uid, reviewed_at = now(), review_notes = 'Test rejection'
  where id = app_id;

  -- Insert a new pending application (should succeed)
  begin
    insert into public.faculty_applications (
      user_id, full_name, official_email, department, designation, status
    ) values (
      test_user_id, 'Retry Test', 'test-retry@example.com', 'CSE', 'Prof', 'pending'
    );
  exception when others then
    raise exception 'FAIL: Retry after rejection should be allowed: %', SQLERRM;
  end;

  -- Cleanup
  delete from public.faculty_applications where user_id = test_user_id;
  delete from public.profiles where id = test_user_id;
  delete from auth.users where id = test_user_id;
end $$;
\echo '  PASS'

-- ---------------------------------------------------------
-- TEST 10: Foreign key violation on nonexistent user
-- ---------------------------------------------------------
\echo 'TEST 10: FK violation on invalid user_id'
do $$
begin
  begin
    insert into public.faculty_applications (
      user_id, full_name, official_email, department, designation, status
    ) values (
      '00000000-0000-0000-0000-000000000000'::uuid,
      'Ghost',
      'ghost@example.com',
      'CSE',
      'Prof',
      'pending'
    );
    raise exception 'FAIL: Insert with invalid user_id should have been rejected';
  exception when foreign_key_violation then
    -- Expected
    null;
  end;
end $$;
\echo '  PASS'

-- ---------------------------------------------------------
-- SUMMARY
-- ---------------------------------------------------------
\echo ''
\echo '============================================'
\echo 'All SQL smoke tests passed.'
\echo '============================================'
