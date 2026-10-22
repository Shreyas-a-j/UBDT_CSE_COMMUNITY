-- =========================================================
-- UCC — read-only faculty-onboarding readiness check
--
-- Run in the Supabase SQL Editor after applying:
--   1. 2026102211_signup_provisioning_schema_alignment.sql
--   2. 2026102207_secure_faculty_onboarding.sql
--
-- It changes nothing. Every boolean should be true when the live database
-- is ready for faculty signup provisioning.
-- =========================================================

select
  to_regprocedure('public.handle_new_user()') is not null as signup_trigger_function,
  coalesce((
    select pg_get_functiondef(p.oid) like '%insert into public.faculty_applications%'
    from pg_proc p
    where p.oid = to_regprocedure('public.handle_new_user()')
  ), false) as signup_creates_application,
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.profiles'::regclass
      and tgname = 'trg_enforce_pending_faculty_signup'
  ) as signup_guard,
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.faculty_applications'::regclass
      and tgname = 'trg_faculty_application_created'
  ) as pending_profile_sync,
  (select count(*) from public.profiles where faculty_status = 'pending') as pending_profiles,
  (select count(*) from public.faculty_applications where status = 'pending') as pending_applications,
  (
    select count(*)
    from public.profiles p
    where p.faculty_status = 'pending'
      and not exists (
        select 1
        from public.faculty_applications a
        where a.user_id = p.id
          and a.status = 'pending'
      )
  ) as pending_without_application;

-- Optional: show the pending requests the admin dashboard should render.
-- select
--   a.id as application_id,
--   a.full_name,
--   a.official_email,
--   a.department,
--   a.designation,
--   a.created_at,
--   p.role as profile_role,
--   p.faculty_status as profile_faculty_status
-- from public.faculty_applications a
-- join public.profiles p on p.id = a.user_id
-- where a.status = 'pending'
-- order by a.created_at desc;
