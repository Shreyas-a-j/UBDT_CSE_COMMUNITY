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

    -- The audit finding was a duplicated member_type mapping. Assert the
    -- mapping is defined exactly once and that the profiles insert consumes
    -- that same variable, rather than only checking for a token.
    if regexp_count(v_src, 'member_kind\s*:=', 1, 'i') <> 1
       or v_src !~* 'member_kind\s*:=\s*case\s+when\s+intent\s*=\s*''alumni''\s+then\s+''alumni''\s+else\s+''student''\s+end' then
      insert into ucc2_verify_failures values (
        '2026102201', 'handle_new_user alumni intent',
        'member_kind is assigned exactly once as
         case when intent = ''alumni'' then ''alumni'' else ''student'' end',
        'alumni member_type mapping missing, duplicated, or changed in function body'
      );
    end if;
    if v_src !~* 'member_kind\s*,\s*grad_yr' then
      insert into ucc2_verify_failures values (
        '2026102201', 'handle_new_user alumni intent',
        'the single member_kind assignment is passed to the profiles insert
         as the member_type value',
        'member_kind assignment is not used by the profiles insert'
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
-- 22.12 Discussion pin surface [2026102301]
--
-- Pins must be readable only while active, writable only through the
-- SECURITY DEFINER RPCs, and globally limited to 3. This gate checks the
-- structural guarantees; supabase/test-discussion-pins.sql exercises the
-- behaviour (including concurrency).
-- ---------------------------------------------------------
do $gate$
declare
  v_cols int;
  v_rls boolean;
  v_select_policy int;
  v_write_policies int;
  v_bad_privs text[] := '{}';
  v_bad_definer text[] := '{}';
  v_indexdef text;
  v_src text;
begin
  select count(*) into v_cols
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'discussion_pins'
    and column_name in (
      'post_id', 'pinned_by', 'pinned_at',
      'pin_expires_at', 'unpinned_at', 'unpinned_by'
    );

  if v_cols <> 6 then
    insert into ucc2_verify_failures values (
      '2026102301', 'discussion_pins columns',
      'post_id, pinned_by, pinned_at, pin_expires_at, unpinned_at, unpinned_by',
      'found ' || v_cols || ' of 6 expected columns'
    );
  end if;

  -- The primary key must be exactly (id). A legacy PRIMARY KEY (post_id)
  -- makes unpin -> re-pin collide with the retained history row and is the
  -- cause of "duplicate key value violates ... discussion_pins_pkey".
  -- 2026102601 repairs that shape without deleting history.
  if to_regclass('public.discussion_pins') is not null
     and not exists (
       select 1
       from pg_constraint
       where conrelid = 'public.discussion_pins'::regclass
         and contype = 'p'
         and pg_get_constraintdef(oid) = 'PRIMARY KEY (id)'
     ) then
    insert into ucc2_verify_failures values (
      '2026102601', 'discussion_pins primary key',
      'PRIMARY KEY (id)',
      'legacy or missing primary key (expected id)'
    );
  end if;

  -- post_id is the single source of truth. It must be NOT NULL (the live
  -- failure was a NULL post_id insert) and the legacy discussion_id column
  -- must not survive the repair.
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'discussion_pins'
      and column_name = 'post_id'
      and is_nullable = 'NO'
  ) then
    insert into ucc2_verify_failures values (
      '2026102302', 'discussion_pins canonical post_id',
      'post_id NOT NULL',
      'post_id is missing or nullable'
    );
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'discussion_pins'
      and column_name = 'discussion_id'
  ) then
    insert into ucc2_verify_failures values (
      '2026102302', 'discussion_pins canonical post_id',
      'no legacy discussion_id column',
      'discussion_id still exists'
    );
  end if;

  select c.relrowsecurity into v_rls
  from pg_class c
  where c.oid = 'public.discussion_pins'::regclass;

  if v_rls is not true then
    insert into ucc2_verify_failures values (
      '2026102301', 'discussion_pins RLS',
      'row level security enabled', 'RLS is disabled'
    );
  end if;

  select count(*) into v_select_policy
  from pg_policies
  where schemaname = 'public'
    and tablename = 'discussion_pins'
    and cmd = 'SELECT'
    and qual ilike '%pin_expires_at%now()%'
    and qual ilike '%unpinned_at%is null%';

  if v_select_policy <> 1 then
    insert into ucc2_verify_failures values (
      '2026102301', 'discussion_pins active-read policy',
      'one SELECT policy requiring unpinned_at is null AND pin_expires_at > now()',
      'matching SELECT policies: ' || v_select_policy
    );
  end if;

  select count(*) into v_write_policies
  from pg_policies
  where schemaname = 'public'
    and tablename = 'discussion_pins'
    and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL');

  if v_write_policies <> 0 then
    insert into ucc2_verify_failures values (
      '2026102301', 'discussion_pins write policies',
      'no direct write policies (mutations only through RPCs)',
      'found ' || v_write_policies || ' write policy/policies'
    );
  end if;

  if has_table_privilege('anon', 'public.discussion_pins', 'SELECT') is not true
     or has_table_privilege('authenticated', 'public.discussion_pins', 'SELECT') is not true then
    v_bad_privs := v_bad_privs || 'missing SELECT grant';
  end if;
  if has_table_privilege('anon', 'public.discussion_pins', 'INSERT')
     or has_table_privilege('anon', 'public.discussion_pins', 'UPDATE')
     or has_table_privilege('anon', 'public.discussion_pins', 'DELETE') then
    v_bad_privs := v_bad_privs || 'anon has write privilege';
  end if;
  if has_table_privilege('authenticated', 'public.discussion_pins', 'INSERT')
     or has_table_privilege('authenticated', 'public.discussion_pins', 'UPDATE')
     or has_table_privilege('authenticated', 'public.discussion_pins', 'DELETE') then
    v_bad_privs := v_bad_privs || 'authenticated has write privilege';
  end if;
  if array_length(v_bad_privs, 1) > 0 then
    insert into ucc2_verify_failures values (
      '2026102301', 'discussion_pins table privileges',
      'anon/authenticated SELECT only',
      array_to_string(v_bad_privs, ', ')
    );
  end if;

  if has_function_privilege('anon', 'public.pin_discussion(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.unpin_discussion(uuid)', 'EXECUTE') then
    insert into ucc2_verify_failures values (
      '2026102301', 'discussion pin RPC grants',
      'anon cannot execute pin/unpin',
      'anon has EXECUTE'
    );
  end if;
  if has_function_privilege('authenticated', 'public.pin_discussion(uuid)', 'EXECUTE') is not true
     or has_function_privilege('authenticated', 'public.unpin_discussion(uuid)', 'EXECUTE') is not true then
    insert into ucc2_verify_failures values (
      '2026102301', 'discussion pin RPC grants',
      'authenticated can execute pin/unpin',
      'missing EXECUTE for authenticated'
    );
  end if;

  select p.prosecdef, coalesce(p.proconfig::text, ''), p.prosrc
    into v_rls, v_indexdef, v_src
  from pg_proc p
  where p.oid = 'public.pin_discussion(uuid)'::regprocedure;

  if v_rls is not true or v_indexdef not ilike '%search_path%' then
    v_bad_definer := v_bad_definer || 'pin_discussion';
  end if;
  if v_src not ilike '%pg_advisory_xact_lock%' then
    insert into ucc2_verify_failures values (
      '2026102301', 'pin_discussion concurrency',
      'transaction-scoped advisory lock around the global count',
      'pg_advisory_xact_lock not found in function body'
    );
  end if;
  if v_src not ilike '%is_admin%' or v_src not ilike '%is_verified_faculty%' then
    insert into ucc2_verify_failures values (
      '2026102302', 'pin_discussion authorization',
      'explicit is_admin(auth.uid()) OR is_verified_faculty(auth.uid())',
      'one or both authorization helpers are missing from the function body'
    );
  end if;

  select p.prosecdef, coalesce(p.proconfig::text, ''), p.prosrc
    into v_rls, v_indexdef, v_src
  from pg_proc p
  where p.oid = 'public.unpin_discussion(uuid)'::regprocedure;

  if v_rls is not true or v_indexdef not ilike '%search_path%' then
    v_bad_definer := v_bad_definer || 'unpin_discussion';
  end if;
  if v_src not ilike '%is_admin%' or v_src not ilike '%is_verified_faculty%' then
    insert into ucc2_verify_failures values (
      '2026102302', 'unpin_discussion authorization',
      'explicit is_admin(auth.uid()) OR is_verified_faculty(auth.uid())',
      'one or both authorization helpers are missing from the function body'
    );
  end if;

  if array_length(v_bad_definer, 1) > 0 then
    insert into ucc2_verify_failures values (
      '2026102301', 'discussion pin SECURITY DEFINER',
      'SECURITY DEFINER with SET search_path on pin/unpin',
      'missing on: ' || array_to_string(v_bad_definer, ', ')
    );
  end if;

  select indexdef into v_indexdef
  from pg_indexes
  where schemaname = 'public'
    and tablename = 'discussion_pins'
    and indexname = 'discussion_pins_one_active_per_discussion';

  if v_indexdef is null or v_indexdef not ilike '%UNIQUE%'
     or v_indexdef not ilike '%unpinned_at IS NULL%' then
    insert into ucc2_verify_failures values (
      '2026102301', 'one active pin per discussion',
      'partial UNIQUE index on post_id WHERE unpinned_at IS NULL',
      coalesce(v_indexdef, 'index missing')
    );
  end if;

  if not exists (
    select 1 from ucc2_verify_failures
    where migration = '2026102301'
  ) then
    raise notice 'PASS 22.12 discussion pin surface';
  end if;

exception when others then
  insert into ucc2_verify_failures values (
    '2026102301', '22.12 block', 'discussion pin surface',
    'unexpected error: ' || coalesce(SQLERRM, 'unknown')
  );
end;
$gate$;

-- ---------------------------------------------------------
-- 22.13 Publish notification schema surface [2026102303]
--
-- The additive constraint values, the default-on email preference and
-- the client-invisible email outbox. Behaviour (defaults, RLS
-- deny-direction, unique idempotency) is exercised by
-- supabase/test-notification-fanout.sql.
-- ---------------------------------------------------------
do $gate$
declare
  v_def text;
  v_cols int;
  v_rls boolean;
  v_policies int;
  v_ok boolean;
begin
  -- constraint extensions (containment: legacy values must survive)
  select pg_get_constraintdef(c.oid, true) into v_def
  from pg_constraint c
  where c.conrelid = 'public.notifications'::regclass
    and c.conname = 'notifications_content_type_check';
  if v_def is null or v_def not ilike '%''announcement''%' then
    insert into ucc2_verify_failures values (
      '2026102303', 'notifications_content_type_check accepts announcement',
      'CHECK (content_type IS NULL OR ... ''announcement'')',
      coalesce(v_def, 'constraint missing')
    );
  end if;

  select pg_get_constraintdef(c.oid, true) into v_def
  from pg_constraint c
  where c.conrelid = 'public.notifications'::regclass
    and c.conname = 'notifications_type_check';
  if v_def is null or v_def not ilike '%''event_published''%' then
    insert into ucc2_verify_failures values (
      '2026102303', 'notifications_type_check accepts event_published',
      'CHECK (type in (... ''event_published''))',
      coalesce(v_def, 'constraint missing')
    );
  end if;

  -- notification_preferences: shape, default-on column, own-row RLS
  select count(*) into v_cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'notification_preferences'
    and column_name in ('user_id', 'email_enabled', 'updated_at');
  if v_cols <> 3 then
    insert into ucc2_verify_failures values (
      '2026102303', 'notification_preferences columns',
      'user_id, email_enabled, updated_at',
      'found ' || v_cols || ' of 3 expected columns'
    );
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'notification_preferences'
      and column_name = 'email_enabled'
      and is_nullable = 'NO' and column_default = 'true'
  ) then
    insert into ucc2_verify_failures values (
      '2026102303', 'notification_preferences default-on',
      'email_enabled boolean NOT NULL DEFAULT true',
      'email_enabled missing, nullable, or not defaulting to true'
    );
  end if;

  select c.relrowsecurity into v_rls
  from pg_class c where c.oid = 'public.notification_preferences'::regclass;
  if not coalesce(v_rls, false) then
    insert into ucc2_verify_failures values (
      '2026102303', 'notification_preferences RLS enabled',
      'row level security enabled',
      'RLS is not enabled'
    );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'notification_preferences'
      and policyname = 'Users manage own notification preferences'
  ) then
    insert into ucc2_verify_failures values (
      '2026102303', 'notification_preferences own-row policy',
      'policy "Users manage own notification preferences"',
      'policy missing'
    );
  end if;

  -- notification_email_outbox: shape, status default, unique key,
  -- RLS enabled with zero policies, client privileges revoked
  select count(*) into v_cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'notification_email_outbox'
    and column_name in (
      'id', 'source_type', 'source_id', 'user_id', 'status', 'attempts',
      'last_error', 'next_attempt_at', 'locked_at', 'provider',
      'provider_message_id', 'sent_at', 'created_at', 'updated_at'
    );
  if v_cols <> 14 then
    insert into ucc2_verify_failures values (
      '2026102303', 'notification_email_outbox columns',
      '14 worker columns (id .. updated_at)',
      'found ' || v_cols || ' of 14 expected columns'
    );
  end if;

  select pg_get_constraintdef(c.oid, true) into v_def
  from pg_constraint c
  where c.conrelid = 'public.notification_email_outbox'::regclass
    and c.conname = 'notification_email_outbox_unique';
  if v_def is null
     or v_def not ilike '%source_type%'
     or v_def not ilike '%source_id%'
     or v_def not ilike '%user_id%' then
    insert into ucc2_verify_failures values (
      '2026102303', 'notification_email_outbox unique idempotency key',
      'UNIQUE (source_type, source_id, user_id)',
      coalesce(v_def, 'constraint missing')
    );
  end if;

  select c.relrowsecurity into v_rls
  from pg_class c where c.oid = 'public.notification_email_outbox'::regclass;
  if not coalesce(v_rls, false) then
    insert into ucc2_verify_failures values (
      '2026102303', 'notification_email_outbox RLS enabled',
      'row level security enabled',
      'RLS is not enabled'
    );
  end if;

  select count(*) into v_policies
  from pg_policies
  where schemaname = 'public' and tablename = 'notification_email_outbox';
  if v_policies <> 0 then
    insert into ucc2_verify_failures values (
      '2026102303', 'notification_email_outbox has no client policies',
      'zero row level security policies',
      v_policies || ' policy/policies present'
    );
  end if;

  v_ok := not has_table_privilege('anon', 'public.notification_email_outbox', 'select')
      and not has_table_privilege('anon', 'public.notification_email_outbox', 'insert')
      and not has_table_privilege('authenticated', 'public.notification_email_outbox', 'select')
      and not has_table_privilege('authenticated', 'public.notification_email_outbox', 'insert');
  if not v_ok then
    insert into ucc2_verify_failures values (
      '2026102303', 'notification_email_outbox client lockout',
      'anon/authenticated hold no select/insert on the outbox',
      'at least one client role still holds a table privilege'
    );
  end if;

  if not exists (
    select 1 from ucc2_verify_failures where migration = '2026102303'
  ) then
    raise notice 'PASS 22.13 publish notification schema surface';
  end if;

exception when others then
  insert into ucc2_verify_failures values (
    '2026102303', '22.13 block', 'publish notification schema surface',
    'unexpected error: ' || coalesce(SQLERRM, 'unknown')
  );
end;
$gate$;

-- ---------------------------------------------------------
-- 22.14 Publish fan-out triggers [2026102304]
--
-- Structural guarantees: the two fan-out functions exist as SECURITY
-- DEFINER locked to the database itself, both AFTER INSERT triggers
-- call them, and no trigger of any kind invokes the fan-out on UPDATE
-- (edits must never publish). Behaviour is exercised by
-- supabase/test-notification-fanout.sql.
-- ---------------------------------------------------------
do $gate$
declare
  v_n int;
  v_ok boolean;
begin
  -- functions: present, SECURITY DEFINER, not client-executable
  select count(*) into v_n
  from pg_proc p
  where p.oid in (
    'public.publish_recipient_ids(uuid)'::regprocedure,
    'public.on_publish_notification()'::regprocedure
  ) and p.prosecdef;
  if v_n <> 2 then
    insert into ucc2_verify_failures values (
      '2026102304', 'fan-out functions SECURITY DEFINER',
      'publish_recipient_ids(uuid) and on_publish_notification() exist and are SECURITY DEFINER',
      'found ' || v_n || ' of 2 expected functions'
    );
  end if;

  v_ok := not has_function_privilege('anon', 'public.publish_recipient_ids(uuid)', 'execute')
      and not has_function_privilege('authenticated', 'public.publish_recipient_ids(uuid)', 'execute')
      and not has_function_privilege('anon', 'public.on_publish_notification()', 'execute')
      and not has_function_privilege('authenticated', 'public.on_publish_notification()', 'execute');
  if not v_ok then
    insert into ucc2_verify_failures values (
      '2026102304', 'fan-out function execute lockout',
      'anon/authenticated hold no execute on the fan-out functions',
      'at least one client role still holds execute'
    );
  end if;

  -- triggers: AFTER INSERT ROW, calling the fan-out function
  select count(*) into v_n
  from pg_trigger t
  where t.tgrelid = 'public.announcements'::regclass
    and t.tgname = 'trg_publish_fanout_announcement'
    and t.tgfoid = 'public.on_publish_notification()'::regprocedure
    and (t.tgtype & 1) = 1    -- FOR EACH ROW
    and (t.tgtype & 2) = 0    -- not BEFORE (=> AFTER)
    and (t.tgtype & 4) = 4;   -- INSERT
  if v_n <> 1 then
    insert into ucc2_verify_failures values (
      '2026102304', 'announcements AFTER INSERT fan-out trigger',
      'one AFTER INSERT row trigger trg_publish_fanout_announcement',
      'found ' || v_n
    );
  end if;

  select count(*) into v_n
  from pg_trigger t
  where t.tgrelid = 'public.events'::regclass
    and t.tgname = 'trg_publish_fanout_event'
    and t.tgfoid = 'public.on_publish_notification()'::regprocedure
    and (t.tgtype & 1) = 1
    and (t.tgtype & 2) = 0
    and (t.tgtype & 4) = 4;
  if v_n <> 1 then
    insert into ucc2_verify_failures values (
      '2026102304', 'events AFTER INSERT fan-out trigger',
      'one AFTER INSERT row trigger trg_publish_fanout_event',
      'found ' || v_n
    );
  end if;

  -- edits never publish: no UPDATE (or INSERT-or-UPDATE) trigger may
  -- call the fan-out function on either table
  if exists (
    select 1 from pg_trigger t
    where t.tgrelid in ('public.announcements'::regclass, 'public.events'::regclass)
      and t.tgfoid = 'public.on_publish_notification()'::regprocedure
      and (t.tgtype & 16) = 16   -- UPDATE
  ) then
    insert into ucc2_verify_failures values (
      '2026102304', 'no publish fan-out on UPDATE',
      'on_publish_notification is attached to INSERT only',
      'an UPDATE trigger invokes the publish fan-out'
    );
  end if;

  if not exists (
    select 1 from ucc2_verify_failures where migration = '2026102304'
  ) then
    raise notice 'PASS 22.14 publish fan-out triggers';
  end if;

exception when others then
  insert into ucc2_verify_failures values (
    '2026102304', '22.14 block', 'publish fan-out triggers',
    'unexpected error: ' || coalesce(SQLERRM, 'unknown')
  );
end;
$gate$;

-- ---------------------------------------------------------
-- 22.15 Android push schema surface [2026102401]
--
-- Additive notification type, push preference, one-row-per-notification
-- push outbox, and durable showcase tenures. Behaviour is exercised by
-- supabase/test-notification-fanout.sql.
-- ---------------------------------------------------------
do $gate$
declare
  v_def text;
  v_cols int;
  v_rls boolean;
  v_policies int;
  v_ok boolean;
begin
  select pg_get_constraintdef(c.oid, true) into v_def
  from pg_constraint c
  where c.conrelid = 'public.notifications'::regclass
    and c.conname = 'notifications_type_check';
  if v_def is null or v_def not ilike '%''showcase_top2''%' then
    insert into ucc2_verify_failures values (
      '2026102401', 'notifications_type_check accepts showcase_top2',
      'CHECK (type in (... ''showcase_top2''))',
      coalesce(v_def, 'constraint missing')
    );
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'notification_preferences'
      and column_name = 'push_enabled'
      and data_type = 'boolean' and is_nullable = 'NO' and column_default = 'true'
  ) then
    insert into ucc2_verify_failures values (
      '2026102401', 'notification_preferences.push_enabled',
      'push_enabled boolean NOT NULL DEFAULT true',
      'missing, nullable, or not defaulting to true'
    );
  end if;

  select count(*) into v_cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'notification_push_outbox'
    and column_name in (
      'id', 'notification_id', 'user_id', 'source_type', 'source_id',
      'status', 'attempts', 'last_error', 'next_attempt_at', 'locked_at',
      'provider', 'provider_message_id', 'sent_at', 'created_at', 'updated_at'
    );
  if v_cols <> 15 then
    insert into ucc2_verify_failures values (
      '2026102401', 'notification_push_outbox columns',
      '15 worker columns (id .. updated_at)',
      'found ' || v_cols || ' of 15 expected columns'
    );
  end if;

  select pg_get_constraintdef(c.oid, true) into v_def
  from pg_constraint c
  where c.conrelid = 'public.notification_push_outbox'::regclass
    and c.conname = 'notification_push_outbox_notification_unique';
  if v_def is null or v_def not ilike '%notification_id%' then
    insert into ucc2_verify_failures values (
      '2026102401', 'push outbox one row per notification',
      'UNIQUE (notification_id)',
      coalesce(v_def, 'constraint missing')
    );
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'notification_push_outbox'
      and column_name = 'status' and column_default like '%pending%'
  ) then
    insert into ucc2_verify_failures values (
      '2026102401', 'push outbox status default',
      'status text NOT NULL DEFAULT pending',
      'status missing or not defaulting to pending'
    );
  end if;

  select c.relrowsecurity into v_rls
  from pg_class c where c.oid = 'public.notification_push_outbox'::regclass;
  if not coalesce(v_rls, false) then
    insert into ucc2_verify_failures values (
      '2026102401', 'push outbox RLS enabled',
      'row level security enabled',
      'RLS is not enabled'
    );
  end if;

  select count(*) into v_policies
  from pg_policies
  where schemaname = 'public' and tablename = 'notification_push_outbox';
  if v_policies <> 0 then
    insert into ucc2_verify_failures values (
      '2026102401', 'push outbox has no client policies',
      'zero row level security policies',
      v_policies || ' policy/policies present'
    );
  end if;

  v_ok := not has_table_privilege('anon', 'public.notification_push_outbox', 'select')
      and not has_table_privilege('anon', 'public.notification_push_outbox', 'insert')
      and not has_table_privilege('authenticated', 'public.notification_push_outbox', 'select')
      and not has_table_privilege('authenticated', 'public.notification_push_outbox', 'insert');
  if not v_ok then
    insert into ucc2_verify_failures values (
      '2026102401', 'push outbox client lockout',
      'anon/authenticated hold no select/insert on the push outbox',
      'at least one client role still holds a table privilege'
    );
  end if;

  select count(*) into v_cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'showcase_top_entries'
    and column_name in (
      'id', 'post_id', 'entry_seq', 'entered_at', 'left_at',
      'notified_at', 'notification_id', 'created_at'
    );
  if v_cols <> 8 then
    insert into ucc2_verify_failures values (
      '2026102401', 'showcase_top_entries columns',
      '8 tenure columns (id .. created_at)',
      'found ' || v_cols || ' of 8 expected columns'
    );
  end if;

  if not exists (
    select 1 from pg_constraint c
    where c.conrelid = 'public.showcase_top_entries'::regclass
      and c.conname = 'showcase_top_entries_seq_unique'
  ) then
    insert into ucc2_verify_failures values (
      '2026102401', 'showcase tenure per-post sequence uniqueness',
      'UNIQUE (post_id, entry_seq)',
      'constraint missing'
    );
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'showcase_top_entries'
      and indexname = 'showcase_top_entries_one_active_idx'
      and indexdef ilike '%unique%'
  ) then
    insert into ucc2_verify_failures values (
      '2026102401', 'one active showcase tenure per post',
      'unique partial index on post_id WHERE left_at IS NULL',
      'index missing or not unique'
    );
  end if;

  select c.relrowsecurity into v_rls
  from pg_class c where c.oid = 'public.showcase_top_entries'::regclass;
  if not coalesce(v_rls, false) then
    insert into ucc2_verify_failures values (
      '2026102401', 'showcase_top_entries RLS enabled',
      'row level security enabled',
      'RLS is not enabled'
    );
  end if;

  select count(*) into v_policies
  from pg_policies
  where schemaname = 'public' and tablename = 'showcase_top_entries';
  if v_policies <> 0 then
    insert into ucc2_verify_failures values (
      '2026102401', 'showcase_top_entries has no client policies',
      'zero row level security policies',
      v_policies || ' policy/policies present'
    );
  end if;

  v_ok := not has_table_privilege('anon', 'public.showcase_top_entries', 'select')
      and not has_table_privilege('authenticated', 'public.showcase_top_entries', 'select');
  if not v_ok then
    insert into ucc2_verify_failures values (
      '2026102401', 'showcase_top_entries client lockout',
      'anon/authenticated hold no select on showcase_top_entries',
      'at least one client role still holds select'
    );
  end if;

  if not exists (
    select 1 from ucc2_verify_failures where migration = '2026102401'
  ) then
    raise notice 'PASS 22.15 Android push schema surface';
  end if;

exception when others then
  insert into ucc2_verify_failures values (
    '2026102401', '22.15 block', 'Android push schema surface',
    'unexpected error: ' || coalesce(SQLERRM, 'unknown')
  );
end;
$gate$;

-- ---------------------------------------------------------
-- 22.16 Push and showcase triggers [2026102402]
-- ---------------------------------------------------------
do $gate$
declare
  v_n int;
  v_ok boolean;
  v_src text;
begin
  select count(*) into v_n
  from pg_proc p
  where p.oid in (
    'public.recompute_showcase_top2()'::regprocedure,
    'public.on_showcase_ranking_change()'::regprocedure
  ) and p.prosecdef;
  if v_n <> 2 then
    insert into ucc2_verify_failures values (
      '2026102402', 'showcase ranking functions SECURITY DEFINER',
      'recompute_showcase_top2() and on_showcase_ranking_change() exist and are SECURITY DEFINER',
      'found ' || v_n || ' of 2 expected functions'
    );
  end if;

  v_ok := not has_function_privilege('anon', 'public.recompute_showcase_top2()', 'execute')
      and not has_function_privilege('authenticated', 'public.recompute_showcase_top2()', 'execute')
      and not has_function_privilege('anon', 'public.on_showcase_ranking_change()', 'execute')
      and not has_function_privilege('authenticated', 'public.on_showcase_ranking_change()', 'execute');
  if not v_ok then
    insert into ucc2_verify_failures values (
      '2026102402', 'showcase ranking function execute lockout',
      'anon/authenticated hold no execute on ranking functions',
      'at least one client role still holds execute'
    );
  end if;

  select pg_get_functiondef('public.on_publish_notification()'::regprocedure) into v_src;
  if v_src not ilike '%notification_push_outbox%' then
    insert into ucc2_verify_failures values (
      '2026102402', 'publish fan-out enqueues push',
      'on_publish_notification() inserts into notification_push_outbox',
      'function body has no push enqueue'
    );
  end if;
  if v_src ilike '%notification_email_outbox%' then
    insert into ucc2_verify_failures values (
      '2026102402', 'publish fan-out stopped writing email',
      'on_publish_notification() contains no email-outbox write',
      'function body still references notification_email_outbox'
    );
  end if;

  select pg_get_functiondef('public.recompute_showcase_top2()'::regprocedure) into v_src;
  if v_src not ilike '%pg_advisory_xact_lock%' then
    insert into ucc2_verify_failures values (
      '2026102402', 'showcase ranking serialized',
      'recompute_showcase_top2() takes the ranking advisory lock',
      'function body has no advisory lock'
    );
  end if;
  if v_src not ilike '%limit 2%'
     or v_src not ilike '%count(u.id) desc%'
     or v_src not ilike '%p.created_at desc%'
     or v_src not ilike '%p.id asc%' then
    insert into ucc2_verify_failures values (
      '2026102402', 'showcase ranking order and cap',
      'order by upvotes desc, created_at desc, id asc; limit 2; at least one upvote',
      'function body does not contain the expected order/cap fragments'
    );
  end if;

  select count(*) into v_n
  from pg_trigger t
  where t.tgname in (
    'trg_showcase_ranking_post_insert',
    'trg_showcase_ranking_post_delete',
    'trg_showcase_ranking_upvote_insert',
    'trg_showcase_ranking_upvote_delete'
  )
    and t.tgfoid = 'public.on_showcase_ranking_change()'::regprocedure
    and (t.tgtype & 1) = 1
    and (t.tgtype & 2) = 0;
  if v_n <> 4 then
    insert into ucc2_verify_failures values (
      '2026102402', 'showcase ranking row triggers',
      'AFTER INSERT/DELETE row triggers on posts and upvotes',
      'found ' || v_n || ' of 4 expected triggers'
    );
  end if;

  if not exists (
    select 1 from pg_trigger t
    where t.tgrelid = 'public.posts'::regclass
      and t.tgname = 'trg_showcase_ranking_post_update'
      and t.tgfoid = 'public.on_showcase_ranking_change()'::regprocedure
      and (t.tgtype & 1) = 1
      and (t.tgtype & 2) = 0
      and (t.tgtype & 16) = 16
      and pg_get_triggerdef(t.oid) ilike '%update of type, author_id, created_at%'
  ) then
    insert into ucc2_verify_failures values (
      '2026102402', 'showcase post update trigger scope',
      'AFTER UPDATE OF type, author_id, created_at on posts',
      'trigger missing or watching unrelated columns'
    );
  end if;

  if not exists (
    select 1 from pg_trigger t
    where t.tgrelid = 'public.upvotes'::regclass
      and t.tgname = 'trg_showcase_ranking_upvote_update'
      and t.tgfoid = 'public.on_showcase_ranking_change()'::regprocedure
      and (t.tgtype & 1) = 1
      and (t.tgtype & 2) = 0
      and (t.tgtype & 16) = 16
      and pg_get_triggerdef(t.oid) ilike '%update of post_id, user_id%'
  ) then
    insert into ucc2_verify_failures values (
      '2026102402', 'showcase upvote update trigger scope',
      'AFTER UPDATE OF post_id, user_id on upvotes',
      'trigger missing or watching unrelated columns'
    );
  end if;

  if not exists (
    select 1 from ucc2_verify_failures where migration = '2026102402'
  ) then
    raise notice 'PASS 22.16 push and showcase triggers';
  end if;

exception when others then
  insert into ucc2_verify_failures values (
    '2026102402', '22.16 block', 'push and showcase triggers',
    'unexpected error: ' || coalesce(SQLERRM, 'unknown')
  );
end;
$gate$;

-- ---------------------------------------------------------
-- 22.17 Email delivery disabled, history retained [2026102403]
-- ---------------------------------------------------------
do $gate$
declare
  v_ok boolean;
  v_n int;
  v_comment text;
begin
  if not exists (
    select 1 from pg_trigger t
    where t.tgrelid = 'public.notification_email_outbox'::regclass
      and t.tgname = 'trg_block_new_email_enqueue'
      and t.tgfoid = 'public.block_new_email_enqueue()'::regprocedure
      and (t.tgtype & 1) = 1
      and (t.tgtype & 2) = 2
      and (t.tgtype & 4) = 4
      and t.tgenabled <> 'D'
  ) then
    insert into ucc2_verify_failures values (
      '2026102403', 'email enqueue hard block',
      'enabled BEFORE INSERT row trigger trg_block_new_email_enqueue',
      'trigger missing, disabled, or not BEFORE INSERT'
    );
  end if;

  v_ok := not has_function_privilege('anon', 'public.block_new_email_enqueue()', 'execute')
      and not has_function_privilege('authenticated', 'public.block_new_email_enqueue()', 'execute');
  if not v_ok then
    insert into ucc2_verify_failures values (
      '2026102403', 'email guard execute lockout',
      'anon/authenticated hold no execute on block_new_email_enqueue()',
      'at least one client role still holds execute'
    );
  end if;

  select count(*) into v_n
  from pg_trigger t
  join pg_proc p on p.oid = t.tgfoid
  join pg_namespace n on n.oid = p.pronamespace
  where t.tgrelid = 'public.notification_email_outbox'::regclass
    and not t.tgisinternal
    and n.nspname = 'supabase_functions';
  if v_n <> 0 then
    insert into ucc2_verify_failures values (
      '2026102403', 'email webhook triggers removed',
      'zero notification_email_outbox triggers in supabase_functions',
      v_n || ' webhook trigger(s) remain'
    );
  end if;

  if to_regclass('public.notification_email_outbox') is null then
    insert into ucc2_verify_failures values (
      '2026102403', 'historical email table retained',
      'public.notification_email_outbox still exists',
      'table was dropped'
    );
  else
    v_comment := obj_description('public.notification_email_outbox'::regclass, 'pg_class');
    if v_comment is null or v_comment not ilike '%HISTORICAL ONLY%' then
      insert into ucc2_verify_failures values (
        '2026102403', 'historical email table marked',
        'table comment contains HISTORICAL ONLY',
        coalesce(v_comment, 'comment missing')
      );
    end if;
  end if;

  if not exists (
    select 1 from ucc2_verify_failures where migration = '2026102403'
  ) then
    raise notice 'PASS 22.17 email disabled, history retained';
  end if;

exception when others then
  insert into ucc2_verify_failures values (
    '2026102403', '22.17 block', 'email disabled and history retained',
    'unexpected error: ' || coalesce(SQLERRM, 'unknown')
  );
end;
$gate$;

-- ---------------------------------------------------------
-- 22.18 Notification retention, dedupe ledger, push log pruning
-- [2026102501]
-- ---------------------------------------------------------
do $gate$
declare
  v_def text;
  v_cols int;
  v_rls boolean;
  v_policies int;
  v_ok boolean;
  v_nullable text;
  v_src text;
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'notifications'
      and indexname = 'notifications_created_at_idx'
  ) then
    insert into ucc2_verify_failures values (
      '2026102501', 'notification retention scan index',
      'notifications_created_at_idx on notifications (created_at)',
      'index missing'
    );
  end if;

  select count(*) into v_cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'notification_dedupe_ledger'
    and column_name in ('user_id', 'dedupe_key', 'created_at', 'released_at');
  if v_cols <> 4 then
    insert into ucc2_verify_failures values (
      '2026102501', 'dedupe ledger columns',
      'user_id, dedupe_key, created_at, released_at',
      'found ' || v_cols || ' of 4 expected columns'
    );
  end if;

  select pg_get_constraintdef(c.oid, true) into v_def
  from pg_constraint c
  where c.conrelid = 'public.notification_dedupe_ledger'::regclass
    and c.conname = 'notification_dedupe_ledger_pkey';
  if v_def is null or v_def not ilike '%user_id%' or v_def not ilike '%dedupe_key%' then
    insert into ucc2_verify_failures values (
      '2026102501', 'dedupe ledger primary key',
      'PRIMARY KEY (user_id, dedupe_key)',
      coalesce(v_def, 'constraint missing')
    );
  end if;

  select pg_get_constraintdef(c.oid, true) into v_def
  from pg_constraint c
  where c.conrelid = 'public.notification_dedupe_ledger'::regclass
    and c.conname = 'notification_dedupe_ledger_dedupe_key_check';
  if v_def is null or v_def not ilike '%char_length%' then
    insert into ucc2_verify_failures values (
      '2026102501', 'dedupe ledger key length check',
      'CHECK (char_length(dedupe_key) between 1 and 200)',
      coalesce(v_def, 'constraint missing')
    );
  end if;

  select c.relrowsecurity into v_rls
  from pg_class c where c.oid = 'public.notification_dedupe_ledger'::regclass;
  if not coalesce(v_rls, false) then
    insert into ucc2_verify_failures values (
      '2026102501', 'dedupe ledger RLS enabled',
      'row level security enabled',
      'RLS is not enabled'
    );
  end if;

  select count(*) into v_policies
  from pg_policies
  where schemaname = 'public' and tablename = 'notification_dedupe_ledger';
  if v_policies <> 0 then
    insert into ucc2_verify_failures values (
      '2026102501', 'dedupe ledger has no client policies',
      'zero row level security policies',
      v_policies || ' policy/policies present'
    );
  end if;

  v_ok := not has_table_privilege('anon', 'public.notification_dedupe_ledger', 'select')
      and not has_table_privilege('anon', 'public.notification_dedupe_ledger', 'insert')
      and not has_table_privilege('anon', 'public.notification_dedupe_ledger', 'update')
      and not has_table_privilege('anon', 'public.notification_dedupe_ledger', 'delete')
      and not has_table_privilege('authenticated', 'public.notification_dedupe_ledger', 'select')
      and not has_table_privilege('authenticated', 'public.notification_dedupe_ledger', 'insert')
      and not has_table_privilege('authenticated', 'public.notification_dedupe_ledger', 'update')
      and not has_table_privilege('authenticated', 'public.notification_dedupe_ledger', 'delete');
  if not v_ok then
    insert into ucc2_verify_failures values (
      '2026102501', 'dedupe ledger client lockout',
      'anon/authenticated hold no select/insert/update/delete on the ledger',
      'at least one client role still holds a privilege'
    );
  end if;

  if not exists (
    select 1 from pg_trigger t
    where t.tgrelid = 'public.notifications'::regclass
      and t.tgname = 'trg_guard_notification_dedupe'
      and t.tgfoid = 'public.guard_notification_dedupe()'::regprocedure
      and (t.tgtype & 1) = 1
      and (t.tgtype & 2) = 2
      and (t.tgtype & 4) = 4
  ) then
    insert into ucc2_verify_failures values (
      '2026102501', 'notification dedupe guard trigger',
      'BEFORE INSERT row trigger trg_guard_notification_dedupe',
      'trigger missing or wrong type'
    );
  end if;

  select p.prosecdef into v_ok
  from pg_proc p
  where p.oid = 'public.guard_notification_dedupe()'::regprocedure;
  if not coalesce(v_ok, false) then
    insert into ucc2_verify_failures values (
      '2026102501', 'dedupe guard SECURITY DEFINER',
      'guard_notification_dedupe() is SECURITY DEFINER',
      'function missing or security invoker'
    );
  end if;

  v_ok := not has_function_privilege(
      'anon', 'public.guard_notification_dedupe()'::regprocedure, 'execute')
    and not has_function_privilege(
      'authenticated', 'public.guard_notification_dedupe()'::regprocedure, 'execute');
  if not v_ok then
    insert into ucc2_verify_failures values (
      '2026102501', 'dedupe guard execute lockout',
      'anon/authenticated hold no execute on the guard',
      'at least one client role still holds execute'
    );
  end if;

  select is_nullable into v_nullable
  from information_schema.columns
  where table_schema = 'public' and table_name = 'notification_push_outbox'
    and column_name = 'notification_id';
  if v_nullable is distinct from 'YES' then
    insert into ucc2_verify_failures values (
      '2026102501', 'push outbox detachable notification link',
      'notification_id is nullable',
      coalesce(v_nullable, 'column missing')
    );
  end if;

  select pg_get_constraintdef(c.oid, true) into v_def
  from pg_constraint c
  where c.conrelid = 'public.notification_push_outbox'::regclass
    and c.conname = 'notification_push_outbox_notification_id_fkey';
  if v_def is null or v_def not ilike '%ON DELETE SET NULL%' then
    insert into ucc2_verify_failures values (
      '2026102501', 'push outbox FK detaches on notification delete',
      'FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE SET NULL',
      coalesce(v_def, 'constraint missing')
    );
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'notification_push_outbox'
      and column_name = 'finished_at'
      and data_type = 'timestamp with time zone'
  ) then
    insert into ucc2_verify_failures values (
      '2026102501', 'push outbox terminal timestamp',
      'finished_at timestamp with time zone',
      'column missing or wrong type'
    );
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'notification_push_outbox'
      and indexname = 'notification_push_outbox_terminal_idx'
  ) then
    insert into ucc2_verify_failures values (
      '2026102501', 'push outbox terminal pruning index',
      'notification_push_outbox_terminal_idx on (status, finished_at)',
      'index missing'
    );
  end if;

  if to_regprocedure(
    'public.notification_push_outbox_is_terminal(text,timestamptz,timestamptz)'
  ) is null then
    insert into ucc2_verify_failures values (
      '2026102501', 'push outbox terminal predicate',
      'notification_push_outbox_is_terminal(text, timestamptz, timestamptz) exists',
      'function missing'
    );
  end if;

  select p.prosecdef into v_ok
  from pg_proc p
  where p.oid = 'public.cleanup_expired_notifications(
    interval, interval, interval, interval, integer, integer
  )'::regprocedure;
  if not coalesce(v_ok, false) then
    insert into ucc2_verify_failures values (
      '2026102501', 'retention cleanup SECURITY DEFINER',
      'cleanup_expired_notifications() exists and is SECURITY DEFINER',
      'function missing or security invoker'
    );
  end if;

  v_ok := not has_function_privilege(
      'anon',
      'public.cleanup_expired_notifications(interval,interval,interval,interval,integer,integer)'::regprocedure,
      'execute')
    and not has_function_privilege(
      'authenticated',
      'public.cleanup_expired_notifications(interval,interval,interval,interval,integer,integer)'::regprocedure,
      'execute');
  if not v_ok then
    insert into ucc2_verify_failures values (
      '2026102501', 'retention cleanup execute lockout',
      'anon/authenticated hold no execute on cleanup_expired_notifications',
      'at least one client role still holds execute'
    );
  end if;

  select pg_get_functiondef(p.oid) into v_src
  from pg_proc p
  where p.oid = 'public.cleanup_expired_notifications(
    interval, interval, interval, interval, integer, integer
  )'::regprocedure;
  if v_src is null
     or v_src not ilike '%notification_dedupe_ledger%'
     or v_src not ilike '%released_at%'
     or v_src not ilike '%notification_push_outbox_is_terminal%'
     or v_src not ilike '%finished_at%' then
    insert into ucc2_verify_failures values (
      '2026102501', 'retention cleanup preserves dedupe and push state',
      'cleanup references the ledger, released_at, terminal predicate and finished_at',
      'function body is missing an expected fragment'
    );
  end if;

  select p.prosecdef into v_ok
  from pg_proc p
  where p.oid = 'public.ensure_notification_retention_schedule()'::regprocedure;
  if not coalesce(v_ok, false) then
    insert into ucc2_verify_failures values (
      '2026102501', 'retention schedule SECURITY DEFINER',
      'ensure_notification_retention_schedule() exists and is SECURITY DEFINER',
      'function missing or security invoker'
    );
  end if;

  v_ok := not has_function_privilege(
      'anon', 'public.ensure_notification_retention_schedule()'::regprocedure, 'execute')
    and not has_function_privilege(
      'authenticated', 'public.ensure_notification_retention_schedule()'::regprocedure, 'execute');
  if not v_ok then
    insert into ucc2_verify_failures values (
      '2026102501', 'retention schedule execute lockout',
      'anon/authenticated hold no execute on ensure_notification_retention_schedule',
      'at least one client role still holds execute'
    );
  end if;

  select pg_get_functiondef(p.oid) into v_src
  from pg_proc p
  where p.oid = 'public.ensure_notification_retention_schedule()'::regprocedure;
  if v_src is null
     or v_src not ilike '%pg_cron%'
     or v_src not ilike '%cron.schedule%'
     or v_src not ilike '%ucc2-cleanup-expired-notifications%' then
    insert into ucc2_verify_failures values (
      '2026102501', 'retention schedule helper shape',
      'helper checks pg_cron and creates/updates ucc2-cleanup-expired-notifications',
      'function body is missing an expected fragment'
    );
  end if;

  if not exists (
    select 1 from ucc2_verify_failures where migration = '2026102501'
  ) then
    raise notice 'PASS 22.18 notification retention, dedupe ledger, push log pruning';
  end if;

exception when others then
  insert into ucc2_verify_failures values (
    '2026102501', '22.18 block',
    'notification retention, dedupe ledger, push log pruning',
    'unexpected error: ' || coalesce(SQLERRM, 'unknown')
  );
end;
$gate$;

-- ---------------------------------------------------------
-- 22.19 announcements DELETE policy (2026102603)
--
-- RLS without a DELETE policy silently filters deletes to zero rows, which
-- used to be reported as "already gone". The author/admin policy must exist.
-- ---------------------------------------------------------
do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'announcements'
      and cmd = 'DELETE'
      and qual ilike '%author_id%'
      and qual ilike '%is_admin%'
  ) then
    insert into ucc2_verify_failures values (
      '2026102603', 'announcements DELETE policy',
      'author OR administrator DELETE policy',
      'missing or incomplete DELETE policy'
    );
  else
    raise notice 'PASS 22.19 announcements DELETE policy';
  end if;
end $$;

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
