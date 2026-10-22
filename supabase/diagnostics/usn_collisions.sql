-- =========================================================
-- UCC 2.0 — normalized USN collision diagnostic (READ-ONLY)
--
-- Safe to run at any time. It does not update, merge, delete, or
-- reassign anything. Full USNs are masked, and no names/emails are
-- returned, so the output is safe to paste into an incident log.
--
-- Run this in the Supabase SQL Editor before applying:
--   supabase/migrations/2026102203_global_usn_uniqueness.sql
-- or whenever the migration reports duplicate USN groups.
--
-- Remediation (manual, deliberate, never automatic):
--   1. For each group below, use profile_ids to identify the accounts.
--   2. Confirm with the affected people which account owns the USN.
--   3. Pick a canonical owner. For every other profile, either:
--        - set usn = NULL (legitimate missing USN), or
--        - set the corrected USN.
--   4. Re-run the uniqueness migration.
--
-- The profile privilege trigger reverts usn changes made without an
-- admin JWT (including the SQL Editor, where auth.uid() is NULL). For a
-- deliberate SQL Editor remediation, wrap the change in a transaction
-- and disable only that trigger for the duration:
--
--   begin;
--   alter table public.profiles
--     disable trigger trg_protect_profile_privileges;
--   update public.profiles set usn = null
--     where id = '<non-owner-profile-id>';
--   alter table public.profiles
--     enable trigger trg_protect_profile_privileges;
--   commit;
--
-- Do NOT delete profiles, merge accounts, or copy a USN between accounts
-- to make the index build. Those actions change account ownership and
-- require the account owners' explicit consent plus a separate,
-- reviewed data-fix migration.
-- =========================================================

-- ---------------------------------------------------------
-- 1. Collision groups (masked)
-- ---------------------------------------------------------

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
  array_agg(member_type order by created_at, id) as member_types,
  min(created_at) as earliest_profile_created_at,
  max(created_at) as latest_profile_created_at
from normalized
group by usn_norm
having count(*) > 1
order by profile_count desc, usn_masked;

-- ---------------------------------------------------------
-- 2. Aggregate count (no identifiers)
-- ---------------------------------------------------------

with normalized as (
  select upper(btrim(usn)) as usn_norm
  from public.profiles
  where usn is not null
    and btrim(usn) <> ''
)
select
  count(*) filter (where cnt > 1) as duplicate_group_count,
  coalesce(sum(cnt) filter (where cnt > 1), 0) as profiles_in_duplicate_groups
from (
  select usn_norm, count(*) as cnt
  from normalized
  group by usn_norm
) grouped;

-- ---------------------------------------------------------
-- 3. Index state
-- ---------------------------------------------------------

select
  i.indexname,
  i.indexdef
from pg_indexes i
where i.schemaname = 'public'
  and i.tablename = 'profiles'
  and i.indexname in (
    'profiles_usn_normalized_unique',
    'profiles_student_usn_unique'
  )
order by i.indexname;
