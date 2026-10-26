-- =========================================================
-- Administrator nominee eligibility — regression test
--
-- Proves the 2026102602 rule:
--   * approved/verified faculty are eligible regardless of member_type
--     (legacy member_type = 'student' included);
--   * incomplete optional profile fields do not exclude a nominee;
--   * students, alumni and manipulated non-faculty accounts stay ineligible;
--   * the administrator is not a nominee;
--   * only the current administrator may nominate;
--   * nominate_admin() enforces the rule server-side.
--
-- Run after auth-stub.sql + schema.sql + the migration chain (or at least
-- 2026102208 and 2026102602). Disposable database only.
-- =========================================================

\set ON_ERROR_STOP 1
\echo '============================================'
\echo 'Admin nominee eligibility — regression'
\echo '============================================'

-- ---------------------------------------------------------
-- Cleanup
-- ---------------------------------------------------------
-- Disposable-DB test: a stale pending nomination would block every case
-- below, so clear pending rows (historical audit rows are left intact).
delete from public.admin_nominations where status = 'pending';
delete from public.admin_nominations
 where nominee_id in (select id from public.profiles where email like 'nominee-%@example.com')
    or nominated_by in (select id from public.profiles where email like 'nominee-%@example.com');
delete from public.admin_audit_log
 where actor_id in (select id from public.profiles where email like 'nominee-%@example.com')
    or target_id in (select id from public.profiles where email like 'nominee-%@example.com');
delete from public.profiles where email like 'nominee-%@example.com';
delete from auth.users where email like 'nominee-%@example.com';

-- ---------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------
insert into auth.users (
  id, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at
) values
  (gen_random_uuid(), 'nominee-faculty@example.com', 'x', now(),
   '{"name":"Nominee Faculty","intent":"student"}'::jsonb, now(), now()),
  (gen_random_uuid(), 'nominee-legacy@example.com', 'x', now(),
   '{"name":"Nominee Legacy","intent":"student"}'::jsonb, now(), now()),
  (gen_random_uuid(), 'nominee-incomplete@example.com', 'x', now(),
   '{"name":"Nominee Incomplete","intent":"student"}'::jsonb, now(), now()),
  (gen_random_uuid(), 'nominee-student@example.com', 'x', now(),
   '{"name":"Nominee Student","intent":"student"}'::jsonb, now(), now()),
  (gen_random_uuid(), 'nominee-alumni@example.com', 'x', now(),
   '{"name":"Nominee Alumni","intent":"student"}'::jsonb, now(), now());

alter table public.profiles disable trigger trg_protect_profile_privileges;

-- Normal approved faculty.
update public.profiles
set role = 'faculty', faculty_status = 'approved', member_type = 'faculty',
    designation = 'Professor', employee_id = 'EMP-1'
where email = 'nominee-faculty@example.com';

-- Legacy faculty: approved, but member_type still the 2026102212 default.
update public.profiles
set role = 'faculty', faculty_status = 'approved', member_type = 'student'
where email = 'nominee-legacy@example.com';

-- Approved faculty with incomplete optional fields.
update public.profiles
set role = 'faculty', faculty_status = 'approved', member_type = 'student',
    designation = null, employee_id = null, bio = null, avatar_url = null
where email = 'nominee-incomplete@example.com';

-- Student who manipulated faculty_status/member_type.
update public.profiles
set role = 'student', faculty_status = 'approved', member_type = 'faculty'
where email = 'nominee-student@example.com';

-- Alumni.
update public.profiles
set role = 'student', faculty_status = 'none', member_type = 'alumni'
where email = 'nominee-alumni@example.com';

alter table public.profiles enable trigger trg_protect_profile_privileges;

-- Use the current administrator, or create one when the database has none.
do $$
declare
  v_admin uuid;
begin
  select id into v_admin from public.profiles where role = 'admin' limit 1;
  if v_admin is null then
    insert into auth.users (
      id, email, encrypted_password, email_confirmed_at,
      raw_user_meta_data, created_at, updated_at
    ) values (
      gen_random_uuid(), 'nominee-admin@example.com', 'x', now(),
      '{"name":"Nominee Admin","intent":"student"}'::jsonb, now(), now()
    );
    alter table public.profiles disable trigger trg_protect_profile_privileges;
    update public.profiles
    set role = 'admin', faculty_status = 'approved', member_type = 'faculty'
    where email = 'nominee-admin@example.com';
    alter table public.profiles enable trigger trg_protect_profile_privileges;
  end if;
end $$;

-- ---------------------------------------------------------
-- 1. Eligibility matrix
-- ---------------------------------------------------------
do $$
declare
  r record;
  v_expected boolean;
  v_verified boolean;
  v_eligible boolean;
begin
  for r in
    select email, role, faculty_status, member_type,
           case email
             when 'nominee-faculty@example.com' then true
             when 'nominee-legacy@example.com' then true
             when 'nominee-incomplete@example.com' then true
             when 'nominee-student@example.com' then false
             when 'nominee-alumni@example.com' then false
             else false
           end as expected
    from public.profiles
    where email like 'nominee-%@example.com'
    order by email
  loop
    v_expected := r.expected;
    select public.is_verified_faculty(p.id), public.is_eligible_admin_candidate(p.id)
      into v_verified, v_eligible
    from public.profiles p where p.email = r.email;

    if r.email in ('nominee-faculty@example.com','nominee-legacy@example.com','nominee-incomplete@example.com') then
      if not v_verified then
        raise exception 'FAIL: % should be verified faculty', r.email;
      end if;
    end if;

    if v_eligible is distinct from v_expected then
      raise exception 'FAIL: % eligibility % (expected %)',
        r.email, v_eligible, v_expected;
    end if;
  end loop;

  raise notice 'PASS E1: legacy/incomplete faculty eligible; student and alumni ineligible';
end $$;

-- ---------------------------------------------------------
-- 2. Nomination RPC enforcement
-- ---------------------------------------------------------
do $$
declare
  v_admin uuid;
  v_legacy uuid;
  v_student uuid;
  v_nom uuid;
  v_msg text;
begin
  select id into v_admin from public.profiles where role = 'admin' limit 1;
  select id into v_legacy from public.profiles where email = 'nominee-legacy@example.com';
  select id into v_student from public.profiles where email = 'nominee-student@example.com';

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, false);

  -- Legacy faculty can be nominated.
  v_nom := public.nominate_admin(v_legacy, 'eligibility regression');
  if v_nom is null then
    raise exception 'FAIL: legacy faculty nomination returned null';
  end if;
  raise notice 'PASS E2: legacy approved faculty nomination accepted';

  perform public.cancel_admin_nomination(v_nom);

  -- Student with a manipulated status is rejected.
  begin
    perform public.nominate_admin(v_student, null);
  exception when others then
    v_msg := sqlerrm;
  end;
  if v_msg is null or position('approved faculty member' in v_msg) = 0 then
    raise exception 'FAIL: student nomination was not rejected (got "%")', coalesce(v_msg, 'no error');
  end if;
  raise notice 'PASS E3: manipulated student rejected by the database';

  -- Self-nomination is rejected.
  v_msg := null;
  begin
    perform public.nominate_admin(v_admin, null);
  exception when others then
    v_msg := sqlerrm;
  end;
  if v_msg is null then
    raise exception 'FAIL: self-nomination was accepted';
  end if;
  raise notice 'PASS E4: self-nomination rejected';

  if exists (select 1 from public.admin_nominations where status = 'pending') then
    raise exception 'FAIL: a rejected nomination left a pending row';
  end if;
end $$;

-- ---------------------------------------------------------
-- 3. Only the current administrator may nominate
-- ---------------------------------------------------------
do $$
declare
  v_legacy uuid;
  v_faculty uuid;
  v_msg text;
begin
  select id into v_legacy from public.profiles where email = 'nominee-legacy@example.com';
  select id into v_faculty from public.profiles where email = 'nominee-faculty@example.com';

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_legacy, 'role', 'authenticated')::text, false);

  begin
    perform public.nominate_admin(v_faculty, null);
  exception when others then
    v_msg := sqlerrm;
  end;

  if v_msg is null or position('Only the current administrator' in v_msg) = 0 then
    raise exception 'FAIL: non-admin nomination not rejected (got "%")', coalesce(v_msg, 'no error');
  end if;
  raise notice 'PASS E5: non-administrator cannot nominate';
end $$;

\echo 'Admin nominee eligibility regression: PASS'
