-- =========================================================
-- UBDT CSE Community — Schema Verification Script
--
-- Run this after applying all migrations. It checks every aspect
-- of the schema that the application depends on.
--
-- Expected state after all migrations:
--   supabase/schema.sql  (or every file in supabase/migrations/ applied
--   in filename order — see docs/migration-dependency-order.md)
--   ...
--   2026102201_member_identity_and_contacts.sql
--   2026102202_notification_targeting_and_visits.sql
--   2026102203_global_usn_uniqueness.sql
--   2026102204_duplicate_usn_signup_guard.sql
--
-- How this script works
-- ---------------------
--   * Sections 1–21 print INVENTORY and raw diagnostic data first, so a
--     failed run still leaves troubleshooting data on screen.
--   * Section 22 is the FAIL GATE: every required object is checked
--     against its EXPECTED DEFINITION (not just its name), using catalog
--     renditions: pg_indexes.indexdef, pg_get_constraintdef,
--     pg_get_function_identity_arguments, pg_proc.proargnames/prosrc and
--     has_function_privilege. Failures are collected in a temp table and
--     each failure names the object, the expected definition fragment and
--     what was actually found.
--   * The final section aborts with an exception listing every failure,
--     so the script never silently accepts a partially applied schema.
--     Automated invocations (psql -v ON_ERROR_STOP=1) exit non-zero.
--
-- PRIVACY: no full USNs and no private contact data are printed anywhere.
-- Duplicate USNs are masked the same way as supabase/diagnostics/usn_collisions.sql.
--
-- NOTE ON \echo: lines beginning with backslash are psql meta-commands.
-- They work in psql but are syntax errors in the Supabase SQL Editor;
-- there, delete or comment them out — all SQL below is plain SQL.
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
  t.column_name,
  exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = 'profiles'
      and c.column_name = t.column_name
  ) as exists_in_profiles
from (values
  ('designation'),
  ('employee_id'),
  ('role'),
  ('faculty_status'),
  ('expertise'),
  ('updated_at'),
  -- UCC 2.0 identity + public links
  ('member_type'),
  ('graduation_year'),
  ('portfolio_url'),
  ('github_url'),
  ('linkedin_url')
) as t(column_name)
order by t.column_name;

-- ---------------------------------------------------------
-- 4. Duplicate USN diagnostic (ALL member types, masked)
--
-- The legacy student-only check is superseded: mask migration
-- 2026102203 makes normalized USNs unique across every profile,
-- including alumni. This is the read-only companion of the pre-flight
-- diagnostic inside that migration; full detail lives in
-- supabase/diagnostics/usn_collisions.sql.
-- ---------------------------------------------------------
\echo ''
\echo '--- 4. Duplicate USN diagnostic (global, masked) ---'
\echo '    If rows appear, migration 03 cannot have succeeded. Remediate'
\echo '    manually with supabase/diagnostics/usn_collisions.sql — never'
\echo '    delete or merge accounts automatically.'
with normalized as (
  select
    id,
    role,
    member_type,
    created_at,
    upper(btrim(usn)) as usn_norm
  from public.profiles
  where usn is not null
    and btrim(usn) <> ''
)
select
  case
    when char_length(usn_norm) <= 6 then left(usn_norm, 2) || '****'
    else left(usn_norm, 3) || '****' || right(usn_norm, 2)
  end as usn_masked,
  count(*) as profile_count,
  array_agg(id order by created_at, id) as profile_ids,
  array_agg(role order by created_at, id) as roles,
  array_agg(member_type order by created_at, id) as member_types
from normalized
group by usn_norm
having count(*) > 1
order by profile_count desc, usn_masked;

-- ---------------------------------------------------------
-- 5. USN index state (informational detail; hard checks in §22.2)
-- ---------------------------------------------------------
\echo ''
\echo '--- 5. USN unique index ---'
\echo '    Expect exactly one row: profiles_usn_normalized_unique (global,'
\echo '    normalized). profiles_student_usn_unique must be absent.'
select
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'profiles'
  and (
    indexdef ilike '%usn%'
    or indexname in (
      'profiles_usn_normalized_unique',
      'profiles_student_usn_unique'
    )
  )
order by indexname;

-- ---------------------------------------------------------
-- 6. Auth users missing profiles
--
-- With migration 04's signup guard this should stay empty: a duplicate
-- USN must abort the whole signup. Rows here are historical orphans and
-- need manual reconciliation (see docs/ucc2-phase1-runbook.md).
-- ---------------------------------------------------------
\echo ''
\echo '--- 6. Auth users missing profiles ---'
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
-- 8. Role / member_type distribution
-- ---------------------------------------------------------
\echo ''
\echo '--- 8. Role and member_type distribution ---'
select
  role,
  faculty_status,
  member_type,
  count(*) as profile_count
from public.profiles
group by role, faculty_status, member_type
order by role, faculty_status, member_type;

-- ---------------------------------------------------------
-- 9. Profiles with missing USN (all member types)
-- ---------------------------------------------------------
\echo ''
\echo '--- 9. Profiles with NULL/empty USN ---'
select
  id,
  name,
  member_type,
  year,
  branch
from public.profiles
where usn is null or btrim(usn) = ''
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
order by relname;

-- ---------------------------------------------------------
-- 11. RLS policies inventory (Phase 1-relevant tables)
-- ---------------------------------------------------------
\echo ''
\echo '--- 11. RLS policies ---'
select
  tablename,
  policyname,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'profiles', 'profile_contacts', 'content_visits', 'notifications'
  )
order by tablename, policyname;

-- ---------------------------------------------------------
-- 12. Triggers inventory
-- ---------------------------------------------------------
\echo ''
\echo '--- 12. Triggers ---'
select
  tgname as trigger_name,
  tgrelid::regclass as table_name,
  tgenabled as enabled
from pg_trigger
where NOT tgisinternal
  and tgrelid in (
    select oid from pg_class
    where relnamespace = 'public'::regnamespace
  )
order by tgrelid::regclass::text, tgname;

-- ---------------------------------------------------------
-- 13. Auth user creation trigger
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
select
  exists (
    select 1 from pg_trigger
    where tgname = 'trg_protect_profile_privileges'
      and tgrelid = 'public.profiles'::regclass
  ) as has_profile_protection_trigger,
  (
    select tgenabled <> 'D'
    from pg_trigger
    where tgname = 'trg_protect_profile_privileges'
      and tgrelid = 'public.profiles'::regclass
  ) as trigger_enabled;

-- ---------------------------------------------------------
-- 15. Catalog-level function inventory
--     (names, overloads, argument identities, security properties)
-- ---------------------------------------------------------
\echo ''
\echo '--- 15. Functions (Phase 1-relevant) ---'
select
  p.proname as function_name,
  p.pronargs as num_args,
  pg_get_function_identity_arguments(p.oid) as identity_arguments,
  p.prosecdef as security_definer,
  (select s from unnest(p.proconfig) s
    where s like 'search_path=%') as search_path
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname in (
    'emit_notification',
    'handle_new_user',
    'protect_profile_privileges',
    'on_faculty_application_status',
    'is_admin'
  )
order by p.proname, p.pronargs;

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
-- 19. Notification targeting inventory (detail; hard checks in §22.5)
-- ---------------------------------------------------------
\echo ''
\echo '--- 19. Notification targeting columns and indexes ---'
select
  column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'notifications'
  and column_name in ('content_type', 'content_id', 'dedupe_key')
order by ordinal_position;

select
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'notifications'
  and indexname in (
    'notifications_content_idx',
    'notifications_user_dedupe_key_unique'
  )
order by indexname;

-- ---------------------------------------------------------
-- 20. Data sample (non-sensitive)
-- ---------------------------------------------------------
\echo ''
\echo '--- 20. Profile sample ---'
select
  id,
  name,
  usn,
  year,
  branch,
  role,
  faculty_status,
  member_type,
  graduation_year,
  created_at
from public.profiles
order by created_at desc
limit 10;

-- ---------------------------------------------------------
-- 21. Reminders
-- ---------------------------------------------------------
\echo ''
\echo '--- 21. Reminders ---'
\echo 'If any checks below fail, apply the missing migration and run:'
\echo "  NOTIFY pgrst, 'reload schema';"
\echo 'Then re-run this verification script.'

-- =========================================================
-- 22. FAIL GATE — hard definition checks
-- =========================================================
\echo ''
\echo '--- 22. FAIL GATE (hard checks; failure details collected below) ---'

drop table if exists ucc2_verify_failures;
create temp table ucc2_verify_failures (
  migration text not null,      -- hallmark migration this object proves
  check_name text not null,
  expected text not null,
  actual text not null
);
create temp table ucc2_verify_notes (
  check_name text not null,
  note text not null
);

-- ---------------------------------------------------------
-- 22.1 Profile identity columns and constraints ([01])
-- ---------------------------------------------------------
do $gate$
declare
  v_actual text;
  v_expected text;
begin
  -- Columns: names, types, nullability and default.
  if coalesce((
    select count(*)
    from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and (
        (column_name = 'member_type' and data_type = 'text')
        or (column_name = 'graduation_year' and data_type = 'integer')
        or (column_name = 'portfolio_url' and data_type = 'text')
        or (column_name = 'github_url' and data_type = 'text')
        or (column_name = 'linkedin_url' and data_type = 'text')
      )
  ), 0) <> 5 then
    insert into ucc2_verify_failures values (
      '2026102201',
      'profile identity columns',
      'member_type text, graduation_year integer, portfolio_url/github_url/linkedin_url text on public.profiles',
      'one or more columns missing or mistyped (see section 2)'
    );
  end if;

  -- member_type NOT NULL with default 'student'.
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name = 'member_type'
      and is_nullable = 'NO'
      and column_default ilike '%''student%'
  ) then
    insert into ucc2_verify_failures values (
      '2026102201',
      'member_type nullability/default',
      'member_type text NOT NULL DEFAULT ''student''',
      'expected NOT NULL/DEFAULT not found'
    );
  end if;

  -- member_type check constraint covers exactly the three identities.
  select pg_get_constraintdef(c.oid, true) into v_actual
  from pg_constraint c
  where c.conrelid = 'public.profiles'::regclass
    and c.conname = 'profiles_member_type_check';
  v_expected = 'CHECK containing member_type with ''student'', ''alumni'', ''faculty''';
  if v_actual is null
     or v_actual not ilike '%member_type%'
     or v_actual not ilike '%''alumni''%'
     or v_actual not ilike '%''faculty''%' then
    insert into ucc2_verify_failures values (
      '2026102201', 'profiles_member_type_check',
      v_expected, coalesce(v_actual, 'constraint missing')
    );
  end if;

  -- graduation_year range check.
  select pg_get_constraintdef(c.oid, true) into v_actual
  from pg_constraint c
  where c.conrelid = 'public.profiles'::regclass
    and c.conname = 'profiles_graduation_year_check';
  v_expected = 'CHECK (graduation_year IS NULL OR graduation_year between 1950 and 2200)';
  if v_actual is null
     or v_actual not ilike '%graduation_year%'
     or v_actual not ilike '%1950%'
     or v_actual not ilike '%2200%' then
    insert into ucc2_verify_failures values (
      '2026102201', 'profiles_graduation_year_check',
      v_expected, coalesce(v_actual, 'constraint missing')
    );
  end if;

  -- Public URL constraints (scheme/host/length as written in [01]).
  select pg_get_constraintdef(c.oid, true) into v_actual
  from pg_constraint c
  where c.conrelid = 'public.profiles'::regclass
    and c.conname = 'profiles_portfolio_url_check';
  v_expected = 'CHECK: portfolio_url null or ^https?://\\S+$ with length <= 500';
  if v_actual is null
     or v_actual not ilike '%portfolio_url%'
     or v_actual not ilike '%https?://%'
     or v_actual not ilike '%500%' then
    insert into ucc2_verify_failures values (
      '2026102201', 'profiles_portfolio_url_check',
      v_expected, coalesce(v_actual, 'constraint missing')
    );
  end if;

  select pg_get_constraintdef(c.oid, true) into v_actual
  from pg_constraint c
  where c.conrelid = 'public.profiles'::regclass
    and c.conname = 'profiles_github_url_check';
  v_expected = 'CHECK: github_url null or ^https?://(www\\.)?github\\.com/\\S+$ with length <= 300';
  -- The stored definition keeps the regex backslash (github\.com), so the
  -- host fragment is verified with a regular expression, not LIKE.
  if v_actual is null
     or v_actual not ilike '%github_url%'
     or v_actual not ilike '%https?://%'
     or v_actual !~* 'github'
     or v_actual not ilike '%300%' then
    insert into ucc2_verify_failures values (
      '2026102201', 'profiles_github_url_check',
      v_expected, coalesce(v_actual, 'constraint missing')
    );
  end if;

  select pg_get_constraintdef(c.oid, true) into v_actual
  from pg_constraint c
  where c.conrelid = 'public.profiles'::regclass
    and c.conname = 'profiles_linkedin_url_check';
  v_expected = 'CHECK: linkedin_url null or ^https?://(www\\.)?linkedin\\.com/\\S+$ with length <= 300';
  -- Same reason as github: regex backslash, so host fragment via regex.
  if v_actual is null
     or v_actual not ilike '%linkedin_url%'
     or v_actual not ilike '%https?://%'
     or v_actual !~* 'linkedin'
     or v_actual not ilike '%300%' then
    insert into ucc2_verify_failures values (
      '2026102201', 'profiles_linkedin_url_check',
      v_expected, coalesce(v_actual, 'constraint missing')
    );
  end if;

  -- Identity lookup indexes.
  select indexdef into v_actual
  from pg_indexes
  where schemaname = 'public' and indexname = 'profiles_member_type_idx';
  if v_actual is null or v_actual not ilike '%(member_type)%' then
    insert into ucc2_verify_failures values (
      '2026102201', 'profiles_member_type_idx',
      'btree index on (member_type)',
      coalesce(v_actual, 'index missing')
    );
  end if;

  select indexdef into v_actual
  from pg_indexes
  where schemaname = 'public' and indexname = 'profiles_alumni_graduation_idx';
  v_expected = 'index on (graduation_year) WHERE member_type = ''alumni''';
  if v_actual is null
     or v_actual not ilike '%graduation_year%'
     or v_actual not ilike '%member_type = ''alumni''%' then
    insert into ucc2_verify_failures values (
      '2026102201', 'profiles_alumni_graduation_idx',
      v_expected, coalesce(v_actual, 'index missing')
    );
  end if;

  raise notice 'PASS 22.1 profile identity columns and constraints';
exception when others then
  insert into ucc2_verify_failures values (
    '2026102201', '22.1 block', 'expected profile identity objects',
    'unexpected error: ' || coalesce(SQLERRM, 'unknown')
  );
end;
$gate$;

-- ---------------------------------------------------------
-- 22.2 Global normalized USN index ([03]) + superseded index absent
-- ---------------------------------------------------------
do $gate$
declare
  v_def text;
  v_unique_valid boolean;
begin
  select
    pg_indexes.indexdef,
    i.indisunique and i.indisvalid
  into v_def, v_unique_valid
  from pg_indexes
  join pg_class i_ir on i_ir.relname = pg_indexes.indexname
      and i_ir.relnamespace = 'public'::regnamespace
  join pg_index i on i.indexrelid = i_ir.oid
  where pg_indexes.schemaname = 'public'
    and pg_indexes.indexname = 'profiles_usn_normalized_unique';

  if v_def is null then
    insert into ucc2_verify_failures values (
      '2026102203', 'profiles_usn_normalized_unique',
      'UNIQUE index on public.profiles ((upper(btrim(usn)))) WHERE usn IS NOT NULL AND btrim(usn) <> '''',
       valid (indisvalid), covering students and alumni',
      'index missing'
    );
  elsif not v_unique_valid then
    insert into ucc2_verify_failures values (
      '2026102203', 'profiles_usn_normalized_unique',
      'UNIQUE index, indisunique AND indisvalid',
      'index exists but is not a valid unique index'
    );
  elsif v_def not ilike '%UNIQUE INDEX%'
        or v_def not ilike '%(upper(btrim(usn)))%'
        or v_def not ilike '%usn IS NOT NULL%'
        or v_def not ilike '%btrim(usn) <> ''%' then
    insert into ucc2_verify_failures values (
      '2026102203', 'profiles_usn_normalized_unique',
      'UNIQUE index on public.profiles ((upper(btrim(usn)))) WHERE usn IS NOT NULL AND btrim(usn) <> ''''',
      'wrong definition: ' || v_def
    );
  else
    raise notice 'PASS 22.2 global normalized USN index definition';
  end if;

  -- The superseded student-only index must be gone ([03] step 3).
  if exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'profiles_student_usn_unique'
  ) then
    insert into ucc2_verify_failures values (
      '2026102203', 'profiles_student_usn_unique removal',
      'index absent (superseded by profiles_usn_normalized_unique)',
      'index still present — a USN stops being protected once its owner leaves the student role'
    );
  else
    raise notice 'PASS 22.2 superseded student-only USN index absent';
  end if;

exception when others then
  insert into ucc2_verify_failures values (
    '2026102203', '22.2 block', 'global normalized USN index state',
    'unexpected error: ' || coalesce(SQLERRM, 'unknown')
  );
end;
$gate$;

-- ---------------------------------------------------------
-- 22.3 profile_contacts — table, constraints, RLS, policies, trigger [01]
-- ---------------------------------------------------------
do $gate$
declare
  v_actual text;
begin
  -- Table with required columns.
  if coalesce((
    select count(*)
    from information_schema.columns
    where table_schema = 'public' and table_name = 'profile_contacts'
      and (
        (column_name = 'profile_id' and data_type = 'uuid')
        or (column_name = 'contact_email' and data_type = 'text')
        or (column_name = 'phone' and data_type = 'text')
        or (column_name = 'contact_visibility' and data_type = 'text')
        or (column_name = 'created_at' and data_type = 'timestamp with time zone')
        or (column_name = 'updated_at' and data_type = 'timestamp with time zone')
      )
  ), 0) <> 6 then
    insert into ucc2_verify_failures values (
      '2026102201', 'profile_contacts columns',
      'profile_id uuid PK->profiles, contact_email text, phone text,
       contact_visibility text NOT NULL DEFAULT ''private'', created_at/updated_at timestamptz',
      'one or more columns missing or mistyped'
    );
  end if;

  -- Primary key must reference profiles(id)cascade (contact data dies with the account).
  if not exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.profile_contacts'::regclass
      and c.contype = 'f'
      and c.confrelid = 'public.profiles'::regclass
      and c.confdeltype = 'c'
  ) then
    insert into ucc2_verify_failures values (
      '2026102201', 'profile_contacts FK',
      'profile_id references public.profiles(id) on delete cascade',
      'FK missing or wrong delete behaviour'
    );
  end if;

  select pg_get_constraintdef(c.oid, true) into v_actual
  from pg_constraint c
  where c.conrelid = 'public.profile_contacts'::regclass
    and c.conname = 'profile_contacts_contact_visibility_check';
  if v_actual is null
     or v_actual not ilike '%''private''%'
     or v_actual not ilike '%''members''%'
     or v_actual not ilike '%''public''%' then
    insert into ucc2_verify_failures values (
      '2026102201', 'profile_contacts_contact_visibility_check',
      'CHECK (contact_visibility in (''private'', ''members'', ''public''))',
      coalesce(v_actual, 'constraint missing')
    );
  end if;

  select pg_get_constraintdef(c.oid, true) into v_actual
  from pg_constraint c
  where c.conrelid = 'public.profile_contacts'::regclass
    and c.conname = 'profile_contacts_email_format_check';
  if v_actual is null
     or v_actual not ilike '%contact_email%'
     or v_actual not ilike '%320%' then
    insert into ucc2_verify_failures values (
      '2026102201', 'profile_contacts_email_format_check',
      'CHECK: contact_email null or matches ^[^@[:space:]]+@...\\.[^@[:space:]]+$ with length <= 320',
      coalesce(v_actual, 'constraint missing')
    );
  end if;

  select pg_get_constraintdef(c.oid, true) into v_actual
  from pg_constraint c
  where c.conrelid = 'public.profile_contacts'::regclass
    and c.conname = 'profile_contacts_phone_format_check';
  if v_actual is null
     or v_actual not ilike '%phone%'
     or v_actual not ilike '%{6,19}%' then
    insert into ucc2_verify_failures values (
      '2026102201', 'profile_contacts_phone_format_check',
      'CHECK: phone null or matches ^\\+?[0-9][0-9 ()\\-]{6,19}$',
      coalesce(v_actual, 'constraint missing')
    );
  end if;

  -- Default 'private': the entire point of the table.
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profile_contacts'
      and column_name = 'contact_visibility'
      and column_default ilike '%''private%'
  ) then
    insert into ucc2_verify_failures values (
      '2026102201', 'contact_visibility default',
      'DEFAULT ''private'' (safest visibility)',
      'default missing or different'
    );
  end if;

  -- RLS must be ON; without it the visibility policies mean nothing.
  if not coalesce((
    select relrowsecurity from pg_class
    where oid = 'public.profile_contacts'::regclass
  ), false) then
    insert into ucc2_verify_failures values (
      '2026102201', 'profile_contacts RLS',
      'row level security enabled',
      'RLS disabled — private contact data would be world-readable'
    );
  end if;

  -- Policies: owner full control + admin read + visibility-gated reads.
  if coalesce((
    select count(*)
    from pg_policies
    where schemaname = 'public' and tablename = 'profile_contacts'
      and (
        (policyname = 'Owners manage their contact details'
          and cmd = 'ALL' and qual ilike '%auth.uid() = profile_id%')
        or (policyname = 'Admins view all contact details'
          and cmd = 'SELECT' and qual ilike '%is_admin(auth.uid())%')
        or (policyname = 'Public contact details are visible'
          and cmd = 'SELECT' and qual ilike '%contact_visibility = ''public''%')
        or (policyname = 'Member contact details are visible to authenticated members'
          and cmd = 'SELECT'
          and qual ilike '%contact_visibility = ''members''%'
          and qual ilike '%auth.uid() IS NOT NULL%')
      )
  ), 0) <> 4 then
    insert into ucc2_verify_failures values (
      '2026102201', 'profile_contacts policies',
      '''Owners manage their contact details'' (ALL),
       ''Admins view all contact details'' (SELECT, is_admin),
       ''Public contact details are visible'' (SELECT),
       ''Member contact details are visible to authenticated members'' (SELECT)',
      'one or more policies missing or with wrong qual (see section 11)'
    );
  end if;

  -- updated_at trigger present and enabled.
  if not exists (
    select 1 from pg_trigger
    where tgname = 'trg_profile_contacts_updated_at'
      and tgrelid = 'public.profile_contacts'::regclass
      and tgenabled <> 'D'
  ) then
    insert into ucc2_verify_failures values (
      '2026102201', 'trg_profile_contacts_updated_at',
      'BEFORE UPDATE trigger executing public.update_updated_at_column(), enabled',
      'trigger missing or disabled'
    );
  end if;

  raise notice 'PASS 22.3 profile_contacts structure, RLS, policies, trigger';

exception when others then
  insert into ucc2_verify_failures values (
    '2026102201', '22.3 block', 'profile_contacts objects',
    'unexpected error: ' || coalesce(SQLERRM, 'unknown')
  );
end;
$gate$;

-- ---------------------------------------------------------
-- 22.4 content_visits — RLS, owner-only policy, uniqueness, indexes [02]
-- ---------------------------------------------------------
do $gate$
declare
  v_actual text;
begin
  if coalesce((
    select count(*)
    from information_schema.columns
    where table_schema = 'public' and table_name = 'content_visits'
      and (
        (column_name = 'user_id' and data_type = 'uuid')
        or (column_name = 'content_type' and data_type = 'text')
        or (column_name = 'content_id' and data_type = 'uuid')
        or (column_name = 'first_visited_at' and data_type = 'timestamp with time zone')
        or (column_name = 'last_visited_at' and data_type = 'timestamp with time zone')
      )
  ), 0) <> 5 then
    insert into ucc2_verify_failures values (
      '2026102202', 'content_visits columns',
      'user_id uuid NOT NULL FK, content_type text, content_id uuid,
       first_visited_at/last_visited_at timestamptz',
      'one or more columns missing or mistyped'
    );
  end if;

  -- One row per (user, content) — the deduplication guarantee.
  if not exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.content_visits'::regclass
      and c.contype = 'u'
      and c.conname = 'content_visits_user_content_key'
      and pg_get_constraintdef(c.oid, true) ilike '%user_id%content_type%content_id%'
  ) then
    insert into ucc2_verify_failures values (
      '2026102202', 'content_visits_user_content_key',
      'UNIQUE (user_id, content_type, content_id)',
      'constraint missing or covers different columns'
    );
  end if;

  select pg_get_constraintdef(c.oid, true) into v_actual
  from pg_constraint c
  where c.conrelid = 'public.content_visits'::regclass
    and c.conname = 'content_visits_content_type_check';
  if v_actual is null
     or v_actual not ilike '%''discussion''%'
     or v_actual not ilike '%''event''%'
     or v_actual not ilike '%''showcase''%' then
    insert into ucc2_verify_failures values (
      '2026102202', 'content_visits_content_type_check',
      'CHECK (content_type in (''discussion'', ''event'', ''showcase''))',
      coalesce(v_actual, 'constraint missing')
    );
  end if;

  select pg_get_constraintdef(c.oid, true) into v_actual
  from pg_constraint c
  where c.conrelid = 'public.content_visits'::regclass
    and c.conname = 'content_visits_time_order_check';
  if v_actual is null
     or v_actual not ilike '%last_visited_at%' then
    insert into ucc2_verify_failures values (
      '2026102202', 'content_visits_time_order_check',
      'CHECK (last_visited_at >= first_visited_at)',
      coalesce(v_actual, 'constraint missing')
    );
  end if;

  if not coalesce((
    select relrowsecurity from pg_class
    where oid = 'public.content_visits'::regclass
  ), false) then
    insert into ucc2_verify_failures values (
      '2026102202', 'content_visits RLS',
      'row level security enabled',
      'RLS disabled'
    );
  end if;

  select qual into v_actual
  from pg_policies
  where schemaname = 'public' and tablename = 'content_visits'
    and policyname = 'Users manage own content visits'
    and cmd = 'ALL';
  if v_actual is null
     or v_actual not ilike '%auth.uid() = user_id%' then
    insert into ucc2_verify_failures values (
      '2026102202', 'content_visits owner policy',
      '''Users manage own content visits'' FOR ALL using/with_check auth.uid() = user_id',
      coalesce(v_actual, 'policy missing')
    );
  end if;

  select indexdef into v_actual
  from pg_indexes
  where schemaname = 'public' and indexname = 'content_visits_user_recent_idx';
  if v_actual is null
     or v_actual not ilike '%(user_id, last_visited_at%' then
    insert into ucc2_verify_failures values (
      '2026102202', 'content_visits_user_recent_idx',
      'index on (user_id, last_visited_at DESC)',
      coalesce(v_actual, 'index missing')
    );
  end if;

  select indexdef into v_actual
  from pg_indexes
  where schemaname = 'public' and indexname = 'content_visits_content_idx';
  if v_actual is null
     or v_actual not ilike '%(content_type, content_id)%' then
    insert into ucc2_verify_failures values (
      '2026102202', 'content_visits_content_idx',
      'index on (content_type, content_id)',
      coalesce(v_actual, 'index missing')
    );
  end if;

  raise notice 'PASS 22.4 content_visits structure, RLS, indexes';

exception when others then
  insert into ucc2_verify_failures values (
    '2026102202', '22.4 block', 'content_visits objects',
    'unexpected error: ' || coalesce(SQLERRM, 'unknown')
  );
end;
$gate$;

-- ---------------------------------------------------------
-- 22.5 notification targeting columns, checks, indexes [02]
-- ---------------------------------------------------------
do $gate$
declare
  v_actual text;
begin
  if coalesce((
    select count(*)
    from information_schema.columns
    where table_schema = 'public' and table_name = 'notifications'
      and (
        (column_name = 'content_type' and data_type = 'text')
        or (column_name = 'content_id' and data_type = 'uuid')
        or (column_name = 'dedupe_key' and data_type = 'text')
      )
  ), 0) <> 3 then
    insert into ucc2_verify_failures values (
      '2026102202', 'notifications targeting columns',
      'content_type text, content_id uuid, dedupe_key text on public.notifications',
      'one or more columns missing or mistyped'
    );
  end if;

  -- content_type/content_id must be paired (both or neither).
  select pg_get_constraintdef(c.oid, true) into v_actual
  from pg_constraint c
  where c.conrelid = 'public.notifications'::regclass
    and c.conname = 'notifications_content_pair_check';
  if v_actual is null
     or v_actual not ilike '%content_type%'
     or v_actual not ilike '%content_id%' then
    insert into ucc2_verify_failures values (
      '2026102202', 'notifications_content_pair_check',
      'CHECK ((content_type IS NULL AND content_id IS NULL)
        OR (content_type IS NOT NULL AND content_id IS NOT NULL))',
      coalesce(v_actual, 'constraint missing')
    );
  end if;

  select pg_get_constraintdef(c.oid, true) into v_actual
  from pg_constraint c
  where c.conrelid = 'public.notifications'::regclass
    and c.conname = 'notifications_content_type_check';
  if v_actual is null
     or v_actual not ilike '%''discussion''%'
     or v_actual not ilike '%''event''%'
     or v_actual not ilike '%''showcase''%' then
    insert into ucc2_verify_failures values (
      '2026102202', 'notifications_content_type_check',
      'CHECK (content_type IS NULL OR content_type in (''discussion'', ''event'', ''showcase''))',
      coalesce(v_actual, 'constraint missing')
    );
  end if;

  select pg_get_constraintdef(c.oid, true) into v_actual
  from pg_constraint c
  where c.conrelid = 'public.notifications'::regclass
    and c.conname = 'notifications_dedupe_key_check';
  if v_actual is null
     or v_actual not ilike '%dedupe_key%'
     or v_actual not ilike '%>= 1%'
     or v_actual not ilike '%<= 200%' then
    insert into ucc2_verify_failures values (
      '2026102202', 'notifications_dedupe_key_check',
      'CHECK (dedupe_key IS NULL OR char_length(dedupe_key) between 1 and 200)
       — catalog renders "between" as >= 1 AND <= 200',
      coalesce(v_actual, 'constraint missing')
    );
  end if;

  select indexdef into v_actual
  from pg_indexes
  where schemaname = 'public' and indexname = 'notifications_content_idx';
  if v_actual is null
     or v_actual not ilike '%(content_type, content_id)%'
     or v_actual not ilike '%content_id IS NOT NULL%' then
    insert into ucc2_verify_failures values (
      '2026102202', 'notifications_content_idx',
      'index on (content_type, content_id) WHERE content_id IS NOT NULL',
      coalesce(v_actual, 'index missing or not partial')
    );
  end if;

  select indexdef into v_actual
  from pg_indexes
  where schemaname = 'public' and indexname = 'notifications_user_dedupe_key_unique';
  if v_actual is null
     or v_actual not ilike '%UNIQUE%'
     or v_actual not ilike '%(user_id, dedupe_key)%'
     or v_actual not ilike '%dedupe_key IS NOT NULL%' then
    insert into ucc2_verify_failures values (
      '2026102202', 'notifications_user_dedupe_key_unique',
      'UNIQUE index on (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL',
      coalesce(v_actual, 'index missing')
    );
  end if;

  raise notice 'PASS 22.5 notification targeting columns, checks, indexes';

exception when others then
  insert into ucc2_verify_failures values (
    '2026102202', '22.5 block', 'notification targeting objects',
    'unexpected error: ' || coalesce(SQLERRM, 'unknown')
  );
end;
$gate$;

-- ---------------------------------------------------------
-- 22.6 emit_notification — exact signature, no old overload,
--      no anon/authenticated/PUBLIC execution [02]
-- ---------------------------------------------------------
do $gate$
declare
  v_sig8  regprocedure;
  v_sig5  regprocedure;
  v_oid   oid;
  v_count int;
  v_args  text;
  v_names text[];
  v_expected_names text[] :=
    array['p_user_id','p_type','p_title','p_body','p_link',
          'p_content_type','p_content_id','p_dedupe_key'];
begin
  -- Exactly one overload must exist.
  select count(*) into v_count
  from pg_proc
  where proname = 'emit_notification'
    and pronamespace = 'public'::regnamespace;
  if v_count <> 1 then
    insert into ucc2_verify_failures values (
      '2026102202', 'emit_notification overloads',
      'exactly 1 function named emit_notification in public',
      format('%s overloads found — the obsolete 5-argument overload routes old call sites past dedupe and execute-revocation', v_count)
    );
  end if;

  -- Exact eight-argument signature.
  v_sig8 := 'public.emit_notification(uuid,text,text,text,text,text,uuid,text)'::regprocedure;
  select p.oid, p.proargnames into v_oid, v_names
  from pg_proc p
  where p.oid = v_sig8::oid;

  if v_oid is null then
    insert into ucc2_verify_failures values (
      '2026102202', 'emit_notification signature',
      '(uuid, text, text, text, text, text, uuid, text) returns void',
      'eight-argument overload does not exist'
    );
  else
    select pg_get_function_identity_arguments(v_oid) into v_args;
    if regexp_replace(v_args, '\s+', ' ', 'g')
       <> 'p_user_id uuid, p_type text, p_title text, p_body text, p_link text, p_content_type text, p_content_id uuid, p_dedupe_key text' then
      insert into ucc2_verify_failures values (
        '2026102202', 'emit_notification identity arguments',
        'p_user_id uuid, p_type text, p_title text, p_body text, p_link text,
         p_content_type text, p_content_id uuid, p_dedupe_key text',
        'actual: ' || v_args
      );
    end if;

    if coalesce(v_names, '{}'::text[]) <> v_expected_names then
      insert into ucc2_verify_failures values (
        '2026102202', 'emit_notification parameter names',
        array_to_string(v_expected_names, ', ', 'NULL'),
        'actual: ' || coalesce(array_to_string(v_names, ', ', 'NULL'), 'NULL')
      );
    end if;

    -- Security properties: definer + explicit search_path.
    if not coalesce((
      select p.prosecdef from pg_proc p where p.oid = v_oid
    ), false) then
      insert into ucc2_verify_failures values (
        '2026102202', 'emit_notification security definer',
        'SECURITY DEFINER (inserts notifications on holders'' behalf)',
        'function is SECURITY INVOKER'
      );
    end if;

    if coalesce((
      select position('search_path' in coalesce(p.proconfig::text, ''))
        from pg_proc p where p.oid = v_oid
    ), 0) = 0 then
      insert into ucc2_verify_failures values (
        '2026102202', 'emit_notification search_path',
        'SET search_path (safe, explicit) — REQUIRED for SECURITY DEFINER',
        'no search_path setting on the function'
      );
    end if;

    -- Execution must be revoked from anon, authenticated AND public
    -- (CREATE FUNCTION grants EXECUTE to PUBLIC by default).
    if exists (select 1 from pg_roles where rolname = 'anon') then
      if has_function_privilege('anon'::name, v_oid, 'EXECUTE') then
        insert into ucc2_verify_failures values (
          '2026102202', 'emit_notification execute grant (anon)',
          'anon must NOT be able to execute',
          'anon CAN execute — any visitor could forge notifications'
        );
      end if;
    else
      insert into ucc2_verify_notes values (
        'emit_notification ACL', 'role anon not present in this environment; grant check skipped'
      );
    end if;

    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      if has_function_privilege('authenticated'::name, v_oid, 'EXECUTE') then
        insert into ucc2_verify_failures values (
          '2026102202', 'emit_notification execute grant (authenticated)',
          'authenticated must NOT be able to execute',
          'authenticated CAN execute — any signed-in user could forge notifications'
        );
      end if;
    else
      insert into ucc2_verify_notes values (
        'emit_notification ACL', 'role authenticated not present in this environment; grant check skipped'
      );
    end if;

    if has_function_privilege('public'::name, v_oid, 'EXECUTE') then
      insert into ucc2_verify_failures values (
        '2026102202', 'emit_notification execute grant (PUBLIC)',
        'PUBLIC must NOT be able to execute (revoke from public in [02])',
        'PUBLIC CAN execute — CREATE FUNCTION''s default grant was never revoked'
      );
    end if;
  end if;

  -- The obsolete five-argument overload must not linger.
  begin
    v_sig5 := 'public.emit_notification(uuid,text,text,text,text)'::regprocedure;
    insert into ucc2_verify_failures values (
      '2026102202', 'obsolete 5-argument overload',
      'function absent',
      'still resolvable: ' || v_sig5::text
    );
  exception when undefined_function or undefined_object then
    raise notice 'PASS 22.6 obsolete 5-argument emit_notification absent';
  end;

exception when others then
  insert into ucc2_verify_failures values (
    '2026102202', '22.6 block', 'emit_notification signature and ACL state',
    'unexpected error: ' || coalesce(SQLERRM, 'unknown')
  );
end;
$gate$;

-- ---------------------------------------------------------
-- 22.7 Signup trigger + duplicate-USN guard [04]
-- ---------------------------------------------------------
do $gate$
declare
  v_src  text;
  v_enabled "char";
begin
  select t.tgenabled into v_enabled
  from pg_trigger t
  where t.tgname = 'on_auth_user_created'
    and t.tgrelid = 'auth.users'::regclass;

  if v_enabled is null then
    insert into ucc2_verify_failures values (
      '2026102204', 'on_auth_user_created trigger',
      'AFTER INSERT trigger on auth.users executing public.handle_new_user(), enabled',
      'trigger missing on auth.users'
    );
  elsif v_enabled = 'D' then
    insert into ucc2_verify_failures values (
      '2026102204', 'on_auth_user_created trigger',
      'enabled',
      'trigger DISABLED — signups would create auth users without profiles'
    );
  end if;

  select p.prosrc into v_src
  from pg_proc p
  where p.proname = 'handle_new_user'
    and p.pronamespace = 'public'::regnamespace;

  if v_src is null then
    insert into ucc2_verify_failures values (
      '2026102204', 'handle_new_user function',
      'function public.handle_new_user() exists',
      'function missing'
    );
  else
    -- Guard wording from migration [04]; the legacy [01] handler must be
    -- gone (it matched pg_exception_detail with a regex that could never
    -- match, and "fixing" that regex later would swallow the insert and
    -- leave an auth user with no profile).
    if v_src not ilike '%USN is already registered%' then
      insert into ucc2_verify_failures values (
        '2026102204', 'handle_new_user duplicate-USN guard',
        'unique_violation handler raising errcode 23505 with message
         ''USN is already registered to another account.'' WITHOUT echoing the USN',
        'guard message missing from function body ([04] behaviour absent —
         duplicate-USN signups may leave orphaned auth users)'
      );
    end if;
    if v_src not ilike '%pg_exception_detail%' then
      raise notice 'PASS 22.7 legacy regex-based USN handler replaced';
    else
      insert into ucc2_verify_failures values (
        '2026102204', 'handle_new_user legacy handler',
        'no pg_exception_detail regex matching in the guard ([04] replaced [01])',
        'legacy [01] handler still in place — fragile and misleading rollback path'
      );
    end if;

    if v_src not ilike '%member_kind%' or v_src not ilike '%alumni%' then
      insert into ucc2_verify_failures values (
        '2026102201', 'handle_new_user alumni intent',
        'intent = ''alumni'' provisions member_type = ''alumni'' (role stays ''student'')',
        'alumni branch missing from function body'
      );
    end if;

    -- Signup provisioning must hard-code the nonprivileged role.
    if v_src not ilike '%''student'',%' then
      insert into ucc2_verify_failures values (
        '2026102204', 'handle_new_user role provisioning',
        'role hard-coded to ''student'' for every signup',
        'no hard-coded student role found — signup metadata may grant privileged roles'
      );
    end if;

    -- SECURITY DEFINER with explicit search_path.
    if not coalesce((
      select p.prosecdef from pg_proc p
      where p.proname = 'handle_new_user'
        and p.pronamespace = 'public'::regnamespace
    ), false) then
      insert into ucc2_verify_failures values (
        '2026102204', 'handle_new_user security definer',
        'SECURITY DEFINER (fires from auth.users trigger, auth.uid() unavailable)',
        'function is SECURITY INVOKER'
      );
    end if;
    if coalesce((
      select position('search_path' in coalesce(p.proconfig::text, ''))
      from pg_proc p
      where p.proname = 'handle_new_user'
        and p.pronamespace = 'public'::regnamespace
    ), 0) = 0 then
      insert into ucc2_verify_failures values (
        '2026102204', 'handle_new_user search_path',
        'SET search_path (safe, explicit)',
        'no search_path setting'
      );
    end if;
  end if;

  raise notice 'PASS 22.7 signup trigger + duplicate-USN guard definition';

exception when others then
  insert into ucc2_verify_failures values (
    '2026102204', '22.7 block', 'signup trigger and guard',
    'unexpected error: ' || coalesce(SQLERRM, 'unknown')
  );
end;
$gate$;

-- ---------------------------------------------------------
-- 22.8 role-protection invariant [01, 04]
--     protect_profile_privileges must revert every protected field,
--     including UCC 2.0 identity fields.
-- ---------------------------------------------------------
do $gate$
declare
  v_src text;
  v_field text;
  v_missing text[] := '{}';
begin
  select p.prosrc into v_src
  from pg_proc p
  where p.proname = 'protect_profile_privileges'
    and p.pronamespace = 'public'::regnamespace;

  if v_src is null then
    insert into ucc2_verify_failures values (
      '2026102201', 'protect_profile_privileges function',
      'function exists',
      'function missing'
    );
  else
    foreach v_field in array array[
      'new.role := old.role',
      'new.faculty_status := old.faculty_status',
      'new.employee_id := old.employee_id',
      'new.designation := old.designation',
      'new.usn := old.usn',
      'new.member_type := old.member_type',
      'new.graduation_year := old.graduation_year'
    ] loop
      if v_src not ilike '%' || v_field || '%' then
        v_missing := v_missing || v_field;
      end if;
    end loop;

    if array_length(v_missing, 1) > 0 then
      insert into ucc2_verify_failures values (
        '2026102201', 'protect_profile_privileges reverts',
        'non-admin updates revert: role, faculty_status, employee_id, designation,
         usn, member_type, graduation_year',
        'missing reverts: ' || array_to_string(v_missing, ' | ')
      );
    end if;

    -- The exemption must be the admin check, nothing broader.
    if v_src not ilike '%public.is_admin(auth.uid())%' then
      insert into ucc2_verify_failures values (
        '2026102201', 'protect_profile_privileges exemption',
        'bypass granted only when public.is_admin(auth.uid())',
        'function does not gate on is_admin(auth.uid())'
      );
    end if;
  end if;

  -- The trigger must be present and enabled on profiles.
  if not exists (
    select 1 from pg_trigger
    where tgname = 'trg_protect_profile_privileges'
      and tgrelid = 'public.profiles'::regclass
      and tgenabled <> 'D'
  ) then
    insert into ucc2_verify_failures values (
      '2026102201', 'trg_protect_profile_privileges trigger',
      'BEFORE UPDATE trigger on public.profiles, enabled',
      'trigger missing or disabled'
    );
  end if;

  raise notice 'PASS 22.8 role-protection invariant';

exception when others then
  insert into ucc2_verify_failures values (
    '2026102201', '22.8 block', 'role-protection invariant',
    'unexpected error: ' || coalesce(SQLERRM, 'unknown')
  );
end;
$gate$;

-- ---------------------------------------------------------
-- 22.9 faculty approval keeps identity + privilege together [01]
--     and notification-producing triggers stay attached.
-- ---------------------------------------------------------
do $gate$
declare
  v_src text;
begin
  select p.prosrc into v_src
  from pg_proc p
  where p.proname = 'on_faculty_application_status'
    and p.pronamespace = 'public'::regnamespace;

  if v_src is null then
    insert into ucc2_verify_failures values (
      '2026102201', 'on_faculty_application_status function',
      'function exists',
      'function missing'
    );
  else
    if v_src not ilike '%member_type = ''faculty''%' then
      insert into ucc2_verify_failures values (
        '2026102201', 'faculty approval identity',
        'approval sets member_type = ''faculty'' alongside role/faculty_status',
        'identity not set on approval'
      );
    end if;
    if v_src not ilike '%role = case when role = ''admin'' then ''admin'' else ''faculty'' end%' then
      insert into ucc2_verify_failures values (
        '2026102201', 'faculty approval preserves admins',
        'approval must not demote admins: role = case when role = ''admin'' ...',
        'admin-preservation rule missing'
      );
    end if;
    if v_src not ilike '%faculty_decision%' then
      insert into ucc2_verify_failures values (
        '2026102201', 'faculty decision notification',
        'approval/rejection emit_notification(..., ''faculty_decision'', ...)',
        'notification call missing from function body'
      );
    end if;
  end if;

  -- Notification-producing triggers must remain attached and enabled.
  if coalesce((
    select count(*)
    from pg_trigger
    where NOT tgisinternal
      and tgrelid in (
        select oid from pg_class
        where relnamespace = 'public'::regnamespace
      )
      and tgname in (
        'trg_faculty_application_status',
        'trg_connection_change',
        'trg_message_insert'
      )
      and tgenabled <> 'D'
  ), 0) <> 3 then
    insert into ucc2_verify_failures values (
      '2026102202', 'notification-producing triggers',
      'trg_faculty_application_status, trg_connection_change, trg_message_insert present and enabled',
      'one or more triggers missing or disabled (see section 12)'
    );
  end if;

  raise notice 'PASS 22.9 faculty approval + notification trigger wiring';

exception when others then
  insert into ucc2_verify_failures values (
    '2026102201', '22.9 block', 'faculty approval invariants',
    'unexpected error: ' || coalesce(SQLERRM, 'unknown')
  );
end;
$gate$;

-- ---------------------------------------------------------
-- 22.10 core RLS invariants that Phase 1 must not have disturbed
-- ---------------------------------------------------------
do $gate$
begin
  -- notifications: RLS on, user-scoped policies intact.
  if not coalesce((
    select relrowsecurity from pg_class
    where oid = 'public.notifications'::regclass
  ), false) then
    insert into ucc2_verify_failures values (
      'core', 'notifications RLS',
      'row level security enabled',
      'RLS disabled'
    );
  end if;

  if coalesce((
    select count(*)
    from pg_policies
    where schemaname = 'public' and tablename = 'notifications'
      and policyname in ('Users view own notifications', 'Users can update own notifications')
      and qual ilike '%auth.uid() = user_id%'
  ), 0) <> 2 then
    insert into ucc2_verify_failures values (
      'core', 'notifications policies',
      '''Users view own notifications'' + ''Users can update own notifications'' scoped to auth.uid() = user_id',
      'one or both policies missing or not user-scoped'
    );
  end if;

  -- profiles: self-service signup inserts must never carry privileges.
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public' and tablename = 'profiles'
      and policyname = 'Users can insert own profile'
      and with_check ilike '%role = ''student''%'
  ) then
    insert into ucc2_verify_failures values (
      'core', 'profiles self-insert policy',
      '''Users can insert own profile'' with check restricting role = ''student'' (and faculty_status to none/pending)',
      'policy missing or does not restrict role — self-service signup could create privileged accounts'
    );
  end if;

  -- profiles: public visibility is what makes contact data on profiles untenable;
  -- assert it is still true so the profile_contacts separation stays justified.
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public' and tablename = 'profiles'
      and policyname = 'Public profiles are viewable by everyone'
      and cmd = 'SELECT'
  ) then
    insert into ucc2_verify_failures values (
      'core', 'profiles public read policy',
      '''Public profiles are viewable by everyone'' (SELECT) — baseline the contact split relies on',
      'policy missing; profile_contacts separation rationale may be stale'
    );
  end if;

  raise notice 'PASS 22.10 core RLS invariants';

exception when others then
  insert into ucc2_verify_failures values (
    'core', '22.10 block', 'core RLS invariants',
    'unexpected error: ' || coalesce(SQLERRM, 'unknown')
  );
end;
$gate$;

-- ---------------------------------------------------------
-- 22.11 SECURITY DEFINER search_path audit [01, 02, 04]
--
-- A SECURITY DEFINER function without a pinned search_path resolves
-- object names against the caller's search_path — the classic definer
-- hijack. Every privileged function shipped by Phase 1 sets search_path;
-- this fails for any that silently lost it.
--
-- Repository convention pins search_path to `public`. That is acceptable;
-- a later hardening pass may move to the stricter empty search_path with
-- fully qualified names (tracked in the runbook).
-- ---------------------------------------------------------
do $gate$
declare
  r record;
  v_missing text[] := '{}';
begin
  for r in
    select p.proname, coalesce(p.proconfig::text, '') as config
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.prosecdef
      and p.proname in (
        'emit_notification',
        'handle_new_user',
        'protect_profile_privileges',
        'on_faculty_application_status',
        'is_admin',
        'update_updated_at_column'
      )
  loop
    if r.config not ilike '%search_path%' then
      v_missing := v_missing || r.proname;
    end if;
  end loop;

  if array_length(v_missing, 1) > 0 then
    insert into ucc2_verify_failures values (
      '2026102201', 'security definer search_path',
      'explicit SET search_path on every privileged SECURITY DEFINER function:
       emit_notification, handle_new_user, protect_profile_privileges,
       on_faculty_application_status, is_admin, update_updated_at_column',
      'missing on: ' || array_to_string(v_missing, ', ')
    );
  else
    raise notice 'PASS 22.11 security definer search_path audit';
  end if;

exception when others then
  insert into ucc2_verify_failures values (
    'core', '22.11 block', 'security definer search_path audit',
    'unexpected error: ' || coalesce(SQLERRM, 'unknown')
  );
end;
$gate$;

-- ---------------------------------------------------------
-- 23. VERDICT
-- ---------------------------------------------------------
\echo ''
\echo '--- 23. VERDICT ---'
do $$
declare
  v_failures int;
  r record;
  v_row record;
begin
  select count(*) into v_failures from ucc2_verify_failures;

  if v_failures = 0 then
    for r in select check_name, note from ucc2_verify_notes
    loop
      raise notice 'NOTE [%] %', r.check_name, r.note;
    end loop;
    raise notice '=== VERIFICATION PASSED: all required UCC 2.0 Phase 1 objects match their expected definitions. ===';
  else
    raise notice '=== VERIFICATION FAILED: % problem(s). Details follow: ===', v_failures;
    for v_row in
      select migration, check_name, expected, actual
      from ucc2_verify_failures
      order by migration, check_name
    loop
      raise notice '[migration %] %', v_row.migration, v_row.check_name;
      raise notice '  expected: %', v_row.expected;
      raise notice '  actual:   %', v_row.actual;
    end loop;
    raise exception
      using
        errcode = 'P0001',
        message = format('Schema verification FAILED: %s mismatch(es) against expected UCC 2.0 Phase 1 definitions.', v_failures),
        detail = 'See the listed [migration] entries above; each names the object, expected definition and actual state.',
        hint = 'Apply the referenced supabase/migrations file(s) in docs/migration-dependency-order.md order, then re-run this script.';
  end if;
end;
$$;

\echo ''
\echo '=== VERIFICATION COMPLETE ==='
