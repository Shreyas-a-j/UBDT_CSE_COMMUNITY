-- =========================================================
-- UBDT CSE Community — Schema Verification Script
-- Run this in the Supabase SQL Editor after applying migrations.
-- It inspects tables, columns, constraints, FKs, policies,
-- triggers, indexes, and publications.
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
-- 2. All columns in key tables
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

\echo ''
\echo '--- 2b. faculty_applications columns ---'
select
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'faculty_applications'
order by ordinal_position;

\echo ''
\echo '--- 2c. connection_requests columns ---'
select
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'connection_requests'
order by ordinal_position;

\echo ''
\echo '--- 2d. conversations columns ---'
select
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'conversations'
order by ordinal_position;

\echo ''
\echo '--- 2e. messages columns ---'
select
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'messages'
order by ordinal_position;

-- ---------------------------------------------------------
-- 3. Column existence check for user_profiles legacy sync
-- ---------------------------------------------------------
\echo ''
\echo '--- 3. user_profiles existence check ---'
select
  table_name,
  column_name,
  data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'user_profiles'
order by ordinal_position;

-- ---------------------------------------------------------
-- 4. Foreign Key constraints
-- ---------------------------------------------------------
\echo ''
\echo '--- 4. Foreign Keys ---'
select
  tc.table_name as table_name,
  kcu.column_name,
  ccu.table_name AS foreign_table_name,
  ccu.column_name AS foreign_column_name,
  rc.update_rule,
  rc.delete_rule
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
-- 5. Check constraints (CK)
-- ---------------------------------------------------------
\echo ''
\echo '--- 5. Check Constraints ---'
select
  tc.table_name,
  tc.constraint_name,
  cc.check_clause
from information_schema.table_constraints tc
join information_schema.check_constraints cc
  on tc.constraint_name = cc.constraint_name
  and tc.table_schema = cc.constraint_schema
where tc.table_schema = 'public'
  and tc.constraint_type = 'CHECK'
order by tc.table_name;

-- ---------------------------------------------------------
-- 6. Unique constraints and indexes
-- ---------------------------------------------------------
\echo ''
\echo '--- 6. Unique constraints ---'
select
  tc.table_name,
  tc.constraint_name,
  kcu.column_name,
  tc.is_deferrable,
  tc.initially_deferred
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu
  on tc.constraint_name = kcu.constraint_name
  and tc.table_schema = kcu.table_schema
where tc.table_schema = 'public'
  and tc.constraint_type = 'UNIQUE'
order by tc.table_name;

\echo ''
\echo '--- 6b. All indexes ---'
select
  schemaname,
  tablename,
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
order by tablename, indexname;

\echo ''
\echo '--- 6c. Unique indexes (partial) ---'
select
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and indexdef ilike '%unique%'
  and (indexdef ilike '%where%' or indexdef ilike '%partial%')
order by tablename;

-- ---------------------------------------------------------
-- 7. RLS enabled
-- ---------------------------------------------------------
\echo ''
\echo '--- 7. RLS Enabled Tables ---'
select
  relname as table_name,
  relrowsecurity as rls_enabled,
  relforcerowsecurity as rls_forced
from pg_class
where relnamespace = 'public'::regnamespace
  and relkind = 'r'
  and relrowsecurity
order by relname;

-- ---------------------------------------------------------
-- 8. RLS Policies
-- ---------------------------------------------------------
\echo ''
\echo '--- 8. RLS Policies ---'
select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
order by tablename, policyname;

-- ---------------------------------------------------------
-- 9. Triggers
-- ---------------------------------------------------------
\echo ''
\echo '--- 9. Triggers ---'
select
  tgname as trigger_name,
  tgrelid::regclass as table_name,
  tgtype,
  tgenabled as enabled,
  'pg_trigger' as source
from pg_trigger
where NOT tgisinternal
  and tgnamespace = 'public'::regnamespace
order by tgrelid::regclass::text, tgname;

-- ---------------------------------------------------------
-- 10. Functions (security definer check)
-- ---------------------------------------------------------
\echo ''
\echo '--- 10. Functions (with security definer flag) ---'
select
  routine_name,
  routine_type,
  is_security_definer,
  routine_definition
from information_schema.routines
where routine_schema = 'public'
  and routine_type = 'FUNCTION'
order by routine_name;

-- ---------------------------------------------------------
-- 11. Function grants
-- ---------------------------------------------------------
\echo ''
\echo '--- 11. Function Grants ---'
select
  n.nspname as schema,
  p.proname as function_name,
  pg_get_function_arguments(p.oid) as arguments,
  pg_catalog.pg_get_userbyid(p.reprowner) as owner,
  ac.priv,
  ac.rolname as grantee
from pg_proc p
join pg_namespace n on p.pronamespace = n.oid
left join aclexplode(p.proacl) ac ON true
where n.nspname = 'public'
  and p.prokind = 'f'
order by n.nspname, p.proname;

-- ---------------------------------------------------------
-- 12. Realtime publication
-- ---------------------------------------------------------
\echo ''
\echo '--- 12. Realtime Publication ---'
select
  publication_name,
  table_name
from information_schema.view_table_usage
where table_schema = 'public'
  and table_name in ('messages', 'notifications', 'conversation_participants')
  and view_name = 'pg_publication'
order by table_name;

-- Alternative query for publication tables:
\echo ''
\echo '--- 12b. Publication Tables ---'
select
  p.pubname as publication_name,
  c.relname as table_name
from pg_publication p
join pg_publication_rel pr on p.oid = pr.prpubid
join pg_class c on pr.prrelid = c.oid
where p.pubname = 'supabase_realtime'
order by c.relname;

-- ---------------------------------------------------------
-- 13. Replica identity
-- ---------------------------------------------------------
\echo ''
\echo '--- 13. Replica Identity ---'
select
  c.relname as table_name,
  c.relreplident as replica_identity
from pg_class c
join pg_namespace n ON c.relnamespace = n.oid
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relreplident IN ('f', 'i', 'n', 'd')
  and c.relname IN ('messages', 'notifications', 'conversation_participants')
order by c.relname;

-- ---------------------------------------------------------
-- 14. Critical constraint checks
-- ---------------------------------------------------------

-- Verify connection_requests has participant immutability enforced (via trigger)
\echo ''
\echo '--- 14a. Connection transition trigger exists? ---'
select exists (
  select 1 from pg_trigger
  where tgname = 'trg_connection_transition'
  and tgnamespace = 'public'::regnamespace
) as has_connection_transition_trigger;

-- Verify faculty application transition trigger exists
\echo ''
\echo '--- 14b. Faculty application transition trigger exists? ---'
select exists (
  select 1 from pg_trigger
  where tgname = 'trg_faculty_application_transition'
  and tgnamespace = 'public'::regnamespace
) as has_faculty_transition_trigger;

-- Verify profile privilege protection trigger exists
\echo ''
\echo '--- 14c. Profile privilege protection trigger exists? ---'
select exists (
  select 1 from pg_trigger
  where tgname = 'trg_protect_profile_privileges'
  and tgnamespace = 'public'::regnamespace
) as has_profile_protection_trigger;

-- Verify updated_at trigger on profiles
\echo ''
\echo '--- 14d. Profiles updated_at trigger exists? ---'
select exists (
  select 1 from pg_trigger
  where tgname = 'trg_update_profiles_updated_at'
  and tgnamespace = 'public'::regnamespace
) as has_profiles_updated_at_trigger;

-- Verify direct_conversation_pairs table exists (for race-safe conversation creation)
\echo ''
\echo '--- 14e. direct_conversation_pairs table exists? ---'
select exists (
  select 1 from information_schema.tables
  where table_schema = 'public' and table_name = 'direct_conversation_pairs'
) as has_direct_conversation_pairs;

-- Verify no connection_pair (unconditional unique) constraint exists
\echo ''
\echo '--- 14f. Old connection_pair constraint (should be gone)? ---'
select exists (
  select 1 from information_schema.table_constraints
  where table_schema = 'public' and table_name = 'connection_requests'
  and constraint_name = 'connection_pair'
) as old_connection_pair_exists;

-- Verify connection_pending_pair partial unique index exists
\echo ''
\echo '--- 14g. connection_pending_pair index exists? ---'
select exists (
  select 1 from pg_indexes
  where schemaname = 'public' and indexname = 'connection_pending_pair'
) as has_pending_pair_index;

-- ---------------------------------------------------------
-- 15. Data sample (if any)
-- ---------------------------------------------------------
\echo ''
\echo '--- 15. Profile sample (non-sensitive columns only) ---'
select
  id,
  name,
  usn,
  year,
  branch,
  role,
  faculty_status,
  created_at
from public.profiles
order by created_at desc
limit 5;

\echo ''
\echo '=== VERIFICATION COMPLETE ==='
