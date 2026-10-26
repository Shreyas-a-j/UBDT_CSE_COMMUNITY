-- =========================================================
-- UCC 2.0 — first-year admission numbers + one-time USN linking
-- (SQL tests)
--
-- Run after the migration chain has been applied to a DISPOSABLE database
-- with the Supabase auth stub:
--
--   psql ... -f supabase/local-rehearsal/auth-stub.sql
--   psql ... -f supabase/schema.sql
--   psql ... -f supabase/migrations/2026102502_admission_numbers_and_usn_linking.sql
--   psql ... -v ON_ERROR_STOP=1 -f supabase/test-admission-numbers.sql
--
-- The whole file runs inside a transaction that is rolled back, so it leaves
-- no auth users, profiles or admission rows behind. Never point this at a
-- hosted project.
-- =========================================================

\echo '============================================'
\echo 'UCC 2.0 — Admission numbers and USN linking'
\echo '============================================'

begin;

-- ---------------------------------------------------------
-- Fixtures. Inserting into auth.users fires handle_new_user(), the same
-- path Supabase Auth uses during signUp(). Valid fixtures only: failure
-- scenarios are exercised inside the individual tests below.
-- ---------------------------------------------------------
insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
values
  (gen_random_uuid(), 'ucc-admission-firstyear@example.com', 'x', now(),
   '{"name":"First Year","intent":"student","year":1,"admission_number":"ADM-2026-001","department":"CSE"}'::jsonb, now(), now()),
  (gen_random_uuid(), 'ucc-admission-link@example.com', 'x', now(),
   '{"name":"Link Target","intent":"student","year":1,"admission_number":"ADM-2026-002","department":"CSE"}'::jsonb, now(), now()),
  (gen_random_uuid(), 'ucc-admission-duplicate-link@example.com', 'x', now(),
   '{"name":"Duplicate Link Target","intent":"student","year":1,"admission_number":"ADM-2026-003","department":"CSE"}'::jsonb, now(), now()),
  (gen_random_uuid(), 'ucc-admission-direct@example.com', 'x', now(),
   '{"name":"Direct Update Target","intent":"student","year":1,"admission_number":"ADM-2026-004","department":"CSE"}'::jsonb, now(), now()),
  (gen_random_uuid(), 'ucc-admission-year3@example.com', 'x', now(),
   '{"name":"Third Year","intent":"student","year":3,"usn":"4UB23CS301","department":"CSE"}'::jsonb, now(), now()),
  (gen_random_uuid(), 'ucc-admission-other@example.com', 'x', now(),
   '{"name":"Other Student","intent":"student","year":2,"usn":"4UB24CS302","department":"CSE"}'::jsonb, now(), now()),
  (gen_random_uuid(), 'ucc-admission-alumni@example.com', 'x', now(),
   '{"name":"Alumnus","intent":"alumni","graduation_year":2021,"department":"CSE"}'::jsonb, now(), now()),
  (gen_random_uuid(), 'ucc-admission-admin@example.com', 'x', now(),
   '{"name":"Admin","intent":"student","year":4,"usn":"4UB22CS303","department":"CSE"}'::jsonb, now(), now());

-- Elevate the admin fixture. Setup runs as the database owner, so the
-- privilege-protection trigger is temporarily disabled, exactly like the
-- faculty-onboarding suite.
do $$
declare
  admin_id uuid;
begin
  select id into admin_id from public.profiles where email = 'ucc-admission-admin@example.com';
  alter table public.profiles disable trigger trg_protect_profile_privileges;
  update public.profiles
  set role = 'admin', member_type = 'faculty', faculty_status = 'approved'
  where id = admin_id;
  alter table public.profiles enable trigger trg_protect_profile_privileges;
end $$;

\echo ''
\echo 'TEST 1: first-year admission-only signup creates a profile and one admission row'
do $$
declare
  p public.profiles%rowtype;
  n int;
  a public.student_admission_numbers%rowtype;
begin
  select * into p from public.profiles where email = 'ucc-admission-firstyear@example.com';
  if p.id is null then
    raise exception 'FAIL: first-year admission-only signup did not create a profile';
  end if;
  if p.usn is not null then
    raise exception 'FAIL: admission-only signup stored a USN: %', p.usn;
  end if;
  if p.year <> 1 or p.member_type <> 'student' then
    raise exception 'FAIL: unexpected first-year profile: year %, member %', p.year, p.member_type;
  end if;

  select count(*) into n from public.student_admission_numbers where profile_id = p.id;
  if n <> 1 then
    raise exception 'FAIL: expected exactly one admission row, found %', n;
  end if;

  select * into a from public.student_admission_numbers where profile_id = p.id;
  if a.admission_number <> 'ADM-2026-001' then
    raise exception 'FAIL: admission number was not normalized: %', a.admission_number;
  end if;
end $$;
\echo '  PASS'

\echo ''
\echo 'TEST 2: duplicate admission number with different case/whitespace is rejected atomically'
do $$
declare
  before_users int;
  after_users int;
  state text;
  msg text;
begin
  select count(*) into before_users from auth.users;
  begin
    insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
    values (gen_random_uuid(), 'ucc-admission-dupe@example.com', 'x', now(),
      '{"name":"Duplicate","intent":"student","year":1,"admission_number":" adm-2026-001 ","department":"CSE"}'::jsonb, now(), now());
    raise exception 'FAIL: duplicate admission number was accepted';
  exception when others then
    get stacked diagnostics state = returned_sqlstate, msg = message_text;
    if msg like 'FAIL:%' then raise; end if;
    if state <> '23505' then
      raise exception 'FAIL: expected 23505 for a duplicate admission number, got % (%)', state, msg;
    end if;
    if msg not like '%admission number%' then
      raise exception 'FAIL: duplicate admission error was not the admission-specific message: %', msg;
    end if;
  end;

  select count(*) into after_users from auth.users;
  if after_users <> before_users then
    raise exception 'FAIL: duplicate admission signup left an auth user behind (% -> %)', before_users, after_users;
  end if;
  if exists (select 1 from public.profiles where email = 'ucc-admission-dupe@example.com') then
    raise exception 'FAIL: duplicate admission signup left a profile behind';
  end if;
end $$;
\echo '  PASS'

\echo ''
\echo 'TEST 3: invalid admission-number formats are rejected with 23514'
do $$
declare
  bad text;
  state text;
  msg text;
begin
  foreach bad in array array['AB', 'A B', repeat('A', 25), '-ADM2026'] loop
    begin
      insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
      values (gen_random_uuid(), 'ucc-admission-invalid-' || replace(bad, ' ', '-') || '@example.com', 'x', now(),
        jsonb_build_object('name', 'Invalid', 'intent', 'student', 'year', 1, 'admission_number', bad), now(), now());
      raise exception 'FAIL: invalid admission number % was accepted', bad;
    exception when others then
      get stacked diagnostics state = returned_sqlstate, msg = message_text;
      if msg like 'FAIL:%' then raise; end if;
      if state <> '23514' then
        raise exception 'FAIL: expected 23514 for admission number %, got % (%)', bad, state, msg;
      end if;
    end;
  end loop;

  if exists (select 1 from public.profiles where email like 'ucc-admission-invalid-%@example.com') then
    raise exception 'FAIL: invalid admission signup left a profile behind';
  end if;
end $$;
\echo '  PASS'

\echo ''
\echo 'TEST 4: year 2 without a USN is rejected'
do $$
declare
  state text;
begin
  begin
    insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
    values (gen_random_uuid(), 'ucc-admission-year2-nousn@example.com', 'x', now(),
      '{"name":"Year Two","intent":"student","year":2,"admission_number":"ADM-2026-005"}'::jsonb, now(), now());
    raise exception 'FAIL: year 2 without a USN was accepted';
  exception when others then
    get stacked diagnostics state = returned_sqlstate;
    if state <> '23514' then
      raise exception 'FAIL: expected 23514 for year 2 without USN, got %', state;
    end if;
  end;
end $$;
\echo '  PASS'

\echo ''
\echo 'TEST 5: first-year signup with neither USN nor admission number is rejected'
do $$
declare
  state text;
begin
  begin
    insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
    values (gen_random_uuid(), 'ucc-admission-neither@example.com', 'x', now(),
      '{"name":"No Identifier","intent":"student","year":1}'::jsonb, now(), now());
    raise exception 'FAIL: first-year signup without any identifier was accepted';
  exception when others then
    get stacked diagnostics state = returned_sqlstate;
    if state <> '23514' then
      raise exception 'FAIL: expected 23514 for missing identifiers, got %', state;
    end if;
  end;
end $$;
\echo '  PASS'

\echo ''
\echo 'TEST 6: year 3 with a valid USN still succeeds'
do $$
declare
  p public.profiles%rowtype;
begin
  select * into p from public.profiles where email = 'ucc-admission-year3@example.com';
  if p.id is null or p.usn <> '4UB23CS301' or p.year <> 3 then
    raise exception 'FAIL: valid year-3 signup was not provisioned as expected';
  end if;
  if exists (select 1 from public.student_admission_numbers where profile_id = p.id) then
    raise exception 'FAIL: a USN signup created an admission row';
  end if;
end $$;
\echo '  PASS'

\echo ''
\echo 'TEST 7: link_student_usn sets the normalized USN once without changing year'
do $$
declare
  target_id uuid;
  p public.profiles%rowtype;
begin
  select id into target_id from public.profiles where email = 'ucc-admission-link@example.com';

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', target_id, 'role', 'authenticated')::text, true);
  perform public.link_student_usn('  4ub24cs777  ');
  reset role;

  select * into p from public.profiles where id = target_id;
  if p.usn <> '4UB24CS777' then
    raise exception 'FAIL: link_student_usn did not normalize/store the USN: %', p.usn;
  end if;
  if p.year <> 1 then
    raise exception 'FAIL: link_student_usn changed the academic year to %', p.year;
  end if;
end $$;
\echo '  PASS'

\echo ''
\echo 'TEST 8: a second link_student_usn call is rejected and leaves the USN unchanged'
do $$
declare
  target_id uuid;
  state text;
  p public.profiles%rowtype;
begin
  select id into target_id from public.profiles where email = 'ucc-admission-link@example.com';

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', target_id, 'role', 'authenticated')::text, true);
  begin
    perform public.link_student_usn('4UB24CS778');
    raise exception 'FAIL: a second USN link was accepted';
  exception when others then
    get stacked diagnostics state = returned_sqlstate;
    if state = 'P0001' and sqlerrm like 'FAIL:%' then raise; end if;
    if state <> '22023' then
      raise exception 'FAIL: expected 22023 for a second USN link, got % (%)', state, sqlerrm;
    end if;
  end;
  reset role;

  select * into p from public.profiles where id = target_id;
  if p.usn <> '4UB24CS777' then
    raise exception 'FAIL: a rejected second link changed the USN to %', p.usn;
  end if;
end $$;
\echo '  PASS'

\echo ''
\echo 'TEST 9: linking a USN held by another student returns a generic duplicate error'
do $$
declare
  target_id uuid;
  state text;
  msg text;
  p public.profiles%rowtype;
begin
  select id into target_id from public.profiles where email = 'ucc-admission-duplicate-link@example.com';

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', target_id, 'role', 'authenticated')::text, true);
  begin
    perform public.link_student_usn('4UB23CS301');
    raise exception 'FAIL: linking another student''s USN was accepted';
  exception when others then
    get stacked diagnostics state = returned_sqlstate, msg = message_text;
    if msg like 'FAIL:%' then raise; end if;
    if state <> '23505' then
      raise exception 'FAIL: expected 23505 for a duplicate USN, got % (%)', state, msg;
    end if;
    if msg like '%4UB23CS301%' then
      raise exception 'FAIL: duplicate USN error echoed the USN value';
    end if;
  end;
  reset role;

  select * into p from public.profiles where id = target_id;
  if p.usn is not null then
    raise exception 'FAIL: failed duplicate link changed the target USN to %', p.usn;
  end if;
end $$;
\echo '  PASS'

\echo ''
\echo 'TEST 10: link_student_usn is rejected for alumni'
do $$
declare
  alumni_id uuid;
  state text;
begin
  select id into alumni_id from public.profiles where email = 'ucc-admission-alumni@example.com';

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', alumni_id, 'role', 'authenticated')::text, true);
  begin
    perform public.link_student_usn('4UB24CS779');
    raise exception 'FAIL: alumni USN linking was accepted';
  exception when others then
    get stacked diagnostics state = returned_sqlstate;
    if state = 'P0001' and sqlerrm like 'FAIL:%' then raise; end if;
    if state <> '42501' then
      raise exception 'FAIL: expected 42501 for alumni linking, got % (%)', state, sqlerrm;
    end if;
  end;
  reset role;
end $$;
\echo '  PASS'

\echo ''
\echo 'TEST 11: direct client USN updates are reverted by the privilege trigger'
do $$
declare
  target_id uuid;
  p public.profiles%rowtype;
begin
  select id into target_id from public.profiles where email = 'ucc-admission-direct@example.com';

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', target_id, 'role', 'authenticated')::text, true);
  update public.profiles set usn = '4UB24CS999' where id = target_id;
  reset role;

  select * into p from public.profiles where id = target_id;
  if p.usn is not null then
    raise exception 'FAIL: direct client USN update was not reverted: %', p.usn;
  end if;
end $$;
\echo '  PASS'

\echo ''
\echo 'TEST 12: admission-number RLS — owner reads, another student cannot, admin can'
do $$
declare
  owner_id uuid;
  other_id uuid;
  admin_id uuid;
  n int;
begin
  select id into owner_id from public.profiles where email = 'ucc-admission-firstyear@example.com';
  select id into other_id from public.profiles where email = 'ucc-admission-other@example.com';
  select id into admin_id from public.profiles where email = 'ucc-admission-admin@example.com';

  set local role authenticated;

  perform set_config('request.jwt.claims',
    json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  select count(*) into n from public.student_admission_numbers where profile_id = owner_id;
  if n <> 1 then
    raise exception 'FAIL: owner could not read their admission row (found %)', n;
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', other_id, 'role', 'authenticated')::text, true);
  select count(*) into n from public.student_admission_numbers where profile_id = owner_id;
  if n <> 0 then
    raise exception 'FAIL: another student could read the admission row (found %)', n;
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  select count(*) into n from public.student_admission_numbers where profile_id = owner_id;
  if n <> 1 then
    raise exception 'FAIL: admin could not read the admission row (found %)', n;
  end if;

  reset role;
end $$;
\echo '  PASS'

\echo ''
\echo 'TEST 13: admission numbers supplied for years 2-4 are rejected even with a USN'
do $$
declare
  yr int;
  usn text;
  state text;
  msg text;
begin
  foreach yr in array array[2, 3, 4] loop
    usn := '4UB24CS5' || lpad(yr::text, 2, '0');
    begin
      insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
      values (gen_random_uuid(), 'ucc-admission-year' || yr || '-admission@example.com', 'x', now(),
        jsonb_build_object(
          'name', 'Year ' || yr || ' Admission',
          'intent', 'student',
          'year', yr,
          'usn', usn,
          'admission_number', 'ADM-2026-10' || yr
        ), now(), now());
      raise exception 'FAIL: year % admission number was accepted', yr;
    exception when others then
      get stacked diagnostics state = returned_sqlstate, msg = message_text;
      if msg like 'FAIL:%' then raise; end if;
      if state <> '23514' then
        raise exception 'FAIL: expected 23514 for year % admission number, got % (%)', yr, state, msg;
      end if;
      if msg not like '%first-year%' then
        raise exception 'FAIL: year % admission number was not rejected by the first-year rule: %', yr, msg;
      end if;
    end;
  end loop;

  if exists (
    select 1 from public.profiles
    where email like 'ucc-admission-year%-admission@example.com'
  ) then
    raise exception 'FAIL: a rejected years 2-4 admission signup left a profile behind';
  end if;
end $$;
\echo '  PASS'

\echo ''
\echo 'All admission-number and USN-linking tests passed.'
\echo 'Rolling back fixtures.'

rollback;
