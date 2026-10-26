-- =========================================================
-- UCC 2.0 — align administrator nominee eligibility with the
-- canonical verified-faculty rule
-- Date: 2026-10-26
-- Migration: 2026102602_admin_nominee_eligibility.sql
--
-- Why this migration exists
-- -------------------------
-- public.is_eligible_admin_candidate() required
--   role = 'faculty' AND faculty_status IN ('approved','verified')
--   AND member_type = 'faculty'
--
-- member_type is descriptive identity (student / alumni / faculty), not the
-- privilege model. The canonical verified-faculty rule
-- (public.is_verified_faculty, 2026102206) checks only role and
-- faculty_status. 2026102212 gave profiles.member_type a default of
-- 'student', so an account approved as faculty can legitimately still carry
-- member_type = 'student' (legacy rows, or rows approved before the
-- onboarding trigger wrote member_type). Those accounts are excluded from
-- the administrator handover list and rejected by nominate_admin() even
-- though every other faculty action accepts them.
--
-- The rule is now identical to the canonical verification rule:
--   role = 'faculty' AND faculty_status IN ('approved','verified')
--
-- Students, alumni and unverified/pending/rejected accounts remain
-- ineligible because their role is not 'faculty' (role is protected by
-- public.protect_profile_privileges()). An administrator is not a nominee;
-- nominate_admin() already rejects self/current-admin nominations and the
-- single-admin index is unchanged.
--
-- This migration does not grant administrator privileges. It only decides
-- who may be nominated; acceptance still transfers the role atomically
-- through the existing succession RPC.
--
-- Safety
-- ------
-- * create or replace on one function; no table, row, policy or grant is
--   dropped.
-- * Idempotent.
-- * If the function does not exist (a database that never applied
--   2026102208), this migration creates it; admin_nominations/nominate_admin
--   remain governed by that migration.
-- =========================================================

begin;

create or replace function public.is_eligible_admin_candidate(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = p_user
      and p.role = 'faculty'
      and p.faculty_status in ('approved', 'verified')
  );
$$;

revoke all on function public.is_eligible_admin_candidate(uuid) from public;
revoke all on function public.is_eligible_admin_candidate(uuid) from anon;
grant execute on function public.is_eligible_admin_candidate(uuid)
  to authenticated;

comment on function public.is_eligible_admin_candidate(uuid) is
  'A nominee must be an approved/verified faculty profile (role = faculty). member_type is descriptive, not an eligibility condition.';

notify pgrst, 'reload schema';

commit;
