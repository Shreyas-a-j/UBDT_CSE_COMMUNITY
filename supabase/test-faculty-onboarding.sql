-- =========================================================
-- UCC 2.0 — Phase 8 secure faculty onboarding (SQL tests)
--
-- Run after supabase/schema.sql (or the full migration chain) has been
-- applied to a disposable database with the Supabase auth stub:
--
--   psql ... -f supabase/local-rehearsal/auth-stub.sql
--   psql ... -f supabase/schema.sql
--   psql ... -v ON_ERROR_STOP=1 -f supabase/test-faculty-onboarding.sql
--
-- Every scenario switches to the `authenticated` role with a real JWT
-- `sub` claim, so RLS and the transition triggers are exercised exactly as
-- PostgREST would exercise them. Nothing here touches a hosted project.
-- =========================================================

\echo '============================================'
\echo 'Phase 8 — Secure Faculty Onboarding SQL Tests'
\echo '============================================'

-- ---------------------------------------------------------
-- Clean any previous run (safe on a disposable database only).
-- ---------------------------------------------------------
delete from auth.users where email like 'phase8-%@example.com';

-- ---------------------------------------------------------
-- Fixtures. Inserting into auth.users fires handle_new_user(), which is the
-- same path Supabase Auth uses during signUp().
-- ---------------------------------------------------------
do $$
declare
  admin_id uuid;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
  values
    (gen_random_uuid(), 'phase8-student@example.com', 'x', now(),
     '{"name":"Phase 8 Student","intent":"student","usn":"4UB24CS901","year":2,"department":"CSE"}'::jsonb, now(), now()),
    (gen_random_uuid(), 'phase8-alumni@example.com', 'x', now(),
     '{"name":"Phase 8 Alumnus","intent":"alumni","graduation_year":2021,"department":"CSE"}'::jsonb, now(), now()),
    (gen_random_uuid(), 'phase8-pending@example.com', 'x', now(),
     '{"name":"Phase 8 Pending","intent":"faculty","designation":"Assistant Professor","department":"CSE","employee_id":"F-101"}'::jsonb, now(), now()),
    (gen_random_uuid(), 'phase8-approved@example.com', 'x', now(),
     '{"name":"Phase 8 Approved","intent":"faculty","designation":"Professor","department":"CSE"}'::jsonb, now(), now()),
    (gen_random_uuid(), 'phase8-rejected@example.com', 'x', now(),
     '{"name":"Phase 8 Rejected","intent":"faculty","designation":"Lecturer","department":"CSE"}'::jsonb, now(), now()),
    (gen_random_uuid(), 'phase8-self@example.com', 'x', now(),
     '{"name":"Phase 8 Self Insert","intent":"student","usn":"4UB24CS902"}'::jsonb, now(), now()),
    (gen_random_uuid(), 'phase8-admin@example.com', 'x', now(),
     '{"name":"Phase 8 Admin","intent":"student"}'::jsonb, now(), now());

  -- Elevate the admin fixture. The privilege-protection trigger deliberately
  -- restores role changes for non-admins, so setup temporarily disables it.
  select id into admin_id from public.profiles where email = 'phase8-admin@example.com';
  alter table public.profiles disable trigger trg_protect_profile_privileges;
  update public.profiles
  set role = 'admin', member_type = 'faculty', faculty_status = 'approved'
  where id = admin_id;
  alter table public.profiles enable trigger trg_protect_profile_privileges;
end $$;

-- Approved and rejected fixtures need an admin decision. Each runs in a
-- transaction with an administrator JWT, then COMMITs so later tests can use
-- the resulting profile state.
begin;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', (select id from public.profiles where email = 'phase8-admin@example.com'), 'role', 'authenticated')::text,
  true
);
update public.faculty_applications
set status = 'approved', reviewed_at = now()
where user_id = (select id from public.profiles where email = 'phase8-approved@example.com')
  and status = 'pending';
update public.faculty_applications
set status = 'rejected', reviewed_at = now(), review_notes = 'Fixture rejection'
where user_id = (select id from public.profiles where email = 'phase8-rejected@example.com')
  and status = 'pending';
commit;

\echo ''
\echo 'TEST 1: Schema objects and signup provisioning source'
do $$
declare
  src text;
  n int;
begin
  select count(*) into n from information_schema.columns
  where table_schema = 'public' and table_name = 'faculty_applications' and column_name = 'updated_at';
  if n <> 1 then
    raise exception 'FAIL: faculty_applications.updated_at is missing';
  end if;

  select count(*) into n from pg_trigger t join pg_class c on c.oid = t.tgrelid
  where c.relname = 'profiles' and t.tgname = 'trg_enforce_pending_faculty_signup';
  if n <> 1 then
    raise exception 'FAIL: trg_enforce_pending_faculty_signup is missing';
  end if;

  src := pg_get_functiondef('public.handle_new_user()'::regprocedure);
  if src not like '%insert into public.faculty_applications%' then
    raise exception 'FAIL: handle_new_user() does not provision the pending application';
  end if;
  if src not like '%Faculty signup requires a designation%' then
    raise exception 'FAIL: handle_new_user() does not require a faculty designation';
  end if;
end $$;
\echo '  PASS'

\echo ''
\echo 'TEST 2: Student and alumni signup keep standard access'
do $$
declare
  student public.profiles%rowtype;
  alumnus public.profiles%rowtype;
begin
  select * into student from public.profiles where email = 'phase8-student@example.com';
  if student.role <> 'student' or student.faculty_status <> 'none' or student.member_type <> 'student' then
    raise exception 'FAIL: student signup gained non-student access: role %, status %, member %',
      student.role, student.faculty_status, student.member_type;
  end if;

  select * into alumnus from public.profiles where email = 'phase8-alumni@example.com';
  if alumnus.role <> 'student' or alumnus.member_type <> 'alumni' or alumnus.usn is not null then
    raise exception 'FAIL: alumni without USN was not preserved: role %, member %, usn %',
      alumnus.role, alumnus.member_type, alumnus.usn;
  end if;

  if exists (select 1 from public.faculty_applications where user_id in (student.id, alumnus.id)) then
    raise exception 'FAIL: a student/alumni signup created a faculty application';
  end if;
end $$;
\echo '  PASS'

\echo ''
\echo 'TEST 3: Faculty signup is pending and creates exactly one application'
do $$
declare
  p public.profiles%rowtype;
  app public.faculty_applications%rowtype;
  n int;
begin
  select * into p from public.profiles where email = 'phase8-pending@example.com';
  if p.role <> 'student' or p.faculty_status <> 'pending' or p.member_type <> 'student' then
    raise exception 'FAIL: pending applicant has unexpected profile: role %, status %, member %',
      p.role, p.faculty_status, p.member_type;
  end if;
  if p.designation is null then
    raise exception 'FAIL: designation was not recorded on the pending profile';
  end if;

  select count(*) into n from public.faculty_applications where user_id = p.id and status = 'pending';
  if n <> 1 then
    raise exception 'FAIL: expected exactly one pending application, found %', n;
  end if;

  select * into app from public.faculty_applications where user_id = p.id and status = 'pending';
  if app.designation <> 'Assistant Professor' or app.employee_id <> 'F-101' then
    raise exception 'FAIL: application details not copied from signup metadata';
  end if;
  if app.reviewed_by is not null or app.reviewed_at is not null then
    raise exception 'FAIL: a signup-created application carries reviewer fields';
  end if;
end $$;
\echo '  PASS'

\echo ''
\echo 'TEST 4: Faculty signup without a designation is rejected atomically'
do $$
declare
  before_users int;
  after_users int;
begin
  select count(*) into before_users from auth.users;
  begin
    insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
    values (gen_random_uuid(), 'phase8-no-designation@example.com', 'x', now(),
      '{"name":"No Designation","intent":"faculty"}'::jsonb, now(), now());
    raise exception 'FAIL: faculty signup without a designation was accepted';
  exception when check_violation then
    null; -- expected 23514
  end;

  select count(*) into after_users from auth.users;
  if after_users <> before_users then
    raise exception 'FAIL: failed signup left an auth user behind (% -> %)', before_users, after_users;
  end if;
  if exists (select 1 from public.profiles where email = 'phase8-no-designation@example.com') then
    raise exception 'FAIL: failed signup left a profile behind';
  end if;
end $$;
\echo '  PASS'

\echo ''
\echo 'TEST 5: Direct self-insert cannot grant role, status or identity'
do $$
declare
  self_id uuid;
  before_count int;
  after_count int;
begin
  select id into self_id from public.profiles where email = 'phase8-self@example.com';
  delete from public.profiles where id = self_id; -- simulate a missing trigger profile

  -- Admin role claim.
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', self_id, 'role', 'authenticated')::text, true);
    insert into public.profiles (id, email, name, role, faculty_status, member_type)
    values (self_id, 'phase8-self@example.com', 'Self', 'admin', 'none', 'student');
    raise exception 'FAIL: self-insert with role=admin was accepted';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;

  reset role;
  select count(*) into before_count from public.profiles where id = self_id;

  -- Approved faculty status.
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', self_id, 'role', 'authenticated')::text, true);
    insert into public.profiles (id, email, name, role, faculty_status, member_type)
    values (self_id, 'phase8-self@example.com', 'Self', 'student', 'approved', 'student');
    raise exception 'FAIL: self-insert with faculty_status=approved was accepted';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;

  reset role;
  -- Declared faculty member type.
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', self_id, 'role', 'authenticated')::text, true);
    insert into public.profiles (id, email, name, role, faculty_status, member_type)
    values (self_id, 'phase8-self@example.com', 'Self', 'student', 'none', 'faculty');
    raise exception 'FAIL: self-insert with member_type=faculty was accepted';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;

  reset role;
  select count(*) into after_count from public.profiles where id = self_id;
  if after_count <> before_count then
    raise exception 'FAIL: a blocked self-insert still created a profile';
  end if;

  -- A legitimate non-privileged self-insert still works (fallback path).
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', self_id, 'role', 'authenticated')::text, true);
  insert into public.profiles (id, email, name, role, faculty_status, member_type)
  values (self_id, 'phase8-self@example.com', 'Self', 'student', 'none', 'student');
  reset role;

  if not exists (
    select 1 from public.profiles
    where id = self_id and role = 'student' and faculty_status = 'none' and member_type = 'student'
  ) then
    raise exception 'FAIL: legitimate non-privileged self-insert did not persist';
  end if;
end $$;
\echo '  PASS'

\echo ''
\echo 'TEST 6: Pending user cannot change own role/status or approve themselves'
do $$
declare
  pending_id uuid;
  app_id uuid;
  affected int;
  p public.profiles%rowtype;
  app public.faculty_applications%rowtype;
begin
  select id into pending_id from public.profiles where email = 'phase8-pending@example.com';
  select id into app_id from public.faculty_applications where user_id = pending_id and status = 'pending';

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', pending_id, 'role', 'authenticated')::text, true);

  update public.profiles set role = 'faculty', faculty_status = 'approved', member_type = 'faculty'
  where id = pending_id;
  get diagnostics affected = row_count;

  update public.faculty_applications set status = 'approved', reviewed_by = pending_id, reviewed_at = now()
  where id = app_id;
  get diagnostics affected = row_count;
  if affected <> 0 then
    raise exception 'FAIL: pending user updated their own application (% rows)', affected;
  end if;

  reset role;
  select * into p from public.profiles where id = pending_id;
  select * into app from public.faculty_applications where id = app_id;

  if p.role <> 'student' or p.faculty_status <> 'pending' or p.member_type <> 'student' then
    raise exception 'FAIL: pending user escalated profile to role %, status %, member %',
      p.role, p.faculty_status, p.member_type;
  end if;
  if app.status <> 'pending' or app.reviewed_by is not null then
    raise exception 'FAIL: pending user altered the application (status %, reviewer %)', app.status, app.reviewed_by;
  end if;
end $$;
\echo '  PASS'

\echo ''
\echo 'TEST 7: Pending user cannot read another applicant''s application'
do $$
declare
  pending_id uuid;
  visible int;
begin
  select id into pending_id from public.profiles where email = 'phase8-pending@example.com';

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', pending_id, 'role', 'authenticated')::text, true);

  select count(*) into visible from public.faculty_applications;

  reset role;
  if visible <> 1 then
    raise exception 'FAIL: pending user can see % applications (expected only their own)', visible;
  end if;
end $$;
\echo '  PASS'

\echo ''
\echo 'TEST 8: Pending, rejected, student and alumni cannot publish'
do $$
declare
  uid uuid;
  before_count int;
  after_count int;
  who text;
begin
  foreach who in array array['phase8-pending@example.com', 'phase8-rejected@example.com', 'phase8-student@example.com', 'phase8-alumni@example.com']
  loop
    select id into uid from public.profiles where email = who;
    select count(*) into before_count from public.announcements;

    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
    begin
      insert into public.announcements (author_id, title, body) values (uid, 'Nope', 'Nope');
      raise exception 'FAIL: % published an announcement', who;
    exception when insufficient_privilege then
      null; -- expected RLS denial
    end;
    reset role;

    select count(*) into after_count from public.announcements;
    if after_count <> before_count then
      raise exception 'FAIL: % inserted an announcement despite denial', who;
    end if;
  end loop;
end $$;
\echo '  PASS'

\echo ''
\echo 'TEST 9: Approved faculty can publish; admin approval is consistent and audited'
do $$
declare
  faculty_id uuid;
  admin_id uuid;
  app public.faculty_applications%rowtype;
  p public.profiles%rowtype;
  inserted uuid;
begin
  select id into faculty_id from public.profiles where email = 'phase8-approved@example.com';
  select id into admin_id from public.profiles where email = 'phase8-admin@example.com';

  select * into app from public.faculty_applications where user_id = faculty_id order by created_at desc limit 1;
  select * into p from public.profiles where id = faculty_id;

  if app.status <> 'approved' then
    raise exception 'FAIL: admin approval did not persist (status %)', app.status;
  end if;
  if app.reviewed_by is distinct from admin_id then
    raise exception 'FAIL: reviewed_by was not forced to the acting admin (got %)', app.reviewed_by;
  end if;
  if app.reviewed_at is null then
    raise exception 'FAIL: reviewed_at was not set on approval';
  end if;
  if p.role <> 'faculty' or p.faculty_status <> 'approved' or p.member_type <> 'faculty' then
    raise exception 'FAIL: approval did not promote the profile: role %, status %, member %',
      p.role, p.faculty_status, p.member_type;
  end if;
  if p.designation <> 'Professor' then
    raise exception 'FAIL: approval did not copy the application designation';
  end if;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', faculty_id, 'role', 'authenticated')::text, true);
  insert into public.announcements (author_id, title, body)
  values (faculty_id, 'Approved faculty notice', 'Welcome.')
  returning id into inserted;
  reset role;

  if inserted is null then
    raise exception 'FAIL: approved faculty could not publish';
  end if;
end $$;
\echo '  PASS'

\echo ''
\echo 'TEST 10: Approval is admin-only and cannot be reverted or spoofed'
do $$
declare
  pending_id uuid;
  app_id uuid;
  admin_id uuid;
  faculty_id uuid;
  affected int;
  status_now text;
  app public.faculty_applications%rowtype;
begin
  select id into pending_id from public.profiles where email = 'phase8-pending@example.com';
  select id into app_id from public.faculty_applications where user_id = pending_id and status = 'pending';
  select id into admin_id from public.profiles where email = 'phase8-admin@example.com';
  select id into faculty_id from public.profiles where email = 'phase8-approved@example.com';

  -- A non-admin cannot approve, even if they are the applicant.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', pending_id, 'role', 'authenticated')::text, true);
  update public.faculty_applications set status = 'approved' where id = app_id;
  get diagnostics affected = row_count;
  reset role;
  if affected <> 0 then
    raise exception 'FAIL: non-admin approval affected % rows', affected;
  end if;

  -- No JWT at all (service-role/operator path) must fail loudly rather than
  -- writing status=approved while the profile promotion is silently reverted
  -- by protect_profile_privileges().
  perform set_config('request.jwt.claims', '', true);
  begin
    update public.faculty_applications set status = 'approved' where id = app_id;
    raise exception 'FAIL: approval without an administrator JWT was accepted';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  select status into status_now from public.faculty_applications where id = app_id;
  if status_now <> 'pending' then
    raise exception 'FAIL: no-JWT approval changed application status to %', status_now;
  end if;

  -- The reviewer and audit time are server-controlled, even if the admin
  -- client sends different values.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  update public.faculty_applications
  set status = 'approved', reviewed_by = pending_id, reviewed_at = '2000-01-01T00:00:00Z'::timestamptz
  where id = app_id;
  reset role;

  select * into app from public.faculty_applications where id = app_id;
  if app.reviewed_by is distinct from admin_id then
    raise exception 'FAIL: reviewed_by was not forced to the acting admin (got %)', app.reviewed_by;
  end if;
  if app.reviewed_at < '2020-01-01T00:00:00Z'::timestamptz then
    raise exception 'FAIL: client-supplied reviewed_at was preserved (%)', app.reviewed_at;
  end if;

  -- An admin approval cannot be reverted by the transition trigger.
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    update public.faculty_applications
    set status = 'rejected', reviewed_by = faculty_id, reviewed_at = now()
    where user_id = faculty_id and status = 'approved';
    raise exception 'FAIL: approved application was reverted to rejected';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  reset role;

  select status into status_now from public.faculty_applications where user_id = faculty_id order by created_at desc limit 1;
  if status_now <> 'approved' then
    raise exception 'FAIL: approved application status changed to %', status_now;
  end if;

  -- An approved faculty account cannot file a second pending application.
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', faculty_id, 'role', 'authenticated')::text, true);
    insert into public.faculty_applications (user_id, full_name, official_email, department, designation, status)
    values (faculty_id, 'Phase 8 Approved', 'phase8-approved@example.com', 'CSE', 'Professor', 'pending');
    raise exception 'FAIL: approved faculty filed a second application';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  reset role;
end $$;
\echo '  PASS'

\echo ''
\echo 'TEST 11: Rejected account keeps student access and may reapply'
do $$
declare
  rejected_id uuid;
  p public.profiles%rowtype;
  before_count int;
  after_count int;
begin
  select id into rejected_id from public.profiles where email = 'phase8-rejected@example.com';
  select * into p from public.profiles where id = rejected_id;

  if p.role <> 'student' or p.faculty_status <> 'rejected' then
    raise exception 'FAIL: rejected applicant has role %, status %', p.role, p.faculty_status;
  end if;

  select count(*) into before_count from public.faculty_applications where user_id = rejected_id and status = 'pending';

  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', rejected_id, 'role', 'authenticated')::text, true);
    insert into public.faculty_applications (user_id, full_name, official_email, department, designation, status)
    values (rejected_id, 'Phase 8 Rejected', 'phase8-rejected@example.com', 'CSE', 'Lecturer', 'pending');
    reset role;
  exception when others then
    reset role;
    raise exception 'FAIL: rejected applicant could not reapply: %', sqlerrm;
  end;

  select count(*) into after_count from public.faculty_applications where user_id = rejected_id and status = 'pending';
  if after_count <> before_count + 1 then
    raise exception 'FAIL: reapplication was not stored';
  end if;

  select * into p from public.profiles where id = rejected_id;
  if p.role <> 'student' or p.faculty_status <> 'pending' then
    raise exception 'FAIL: reapplication left profile at role %, status % (expected student/pending)',
      p.role, p.faculty_status;
  end if;

  -- The narrow pending exception must not become a route to approval.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', rejected_id, 'role', 'authenticated')::text, true);
  update public.profiles set faculty_status = 'approved', role = 'faculty', member_type = 'faculty'
  where id = rejected_id;
  reset role;

  select * into p from public.profiles where id = rejected_id;
  if p.role <> 'student' or p.faculty_status <> 'pending' or p.member_type <> 'student' then
    raise exception 'FAIL: reapplication exception allowed privilege escalation: role %, status %, member %',
      p.role, p.faculty_status, p.member_type;
  end if;
end $$;
\echo '  PASS'

\echo ''
\echo '============================================'
\echo 'All Phase 8 faculty onboarding SQL tests passed.'
\echo '============================================'
