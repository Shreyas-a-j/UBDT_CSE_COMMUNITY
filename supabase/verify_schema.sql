-- =========================================================
-- UBDT CSE Community — Schema Verification Script
--
-- Run this in the Supabase SQL Editor after applying all
-- migrations. It checks every aspect of the schema that
-- the application depends on.
--
-- Expected state after all migrations:
--   supabase/schema.sql (or migrations 1 + 2 + 3 in order)
-- =========================================================

\echo '=== SCHEMA VERIFICATION ==='
\echo ''

-- ---------------------------------------------------------
-- 1. Tables in public schema
-- ---------------------------------------------------------
\echo '--- 1. Tables ---'
select
  table_schema,
  table_name,
  table_type
from information_schema.tables
where table_schema = 'public'
order by table_name;

-- ---------------------------------------------------------
-- 2. All columns in profiles
-- ---------------------------------------------------------
\echo ''
\echo '--- 2. profiles columns ---'
select
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'profiles'
order by ordinal_position;

-- ---------------------------------------------------------
-- 3. Critical column existence checks
-- ---------------------------------------------------------
\echo ''
\echo '--- 3. Critical column existence ---'
select
  'designation' as column_name,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
    and column_name = 'designation'
  ) as exists_in_profiles;

select
  'employee_id' as column_name,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
    and column_name = 'employee_id'
  ) as exists_in_profiles;

select
  'role' as column_name,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
    and column_name = 'role'
  ) as exists_in_profiles;

select
  'faculty_status' as column_name,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
    and column_name = 'faculty_status'
  ) as exists_in_profiles;

select
  'expertise' as column_name,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
    and column_name = 'expertise'
  ) as exists_in_profiles;

select
  'updated_at' as column_name,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
    and column_name = 'updated_at'
  ) as exists_in_profiles;

-- ---------------------------------------------------------
-- 4. Duplicate USN diagnostic (students only)
-- ---------------------------------------------------------
\echo ''
\echo '--- 4. Duplicate USN diagnostic ---'
\echo '    If rows appear, these USNs are shared by multiple student profiles.'
\echo '    Remediation: choose one canonical profile, set others'' usn to NULL.'
select
  upper(btrim(usn)) as normalized_usn,
  count(*) as profile_count,
  array_agg(id::text) as profile_ids
from public.profiles
where role = 'student' and usn is not null and btrim(usn) <> ''
group by upper(btrim(usn))
having count(*) > 1;

-- ---------------------------------------------------------
-- 5. USN unique index check
-- ---------------------------------------------------------
\echo ''
\echo '--- 5. USN unique index ---'
select
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and indexname = 'profiles_student_usn_unique';

-- ---------------------------------------------------------
-- 6. Auth users missing profiles
-- ---------------------------------------------------------
\echo ''
\echo '--- 6. Auth users missing profiles ---'
\echo '    These users exist in auth but have no profile row.'
select
  u.id as auth_user_id,
  u.email,
  u.created_at as auth_created_at
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null
order by u.created_at;

-- ---------------------------------------------------------
-- 7. Profiles without Auth users
-- ---------------------------------------------------------
\echo ''
\echo '--- 7. Profiles without Auth users ---'
select
  p.id as profile_id,
  p.name,
  p.email,
  p.created_at as profile_created_at
from public.profiles p
left join auth.users u on u.id = p.id
where u.id is null
order by p.created_at;

-- ---------------------------------------------------------
-- 8. Role distribution
-- ---------------------------------------------------------
\echo ''
\echo '--- 8. Role distribution ---'
select
  role,
  faculty_status,
  count(*) as profile_count
from public.profiles
group by role, faculty_status
order by role, faculty_status;

-- ---------------------------------------------------------
-- 9. Null USN analysis (students only)
-- ---------------------------------------------------------
\echo ''
\echo '--- 9. Students with NULL USN ---'
select
  id,
  name,
  email,
  year,
  branch
from public.profiles
where role = 'student' and (usn is null or btrim(usn) = '')
order by created_at;

-- ---------------------------------------------------------
-- 10. RLS enabled tables
-- ---------------------------------------------------------
\echo ''
\echo '--- 10. RLS Enabled Tables ---'
select
  relname as table_name,
  relrowsecurity as rls_enabled
from pg_class
where relnamespace = 'public'::regnamespace
  and relkind = 'r'
  and relrowsecurity
order by relname;

-- ---------------------------------------------------------
-- 11. RLS policies on profiles
-- ---------------------------------------------------------
\echo ''
\echo '--- 11. Profile RLS Policies ---'
select
  policyname,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename = 'profiles'
order by policyname;

-- ---------------------------------------------------------
-- 12. Triggers
-- ---------------------------------------------------------
\echo ''
\echo '--- 12. Triggers ---'
select
  tgname as trigger_name,
  tgrelid::regclass as table_name,
  tgenabled as enabled
from pg_trigger
where NOT tgisinternal
  and tgnamespace = 'public'::regnamespace
order by tgrelid::regclass::text, tgname;

-- ---------------------------------------------------------
-- 13. Auth trigger exists?
-- ---------------------------------------------------------
\echo ''
\echo '--- 13. Auth user creation trigger ---'
select exists (
  select 1 from pg_trigger
  where tgname = 'on_auth_user_created'
    and tgrelid = 'auth.users'::regclass
) as has_auth_trigger;

-- ---------------------------------------------------------
-- 14. Profile protection trigger
-- ---------------------------------------------------------
\echo ''
\echo '--- 14. Profile privilege protection trigger ---'
select exists (
  select 1 from pg_trigger
  where tgname = 'trg_protect_profile_privileges'
    and tgnamespace = 'public'::regnamespace
) as has_profile_protection_trigger;

-- ---------------------------------------------------------
-- 15. USN uniqueness constraint (if present)
-- ---------------------------------------------------------
\echo ''
\echo '--- 15. USN constraints and indexes ---'
select
  indexname,
  indexdef,
  indexpred  -- predicate expression (partial index)
from pg_indexes
where schemaname = 'public'
  and indexdef ilike '%usn%'
order by indexname;

-- ---------------------------------------------------------
-- 16. Faculty application workflow check
-- ---------------------------------------------------------
\echo ''
\echo '--- 16. Faculty applications status ---'
select
  status,
  count(*) as application_count
from public.faculty_applications
group by status
order by status;

-- ---------------------------------------------------------
-- 17. Foreign keys
-- ---------------------------------------------------------
\echo ''
\echo '--- 17. Foreign Keys ---'
select
  tc.table_name,
  kcu.column_name,
  ccu.table_name as foreign_table_name,
  ccu.column_name as foreign_column_name
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu
  on tc.constraint_name = kcu.constraint_name
  and tc.table_schema = kcu.table_schema
join information_schema.referential_constraints rc
  on tc.constraint_name = rc.constraint_name
  and tc.table_schema = rc.constraint_schema
join information_schema.constraint_column_usage ccu
  on ccu.constraint_name = tc.constraint_name
  and ccu.table_schema = tc.table_schema
where tc.table_schema = 'public'
  and tc.constraint_type = 'FOREIGN KEY'
order by tc.table_name, kcu.ordinal_position;

-- ---------------------------------------------------------
-- 18. Unique constraints
-- ---------------------------------------------------------
\echo ''
\echo '--- 18. Unique constraints ---'
select
  tc.table_name,
  tc.constraint_name,
  kcu.column_name
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu
  on tc.constraint_name = kcu.constraint_name
  and tc.table_schema = kcu.table_schema
where tc.table_schema = 'public'
  and tc.constraint_type = 'UNIQUE'
order by tc.table_name;

-- ---------------------------------------------------------
-- 19. Data sample (non-sensitive)
-- ---------------------------------------------------------
\echo ''
\echo '--- 19. Profile sample ---'
select
  id,
  name,
  usn,
  year,
  branch,
  role,
  faculty_status,
  designation,
  created_at
from public.profiles
order by created_at desc
limit 10;

-- ---------------------------------------------------------
-- 20. Schema cache reload reminder
-- ---------------------------------------------------------
\echo ''
\echo '--- 20. Reminders ---'
\echo 'If any checks above fail, apply the missing migrations and run:'
\echo "  NOTIFY pgrst, 'reload schema';"
\echo 'Then re-run this verification script.'

\echo ''
\echo '=== VERIFICATION COMPLETE ==='
