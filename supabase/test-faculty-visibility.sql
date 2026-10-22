-- =========================================================
-- UCC 2.0 — faculty visibility + email verification (SQL tests)
--
-- Run after supabase/schema.sql (or the full migration chain) has been
-- applied to a disposable database with the Supabase auth stub:
--
--   psql ... -f supabase/local-rehearsal/auth-stub.sql
--   psql ... -f supabase/schema.sql
--   psql ... -v ON_ERROR_STOP=1 -f supabase/test-faculty-visibility.sql
--
-- Covers migration 2026102212:
--   * the verification RPC returns a boolean from auth.users only;
--   * authorisation: self, admin, approved faculty (including anon);
--     unauthorised ids are omitted, not mislabelled;
--   * the backfill creates a pending application for an orphaned profile;
--   * faculty_applications is in the Realtime publication when it exists.
-- =========================================================

\echo '============================================'
\echo 'Phase 12 — Faculty visibility SQL Tests'
\echo '============================================'

-- Applications must go before their users: the reviewed_by FK is ON DELETE SET
-- NULL, and the transition trigger (correctly) refuses a non-admin reviewer
-- change. Deleting the application row does not fire that trigger.
delete from public.faculty_applications
where user_id in (
  select id from public.profiles where email like 'phase12-%@example.com'
);
delete from auth.users where email like 'phase12-%@example.com';

-- ---------------------------------------------------------
-- Fixtures. Inserting into auth.users fires handle_new_user().
-- ---------------------------------------------------------
do $$
declare
  admin_id uuid;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
  values
    (gen_random_uuid(), 'phase12-admin@example.com', 'x', now(),
     '{"name":"Phase 12 Admin","intent":"student"}'::jsonb, now(), now()),
    (gen_random_uuid(), 'phase12-faculty-confirmed@example.com', 'x', now(),
     '{"name":"Phase 12 Confirmed","intent":"faculty","designation":"Professor","department":"CSE"}'::jsonb, now(), now()),
    (gen_random_uuid(), 'phase12-faculty-unconfirmed@example.com', 'x', null,
     '{"name":"Phase 12 Unconfirmed","intent":"faculty","designation":"Assistant Professor","department":"CSE"}'::jsonb, now(), now()),
    (gen_random_uuid(), 'phase12-pending-other@example.com', 'x', null,
     '{"name":"Phase 12 Other Pending","intent":"faculty","designation":"Lecturer","department":"CSE"}'::jsonb, now(), now()),
    (gen_random_uuid(), 'phase12-student@example.com', 'x', null,
     '{"name":"Phase 12 Student","intent":"student","usn":"4UB24CS912","department":"CSE"}'::jsonb, now(), now()),
    (gen_random_uuid(), 'phase12-orphan@example.com', 'x', null,
     '{"name":"Phase 12 Orphan","intent":"faculty","designation":"Associate Professor","department":"CSE"}'::jsonb, now(), now());

  select id into admin_id from public.profiles where email = 'phase12-admin@example.com';
  alter table public.profiles disable trigger trg_protect_profile_privileges;
  update public.profiles
  set role = 'admin', member_type = 'faculty', faculty_status = 'approved'
  where id = admin_id;
  alter table public.profiles enable trigger trg_protect_profile_privileges;
end $$;

-- Approve the two faculty fixtures as the administrator. The unconfirmed one
-- proves email verification and faculty approval are independent.
begin;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', (select id from public.profiles where email = 'phase12-admin@example.com'), 'role', 'authenticated')::text,
  true
);
update public.faculty_applications
set status = 'approved'
where user_id in (
  select id from public.profiles
  where email in ('phase12-faculty-confirmed@example.com', 'phase12-faculty-unconfirmed@example.com')
)
and status = 'pending';
commit;

\echo ''
\echo 'TEST A: verification RPC surface and grants'
do $$
declare
  result text;
begin
  result := pg_get_function_result('public.get_email_verification_status(uuid[])'::regprocedure);
  if result not like '%user_id%' or result not like '%email_verified%' then
    raise exception 'FAIL: RPC result is not user_id + email_verified (got %)', result;
  end if;

  if not has_function_privilege('anon', 'public.get_email_verification_status(uuid[])'::regprocedure, 'EXECUTE') then
    raise exception 'FAIL: anon cannot execute the directory verification RPC';
  end if;
  if not has_function_privilege('authenticated', 'public.get_email_verification_status(uuid[])'::regprocedure, 'EXECUTE') then
    raise exception 'FAIL: authenticated cannot execute the verification RPC';
  end if;

  -- The backfill writes reviewable rows. Only the owner/migration role may run
  -- it; API roles must not be able to inject applications.
  if has_function_privilege('anon', 'public.backfill_pending_faculty_applications()'::regprocedure, 'EXECUTE') then
    raise exception 'FAIL: anon can execute the application backfill';
  end if;
  if has_function_privilege('authenticated', 'public.backfill_pending_faculty_applications()'::regprocedure, 'EXECUTE') then
    raise exception 'FAIL: authenticated can execute the application backfill';
  end if;
end $$;
\echo '  PASS'

\echo ''
\echo 'TEST B: unconfirmed faculty is false for self and for the public directory'
do $$
declare
  faculty_id uuid;
  verified boolean;
  n int;
begin
  select id into faculty_id from public.profiles where email = 'phase12-faculty-unconfirmed@example.com';

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', faculty_id, 'role', 'authenticated')::text, true);
  select email_verified into verified
  from public.get_email_verification_status(array[faculty_id]);
  reset role;

  if verified is distinct from false then
    raise exception 'FAIL: unconfirmed faculty self-status was % (expected false)', verified;
  end if;

  -- Anonymous directory visitor: approved faculty is an authorised target.
  set local role anon;
  perform set_config('request.jwt.claims', '', true);
  select count(*) into n
  from public.get_email_verification_status(array[faculty_id])
  where user_id = faculty_id and email_verified = false;
  reset role;

  if n <> 1 then
    raise exception 'FAIL: anon did not see the unconfirmed approved faculty as false';
  end if;
end $$;
\echo '  PASS'

\echo ''
\echo 'TEST C: confirmed faculty is true and is the only public directory target'
do $$
declare
  confirmed_id uuid;
  pending_id uuid;
  student_id uuid;
  n int;
begin
  select id into confirmed_id from public.profiles where email = 'phase12-faculty-confirmed@example.com';
  select id into pending_id from public.profiles where email = 'phase12-pending-other@example.com';
  select id into student_id from public.profiles where email = 'phase12-student@example.com';

  set local role anon;
  perform set_config('request.jwt.claims', '', true);
  select count(*) into n
  from public.get_email_verification_status(array[confirmed_id, pending_id, student_id, gen_random_uuid()])
  where user_id = confirmed_id and email_verified = true;
  reset role;

  if n <> 1 then
    raise exception 'FAIL: anon did not see confirmed approved faculty as true';
  end if;

  set local role anon;
  perform set_config('request.jwt.claims', '', true);
  select count(*) into n
  from public.get_email_verification_status(array[pending_id, student_id, gen_random_uuid()]);
  reset role;

  if n <> 0 then
    raise exception 'FAIL: anon saw % non-approved-faculty verification rows', n;
  end if;
end $$;
\echo '  PASS'

\echo ''
\echo 'TEST D: pending member sees self only; admin sees every applicant'
do $$
declare
  pending_id uuid;
  other_pending_id uuid;
  student_id uuid;
  admin_id uuid;
  n int;
begin
  select id into pending_id from public.profiles where email = 'phase12-pending-other@example.com';
  select id into other_pending_id from public.profiles where email = 'phase12-orphan@example.com';
  select id into student_id from public.profiles where email = 'phase12-student@example.com';
  select id into admin_id from public.profiles where email = 'phase12-admin@example.com';

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', pending_id, 'role', 'authenticated')::text, true);
  select count(*) into n
  from public.get_email_verification_status(array[pending_id, other_pending_id, student_id]);
  reset role;

  if n <> 1 then
    raise exception 'FAIL: pending member saw % verification rows (expected only self)', n;
  end if;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  select count(*) into n
  from public.get_email_verification_status(array[pending_id, other_pending_id, student_id, admin_id]);
  reset role;

  if n <> 4 then
    raise exception 'FAIL: admin saw % verification rows (expected 4)', n;
  end if;
end $$;
\echo '  PASS'

\echo ''
\echo 'TEST E: orphaned pending profile is backfilled idempotently'
do $$
declare
  orphan_id uuid;
  n int;
  app public.faculty_applications%rowtype;
begin
  select id into orphan_id from public.profiles where email = 'phase12-orphan@example.com';

  -- Simulate the historical failure: signup created the pending profile but
  -- no application. The profile already has pending status from the trigger.
  delete from public.faculty_applications where user_id = orphan_id;
  if exists (select 1 from public.faculty_applications where user_id = orphan_id) then
    raise exception 'FAIL: could not simulate an orphaned pending profile';
  end if;
end $$;

do $$
declare
  orphan_id uuid;
  n int;
  affected int;
  app public.faculty_applications%rowtype;
begin
  select id into orphan_id from public.profiles where email = 'phase12-orphan@example.com';

  -- The migration calls this same function. Running it again is the
  -- idempotency check an operator would use after a provisioning incident.
  affected := public.backfill_pending_faculty_applications();
  if affected < 1 then
    raise exception 'FAIL: backfill inserted % applications (expected at least 1)', affected;
  end if;

  select count(*) into n
  from public.faculty_applications
  where user_id = orphan_id and status = 'pending';
  if n <> 1 then
    raise exception 'FAIL: backfill created % pending applications (expected 1)', n;
  end if;

  select * into app from public.faculty_applications where user_id = orphan_id and status = 'pending';
  if app.designation <> 'Associate Professor' or app.department <> 'CSE' then
    raise exception 'FAIL: backfill did not copy profile details (designation %, department %)',
      app.designation, app.department;
  end if;

  affected := public.backfill_pending_faculty_applications();
  if affected <> 0 then
    raise exception 'FAIL: a second backfill inserted % duplicate applications', affected;
  end if;

  -- The partial unique index still guarantees one pending application.
  begin
    insert into public.faculty_applications (user_id, full_name, official_email, department, designation, status)
    values (orphan_id, 'Duplicate', 'phase12-orphan@example.com', 'CSE', 'Associate Professor', 'pending');
    raise exception 'FAIL: a second pending application was accepted';
  exception when unique_violation then
    null;
  end;
end $$;
\echo '  PASS'

\echo ''
\echo 'TEST F: faculty_applications is in the Realtime publication'
do $$
declare
  n int;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'SKIP: supabase_realtime publication does not exist in this database';
    return;
  end if;

  select count(*) into n
  from pg_publication_tables
  where pubname = 'supabase_realtime'
    and schemaname = 'public'
    and tablename = 'faculty_applications';

  if n <> 1 then
    raise exception 'FAIL: faculty_applications is not in the supabase_realtime publication';
  end if;
end $$;
\echo '  PASS'

-- Applications must go before their users: the reviewed_by FK is ON DELETE SET
-- NULL, and the transition trigger (correctly) refuses a non-admin reviewer
-- change. Deleting the application row does not fire that trigger.
delete from public.faculty_applications
where user_id in (
  select id from public.profiles where email like 'phase12-%@example.com'
);
delete from auth.users where email like 'phase12-%@example.com';

\echo ''
\echo '============================================'
\echo 'All Phase 12 faculty visibility SQL tests passed.'
\echo '============================================'
