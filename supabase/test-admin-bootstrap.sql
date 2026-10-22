-- =========================================================
-- UCC — Phase 12 admin-bootstrap + succession assertions
--
-- Run after:
--   1. supabase/test-admin-bootstrap-fixtures.sql
--   2. the deliberately-failing first bootstrap attempt (demo is pending)
--   3. supabase/test-admin-bootstrap-eligible.sql
--   4. the successful bootstrap script
--
-- Disposable-database only. It asserts:
--   * exactly one administrator exists, and it is demo@gmail.com
--   * the personal student account was not touched
--   * the bootstrap marker and a 'bootstrap' audit row exist
--   * a client cannot self-promote or create a second administrator
--   * only the current admin can nominate; the nominee must accept
--   * decline/cancel leave the current administrator in place
--   * the audit log is admin-only
-- =========================================================

\echo ''
\echo 'TEST A1: only the intended approved-faculty account became admin'
do $test$
declare
  v_demo uuid;
  v_peer uuid;
  v_student uuid;
  v_admins int;
  v_state int;
  v_audit int;
begin
  select id into v_demo from public.profiles where email = 'demo@gmail.com';
  select id into v_peer from public.profiles where email = 'admin-peer@example.com';
  select id into v_student from public.profiles where email = 'student-account@example.com';

  select count(*) into v_admins from public.profiles where role = 'admin';
  if v_admins <> 1 then
    raise exception 'FAIL: expected exactly one administrator, found %', v_admins;
  end if;

  if not exists (
    select 1 from public.profiles
    where id = v_demo and role = 'admin' and faculty_status = 'approved'
  ) then
    raise exception 'FAIL: demo@gmail.com is not the approved administrator';
  end if;

  -- The personal student must remain a student, even though it is a real
  -- auth-backed profile in the same database.
  if not exists (
    select 1 from public.profiles
    where id = v_student and role = 'student' and faculty_status = 'none'
  ) then
    raise exception 'FAIL: the personal student account changed role/status';
  end if;

  -- The peer remains eligible but is not an administrator yet.
  if not exists (
    select 1 from public.profiles
    where id = v_peer and role = 'faculty' and faculty_status = 'approved'
      and member_type = 'faculty'
  ) then
    raise exception 'FAIL: the approved peer fixture is no longer eligible faculty';
  end if;

  select count(*) into v_state from public.admin_bootstrap_state;
  if v_state <> 1 then
    raise exception 'FAIL: expected exactly one bootstrap marker, found %', v_state;
  end if;

  if not exists (
    select 1 from public.admin_bootstrap_state
    where target_id = v_demo and target_email = 'demo@gmail.com'
  ) then
    raise exception 'FAIL: bootstrap marker does not identify the demo profile';
  end if;

  select count(*) into v_audit
  from public.admin_audit_log
  where action = 'bootstrap'
    and target_id = v_demo
    and outcome = 'completed'
    and actor_id is null
    and actor_name like 'operator (%';
  if v_audit <> 1 then
    raise exception 'FAIL: expected one operator bootstrap audit row, found %', v_audit;
  end if;
end;
$test$;
\echo '  PASS A1'

\echo ''
\echo 'TEST A2: a signed-in client cannot promote itself to admin'
do $test$
declare
  v_student uuid;
  v_role text;
begin
  select id into v_student from public.profiles where email = 'student-account@example.com';

  set local role authenticated;
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_student, 'role', 'authenticated')::text,
    true
  );

  begin
    update public.profiles set role = 'admin' where id = v_student;
    raise exception 'FAIL: a signed-in student promoted itself to admin';
  exception when insufficient_privilege then
    null; -- the Phase 11 transition trigger is the expected denial
  end;

  reset role;

  select role into v_role from public.profiles where id = v_student;
  if v_role <> 'student' then
    raise exception 'FAIL: student role changed to %', v_role;
  end if;
end;
$test$;
\echo '  PASS A2'

\echo ''
\echo 'TEST A3: even an owner cannot materialise a second administrator'
do $test$
declare
  v_peer uuid;
begin
  select id into v_peer from public.profiles where email = 'admin-peer@example.com';

  perform set_config('ucc.admin_transition', 'on', true);
  begin
    update public.profiles set role = 'admin' where id = v_peer;
    raise exception 'FAIL: a second administrator row was accepted';
  exception when unique_violation then
    null; -- profiles_single_admin
  end;
  perform set_config('ucc.admin_transition', 'off', true);

  if (select count(*) from public.profiles where role = 'admin') <> 1 then
    raise exception 'FAIL: administrator count is no longer exactly one';
  end if;
end;
$test$;
\echo '  PASS A3'

\echo ''
\echo 'TEST A4: only the current admin nominates; acceptance performs the transfer'
do $test$
declare
  v_demo uuid;
  v_peer uuid;
  v_nom uuid;
  v_status text;
  v_admins int;
begin
  select id into v_demo from public.profiles where email = 'demo@gmail.com';
  select id into v_peer from public.profiles where email = 'admin-peer@example.com';

  -- A non-admin cannot nominate.
  set local role authenticated;
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_peer, 'role', 'authenticated')::text,
    true
  );
  begin
    perform public.nominate_admin(v_demo, 'not the admin yet');
    raise exception 'FAIL: a non-admin nominated an administrator';
  exception when insufficient_privilege then
    null;
  end;
  reset role;

  -- The current admin can nominate an approved faculty peer.
  set local role authenticated;
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_demo, 'role', 'authenticated')::text,
    true
  );
  v_nom := public.nominate_admin(v_peer, 'handover rehearsal');
  reset role;

  select status into v_status from public.admin_nominations where id = v_nom;
  if v_status <> 'pending' then
    raise exception 'FAIL: nomination is %, expected pending', v_status;
  end if;

  -- The nominee must accept; the admin alone cannot complete the transfer.
  if (select role from public.profiles where id = v_demo) <> 'admin' then
    raise exception 'FAIL: nominating already changed the administrator';
  end if;

  set local role authenticated;
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_peer, 'role', 'authenticated')::text,
    true
  );
  perform public.accept_admin_nomination(v_nom);
  reset role;

  select count(*) into v_admins from public.profiles where role = 'admin';
  if v_admins <> 1 then
    raise exception 'FAIL: expected one administrator after transfer, found %', v_admins;
  end if;
  if not exists (select 1 from public.profiles where id = v_peer and role = 'admin') then
    raise exception 'FAIL: the accepting nominee is not the administrator';
  end if;
  if not exists (
    select 1 from public.profiles
    where id = v_demo and role = 'faculty' and faculty_status = 'approved'
  ) then
    raise exception 'FAIL: the previous admin was not demoted to approved faculty';
  end if;

  select status into v_status from public.admin_nominations where id = v_nom;
  if v_status <> 'accepted' then
    raise exception 'FAIL: nomination is %, expected accepted', v_status;
  end if;

  if not exists (
    select 1 from public.admin_audit_log
    where action = 'admin_transfer'
      and actor_id = v_peer
      and target_id = v_peer
      and nomination_id = v_nom
      and outcome = 'accepted'
  ) then
    raise exception 'FAIL: transfer was not audited against the nominee';
  end if;
end;
$test$;
\echo '  PASS A4'

\echo ''
\echo 'TEST A5: self, unapproved and second pending nominations are refused'
do $test$
declare
  v_demo uuid;
  v_peer uuid;
  v_student uuid;
begin
  select id into v_demo from public.profiles where email = 'demo@gmail.com';
  select id into v_peer from public.profiles where email = 'admin-peer@example.com';
  select id into v_student from public.profiles where email = 'student-account@example.com';

  set local role authenticated;
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_peer, 'role', 'authenticated')::text,
    true
  );

  begin
    perform public.nominate_admin(v_peer, 'me');
    raise exception 'FAIL: the admin nominated itself';
  exception when sqlstate '22023' then
    null;
  end;

  begin
    perform public.nominate_admin(v_student, 'not faculty');
    raise exception 'FAIL: an unapproved student was nominated';
  exception when sqlstate '22023' then
    null;
  end;

  perform public.nominate_admin(v_demo, 'first pending');
  begin
    perform public.nominate_admin(v_demo, 'second pending');
    raise exception 'FAIL: a second pending nomination was accepted';
  exception when unique_violation then
    null;
  end;

  reset role;

  -- Clean up the pending nomination through the audited cancel path.
  set local role authenticated;
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_peer, 'role', 'authenticated')::text,
    true
  );
  perform public.cancel_admin_nomination(
    (select id from public.admin_nominations where status = 'pending')
  );
  reset role;
end;
$test$;
\echo '  PASS A5'

\echo ''
\echo 'TEST A6: decline and cancel keep the current administrator'
do $test$
declare
  v_demo uuid;
  v_peer uuid;
  v_nom uuid;
  v_status text;
begin
  select id into v_demo from public.profiles where email = 'demo@gmail.com';
  select id into v_peer from public.profiles where email = 'admin-peer@example.com';

  -- Nominee declines.
  set local role authenticated;
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_peer, 'role', 'authenticated')::text,
    true
  );
  v_nom := public.nominate_admin(v_demo, 'decline rehearsal');
  reset role;

  set local role authenticated;
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_demo, 'role', 'authenticated')::text,
    true
  );
  perform public.decline_admin_nomination(v_nom);
  reset role;

  select status into v_status from public.admin_nominations where id = v_nom;
  if v_status <> 'declined' then
    raise exception 'FAIL: declined nomination has status %', v_status;
  end if;
  if not exists (select 1 from public.profiles where id = v_peer and role = 'admin') then
    raise exception 'FAIL: declining changed the administrator';
  end if;
  if not exists (
    select 1 from public.admin_audit_log
    where action = 'nomination_declined' and nomination_id = v_nom and outcome = 'declined'
  ) then
    raise exception 'FAIL: decline was not audited';
  end if;

  -- Admin cancels.
  set local role authenticated;
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_peer, 'role', 'authenticated')::text,
    true
  );
  v_nom := public.nominate_admin(v_demo, 'cancel rehearsal');
  perform public.cancel_admin_nomination(v_nom);
  reset role;

  select status into v_status from public.admin_nominations where id = v_nom;
  if v_status <> 'cancelled' then
    raise exception 'FAIL: cancelled nomination has status %', v_status;
  end if;
  if not exists (select 1 from public.profiles where id = v_peer and role = 'admin') then
    raise exception 'FAIL: cancelling changed the administrator';
  end if;
  if not exists (
    select 1 from public.admin_audit_log
    where action = 'nomination_cancelled' and nomination_id = v_nom and outcome = 'cancelled'
  ) then
    raise exception 'FAIL: cancellation was not audited';
  end if;
end;
$test$;
\echo '  PASS A6'

\echo ''
\echo 'TEST A7: audit history and bootstrap marker are not client-readable'
do $test$
declare
  v_demo uuid;
  v_peer uuid;
  v_student uuid;
  v_count int;
begin
  select id into v_demo from public.profiles where email = 'demo@gmail.com';
  select id into v_peer from public.profiles where email = 'admin-peer@example.com';
  select id into v_student from public.profiles where email = 'student-account@example.com';

  set local role authenticated;
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_student, 'role', 'authenticated')::text,
    true
  );
  select count(*) into v_count from public.admin_audit_log;
  if v_count <> 0 then
    raise exception 'FAIL: a student read % administrator audit rows', v_count;
  end if;

  begin
    perform 1 from public.admin_bootstrap_state;
    raise exception 'FAIL: a student read the bootstrap marker';
  exception when insufficient_privilege then
    null;
  end;
  reset role;

  set local role authenticated;
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_peer, 'role', 'authenticated')::text,
    true
  );
  select count(*) into v_count from public.admin_audit_log;
  if v_count = 0 then
    raise exception 'FAIL: the current administrator cannot read the audit history';
  end if;
  reset role;
end;
$test$;
\echo '  PASS A7'

\echo ''
\echo 'All Phase 12 admin bootstrap and succession assertions passed.'
