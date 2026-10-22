-- =========================================================
-- UCC — fixtures for the admin-bootstrap rehearsal
--
-- Disposable-database only. Creates:
--   * demo@gmail.com          → intended bootstrap account, deliberately
--                                INELIGIBLE at first (pending faculty)
--   * admin-peer@example.com  → approved faculty (a future nominee)
--   * student-account@example.com → personal student account
--
-- No administrator is created. If one exists, this fixture aborts: the
-- bootstrap rehearsal must start from the real "no admin yet" state.
-- =========================================================

-- Reset any previous run. No auth user below may already own an admin role.
delete from public.admin_nominations;
delete from public.admin_audit_log;
delete from public.admin_bootstrap_state;
delete from auth.users
where email in (
  'demo@gmail.com',
  'admin-peer@example.com',
  'student-account@example.com'
);

do $fixtures$
declare
  v_peer uuid;
begin
  if exists (select 1 from public.profiles where role = 'admin') then
    raise exception 'FAIL: fixture requires a database with no administrator';
  end if;

  insert into auth.users (
    id, email, encrypted_password, email_confirmed_at,
    raw_user_meta_data, created_at, updated_at
  ) values
    (
      gen_random_uuid(), 'demo@gmail.com', 'x', now(),
      '{"name":"Demo Faculty","intent":"faculty","designation":"Professor","department":"CSE"}'::jsonb,
      now(), now()
    ),
    (
      gen_random_uuid(), 'admin-peer@example.com', 'x', now(),
      '{"name":"Approved Peer","intent":"faculty","designation":"Associate Professor","department":"CSE"}'::jsonb,
      now(), now()
    ),
    (
      gen_random_uuid(), 'student-account@example.com', 'x', now(),
      '{"name":"Personal Student","intent":"student","usn":"4UB24CS999","year":2,"department":"CSE"}'::jsonb,
      now(), now()
    );

  -- The signup trigger intentionally provisions every faculty-intent account
  -- as student/pending. Promote only the peer to approved faculty, using the
  -- same owner-only fixture technique as the existing Phase 8 suite. The demo
  -- account stays pending so the first bootstrap attempt must fail.
  select id into v_peer from public.profiles where email = 'admin-peer@example.com';

  alter table public.profiles disable trigger trg_protect_profile_privileges;
  update public.profiles
  set role = 'faculty',
      faculty_status = 'approved',
      member_type = 'faculty'
  where id = v_peer;
  alter table public.profiles enable trigger trg_protect_profile_privileges;
end;
$fixtures$;
