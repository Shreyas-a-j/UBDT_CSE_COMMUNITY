-- =========================================================
-- UCC — read-only preflight for the initial administrator bootstrap
--
-- Run this in the Supabase SQL Editor BEFORE
-- supabase/admin/bootstrap-initial-admin.sql. It changes nothing.
--
-- It answers one question: is demo@gmail.com a live, approved faculty
-- profile, and is the one-time bootstrap still available?
--
-- If can_bootstrap is false, STOP. Read blocking_reasons, report the result,
-- and do not promote a different account.
-- =========================================================

with target_email as (
  select lower(btrim('demo@gmail.com')) as email
),
auth_matches as (
  select
    count(*) as match_count,
    (array_agg(u.id order by u.created_at))[1] as auth_id,
    (array_agg(u.email order by u.created_at))[1] as auth_email,
    (array_agg(u.email_confirmed_at order by u.created_at))[1] as email_confirmed_at
  from auth.users u
  cross join target_email t
  where lower(btrim(u.email)) = t.email
),
target_profile as (
  select
    p.id,
    p.name,
    p.role,
    p.faculty_status,
    p.member_type
  from public.profiles p
  join auth_matches a on a.auth_id = p.id
),
admin_state as (
  select
    count(*) as admin_count,
    array_agg(p.id order by p.created_at) as admin_ids
  from public.profiles p
  where p.role = 'admin'
),
bootstrap_state as (
  select
    exists (select 1 from public.admin_bootstrap_state) as completed,
    (select s.completed_at from public.admin_bootstrap_state s limit 1) as completed_at,
    (select s.completed_by from public.admin_bootstrap_state s limit 1) as completed_by
),
schema_state as (
  select
    exists (
      select 1
      from pg_constraint c
      where c.conrelid = to_regclass('public.profiles')
        and c.conname = 'profiles_role_check'
        and pg_get_constraintdef(c.oid) like '%admin%'
    ) as role_allows_admin,
    coalesce((
      select pg_get_constraintdef(c.oid) like '%faculty%'
      from pg_constraint c
      where c.conrelid = to_regclass('public.profiles')
        and c.conname = 'profiles_member_type_check'
    ), true) as member_type_allows_faculty
)
select
  t.email as target_email,
  a.match_count as auth_matches,
  a.email_confirmed_at,
  p.id as profile_id,
  p.name as profile_name,
  p.role as profile_role,
  p.faculty_status,
  p.member_type,
  r.role_allows_admin,
  r.member_type_allows_faculty,
  (p.role = 'faculty' and p.faculty_status = 'approved') as approved_faculty,
  s.admin_count as existing_admin_count,
  s.admin_ids as existing_admin_ids,
  b.completed as bootstrap_completed,
  b.completed_at,
  b.completed_by,
  (
    a.match_count = 1
    and p.id is not null
    and p.role = 'faculty'
    and p.faculty_status = 'approved'
    and s.admin_count = 0
    and not b.completed
    and r.role_allows_admin
    and r.member_type_allows_faculty
  ) as can_bootstrap,
  array_remove(array[
    case when a.match_count <> 1
      then format('expected exactly one Auth account; found %s', a.match_count) end,
    case when p.id is null
      then 'no profile is linked to the Auth account' end,
    case when p.id is not null and p.role is distinct from 'faculty'
      then format('profile role is %s, expected faculty', p.role) end,
    case when p.id is not null and p.faculty_status is distinct from 'approved'
      then format('profile faculty_status is %s, expected approved', p.faculty_status) end,
    case when s.admin_count > 0
      then format('an administrator already exists (%s); bootstrap must not create a second', s.admin_count) end,
    case when b.completed
      then 'the one-time bootstrap marker is already present; the capability is disabled' end,
    case when not r.role_allows_admin
      then 'profiles_role_check does not allow role=admin; apply 2026102210_admin_role_check_alignment.sql' end,
    case when not r.member_type_allows_faculty
      then 'profiles_member_type_check does not allow member_type=faculty; apply 2026102201_member_identity_and_contacts.sql' end
  ], null) as blocking_reasons
from target_email t
cross join auth_matches a
left join target_profile p on true
cross join admin_state s
cross join bootstrap_state b
cross join schema_state r;
