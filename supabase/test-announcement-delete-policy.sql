-- =========================================================
-- Announcements DELETE policy — regression test
--
-- Reproduces the hosted failure mode: RLS is enabled but there is no
-- FOR DELETE policy, so PostgREST filters the DELETE to zero rows and the
-- row survives while the UI reports success. This test runs inside a
-- transaction and rolls everything back.
--
-- Run after the migration chain (2026102001 + 2026102603) on a disposable
-- database. Asserts:
--   * the DELETE policy exists and names auth.uid()/is_admin();
--   * the author can delete their own announcement;
--   * another faculty member and a student cannot;
--   * an administrator can delete any announcement.
-- =========================================================

\set ON_ERROR_STOP 1
\echo 'Announcement delete policy regression'

begin;

-- ---------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------
insert into auth.users (
  id, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at
) values
  (gen_random_uuid(), 'ann-author@example.com', 'x', now(),
   '{"name":"Ann Author","intent":"student"}'::jsonb, now(), now()),
  (gen_random_uuid(), 'ann-other@example.com', 'x', now(),
   '{"name":"Ann Other","intent":"student"}'::jsonb, now(), now()),
  (gen_random_uuid(), 'ann-student@example.com', 'x', now(),
   '{"name":"Ann Student","intent":"student"}'::jsonb, now(), now()),
  (gen_random_uuid(), 'ann-admin@example.com', 'x', now(),
   '{"name":"Ann Admin","intent":"student"}'::jsonb, now(), now());

alter table public.profiles disable trigger trg_protect_profile_privileges;
update public.profiles
set role = 'faculty', faculty_status = 'approved', member_type = 'faculty'
where email in ('ann-author@example.com', 'ann-other@example.com');
update public.profiles
set role = 'student', faculty_status = 'none', member_type = 'student'
where email = 'ann-student@example.com';

-- Use the existing administrator when the database already has one;
-- otherwise promote the fixture account.
update public.profiles
set role = 'admin', faculty_status = 'approved', member_type = 'faculty'
where email = 'ann-admin@example.com'
  and not exists (select 1 from public.profiles where role = 'admin');

alter table public.profiles enable trigger trg_protect_profile_privileges;

select id as admin_id from public.profiles where role = 'admin' limit 1 \gset
select id as author_id from public.profiles where email = 'ann-author@example.com' \gset
select id as other_id from public.profiles where email = 'ann-other@example.com' \gset
select id as student_id from public.profiles where email = 'ann-student@example.com' \gset

insert into public.announcements (author_id, title, body)
select id, 'AnnDeleteTest author', 'body' from public.profiles where email = 'ann-author@example.com'
union all
select id, 'AnnDeleteTest other', 'body' from public.profiles where email = 'ann-author@example.com'
union all
select id, 'AnnDeleteTest student', 'body' from public.profiles where email = 'ann-author@example.com'
union all
select id, 'AnnDeleteTest admin', 'body' from public.profiles where email = 'ann-author@example.com';

-- ---------------------------------------------------------
-- 1. The policy exists
-- ---------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'announcements'
      and cmd = 'DELETE'
      and qual ilike '%author_id%'
      and qual ilike '%is_admin%'
  ) then
    raise exception 'FAIL: announcements DELETE policy is missing or incomplete';
  end if;
  raise notice 'PASS A0: announcements DELETE policy present';
end $$;

-- ---------------------------------------------------------
-- 2. Author may delete their own announcement
-- ---------------------------------------------------------
select set_config(
  'request.jwt.claims',
  json_build_object('sub', :'author_id'::uuid, 'role', 'authenticated')::text,
  true
);
set local role authenticated;
do $$
declare
  v_rows integer;
begin
  delete from public.announcements where title = 'AnnDeleteTest author';
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'FAIL: author delete removed % row(s), expected 1', v_rows;
  end if;
end $$;
reset role;

do $$
begin
  if exists (select 1 from public.announcements where title = 'AnnDeleteTest author') then
    raise exception 'FAIL: author delete left the row in place';
  end if;
  raise notice 'PASS A1: author deleted their own announcement';
end $$;

-- ---------------------------------------------------------
-- 3. Another faculty member cannot delete it
-- ---------------------------------------------------------
select set_config(
  'request.jwt.claims',
  json_build_object('sub', :'other_id'::uuid, 'role', 'authenticated')::text,
  true
);
set local role authenticated;
do $$
declare
  v_rows integer;
begin
  delete from public.announcements where title = 'AnnDeleteTest other';
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'FAIL: another faculty member deleted % row(s)', v_rows;
  end if;
end $$;
reset role;

do $$
begin
  if not exists (select 1 from public.announcements where title = 'AnnDeleteTest other') then
    raise exception 'FAIL: row disappeared despite a denied delete';
  end if;
  raise notice 'PASS A2: another faculty member cannot delete';
end $$;

-- ---------------------------------------------------------
-- 4. A student cannot delete
-- ---------------------------------------------------------
select set_config(
  'request.jwt.claims',
  json_build_object('sub', :'student_id'::uuid, 'role', 'authenticated')::text,
  true
);
set local role authenticated;
do $$
declare
  v_rows integer;
begin
  delete from public.announcements where title = 'AnnDeleteTest student';
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'FAIL: a student deleted % row(s)', v_rows;
  end if;
end $$;
reset role;

do $$
begin
  if not exists (select 1 from public.announcements where title = 'AnnDeleteTest student') then
    raise exception 'FAIL: student-denied row disappeared';
  end if;
  raise notice 'PASS A3: a student cannot delete';
end $$;

-- ---------------------------------------------------------
-- 5. An administrator can delete any announcement
-- ---------------------------------------------------------
select set_config(
  'request.jwt.claims',
  json_build_object('sub', :'admin_id'::uuid, 'role', 'authenticated')::text,
  true
);
set local role authenticated;
do $$
declare
  v_rows integer;
begin
  delete from public.announcements where title = 'AnnDeleteTest admin';
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'FAIL: admin delete removed % row(s), expected 1', v_rows;
  end if;
end $$;
reset role;

do $$
begin
  if exists (select 1 from public.announcements where title = 'AnnDeleteTest admin') then
    raise exception 'FAIL: admin delete left the row in place';
  end if;
  raise notice 'PASS A4: administrator can delete';
end $$;

-- Everything above (users, profiles, announcements and the fan-out rows the
-- announcement trigger created) is discarded.
rollback;

\echo 'Announcement delete policy regression: PASS'
