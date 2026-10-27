-- =========================================================
-- UCC 2.0 — alumni signup identity regression test
--
-- Proves that a successful alumni signup persists member_type='alumni' and
-- graduation_year, and that the identity trigger repairs a profile inserted by
-- a handle_new_user() that predates the member identity migration.
--
-- Run after auth-stub.sql + schema.sql + the migration chain (or at least
-- 2026102201_member_identity_and_contacts.sql and
-- 2026102701_alumni_signup_identity.sql) on a DISPOSABLE database:
--
--   psql ... -f supabase/local-rehearsal/auth-stub.sql
--   psql ... -f supabase/schema.sql
--   psql ... -v ON_ERROR_STOP=1 -f supabase/test-alumni-signup-provisioning.sql
--
-- The whole file runs inside a transaction that is rolled back, so it leaves
-- no auth users or profiles behind. Never point this at a hosted project.
-- =========================================================

\set ON_ERROR_STOP 1
\echo '============================================'
\echo 'Alumni signup identity — regression'
\echo '============================================'

begin;

-- ---------------------------------------------------------
-- Fixtures. Inserting into auth.users fires handle_new_user().
-- ---------------------------------------------------------
insert into auth.users (
  id, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at
) values
  (gen_random_uuid(), 'alumni-signup-test@example.com', 'x', now(),
   '{"name":"Asha Rao","intent":"alumni","graduation_year":2024,"department":"CSE","skills":["Rust"]}'::jsonb, now(), now()),
  (gen_random_uuid(), 'alumni-signup-student@example.com', 'x', now(),
   '{"name":"Current Student","intent":"student","year":2,"usn":"4UB24CS901","graduation_year":2028,"department":"CSE"}'::jsonb, now(), now()),
  (gen_random_uuid(), 'alumni-signup-faculty@example.com', 'x', now(),
   '{"name":"Dr Rao","intent":"faculty","designation":"Professor","department":"CSE"}'::jsonb, now(), now()),
  (gen_random_uuid(), 'alumni-signup-invalid-year@example.com', 'x', now(),
   '{"name":"Old Alumnus","intent":"alumni","graduation_year":1800}'::jsonb, now(), now()),
  (gen_random_uuid(), 'alumni-signup-no-intent@example.com', 'x', now(),
   '{"name":"Legacy Metadata"}'::jsonb, now(), now());

-- ---------------------------------------------------------
-- 1. Alumni signup persists the identity
-- ---------------------------------------------------------
\echo ''
\echo 'TEST 1: alumni signup persists member_type and graduation_year'
do $$
declare
  v_profile public.profiles%rowtype;
begin
  select pr.* into v_profile
  from public.profiles as pr
  join auth.users as u on u.id = pr.id
  where u.email = 'alumni-signup-test@example.com';

  if v_profile.id is null then
    raise exception 'FAIL: alumni signup did not create a profile';
  end if;
  if v_profile.member_type <> 'alumni' then
    raise exception 'FAIL: expected member_type alumni, got %', v_profile.member_type;
  end if;
  if v_profile.graduation_year <> 2024 then
    raise exception 'FAIL: expected graduation_year 2024, got %', v_profile.graduation_year;
  end if;
  if v_profile.role <> 'student' then
    raise exception 'FAIL: alumni signup must not grant a privileged role, got %', v_profile.role;
  end if;
  if v_profile.usn is not null then
    raise exception 'FAIL: alumni signup stored a USN: %', v_profile.usn;
  end if;
end $$;
\echo '  PASS'

-- ---------------------------------------------------------
-- 2. The trigger repairs an insert from the old handle_new_user()
--
-- The hosted project's signup function predates member_type. Re-insert the
-- profile the way that function would (defaults only) and prove the alumni
-- trigger corrects it.
-- ---------------------------------------------------------
\echo ''
\echo 'TEST 2: the identity trigger corrects a legacy profile insert'
do $$
declare
  v_id uuid;
  v_profile public.profiles%rowtype;
begin
  select pr.id into v_id
  from public.profiles as pr
  join auth.users as u on u.id = pr.id
  where u.email = 'alumni-signup-test@example.com';

  delete from public.profiles where id = v_id;

  insert into public.profiles (id, name)
  values (v_id, 'Asha Rao');

  select * into v_profile from public.profiles where id = v_id;

  if v_profile.member_type <> 'alumni' then
    raise exception 'FAIL: legacy insert was not tagged alumni, got %', v_profile.member_type;
  end if;
  if v_profile.graduation_year <> 2024 then
    raise exception 'FAIL: legacy insert lost graduation_year, got %', v_profile.graduation_year;
  end if;
end $$;
\echo '  PASS'

-- ---------------------------------------------------------
-- 3. A student with a graduation year is not alumni
-- ---------------------------------------------------------
\echo ''
\echo 'TEST 3: a student with graduation_year stays a student'
do $$
declare
  v_profile public.profiles%rowtype;
begin
  select pr.* into v_profile
  from public.profiles as pr
  join auth.users as u on u.id = pr.id
  where u.email = 'alumni-signup-student@example.com';

  if v_profile.member_type <> 'student' then
    raise exception 'FAIL: student was tagged %, expected student', v_profile.member_type;
  end if;
end $$;
\echo '  PASS'

-- ---------------------------------------------------------
-- 4. Faculty intent never becomes alumni
-- ---------------------------------------------------------
\echo ''
\echo 'TEST 4: faculty intent is not tagged alumni'
do $$
declare
  v_profile public.profiles%rowtype;
begin
  select pr.* into v_profile
  from public.profiles as pr
  join auth.users as u on u.id = pr.id
  where u.email = 'alumni-signup-faculty@example.com';

  if v_profile.member_type = 'alumni' then
    raise exception 'FAIL: faculty applicant was tagged alumni';
  end if;
end $$;
\echo '  PASS'

-- ---------------------------------------------------------
-- 5. An invalid graduation year is ignored, not inferred
-- ---------------------------------------------------------
\echo ''
\echo 'TEST 5: an out-of-range graduation_year is discarded'
do $$
declare
  v_profile public.profiles%rowtype;
begin
  select pr.* into v_profile
  from public.profiles as pr
  join auth.users as u on u.id = pr.id
  where u.email = 'alumni-signup-invalid-year@example.com';

  if v_profile.member_type <> 'alumni' then
    raise exception 'FAIL: expected alumni, got %', v_profile.member_type;
  end if;
  if v_profile.graduation_year is not null then
    raise exception 'FAIL: invalid graduation_year was stored: %', v_profile.graduation_year;
  end if;
end $$;
\echo '  PASS'

-- ---------------------------------------------------------
-- 6. Legacy metadata without intent stays student
-- ---------------------------------------------------------
\echo ''
\echo 'TEST 6: metadata without intent stays student'
do $$
declare
  v_profile public.profiles%rowtype;
begin
  select pr.* into v_profile
  from public.profiles as pr
  join auth.users as u on u.id = pr.id
  where u.email = 'alumni-signup-no-intent@example.com';

  if v_profile.member_type <> 'student' then
    raise exception 'FAIL: no-intent signup was tagged %, expected student', v_profile.member_type;
  end if;
end $$;
\echo '  PASS'

rollback;

\echo ''
\echo 'All alumni signup identity checks passed.'
