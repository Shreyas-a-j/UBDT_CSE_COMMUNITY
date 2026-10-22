-- =========================================================
-- UCC Phase 12.2 — signup provisioning schema alignment
-- Date: 2026-10-22
-- Migration: 2026102211_signup_provisioning_schema_alignment.sql
--
-- Why this exists
-- ---------------
-- Some hand-migrated live databases skipped the base column-repair
-- migrations (2026101301 / 2026101303). The secure faculty-onboarding
-- migration (2026102207) writes these columns:
--
--   * profiles.email             (signup trigger)
--   * profiles.updated_at        (application/profile sync)
--   * the remaining signup fields used by handle_new_user()
--
-- Applying 2026102207 without them fails or leaves the signup trigger
-- unable to provision an application. This migration restores exactly the
-- columns that migration needs.
--
-- It is additive and idempotent:
--   * no role, faculty status, or member type is changed;
--   * no existing row is rewritten;
--   * new signups populate the restored columns through handle_new_user().
--
-- Apply this BEFORE 2026102207_secure_faculty_onboarding.sql on a drifted
-- database. On a canonical database every statement is a no-op.
-- =========================================================

begin;

-- ---------------------------------------------------------
-- 1. Columns written by handle_new_user()
-- ---------------------------------------------------------
alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists section text;
alter table public.profiles add column if not exists interests text[] default '{}'::text[];
alter table public.profiles add column if not exists skills text[] default '{}'::text[];
alter table public.profiles add column if not exists bio text;
alter table public.profiles add column if not exists branch text default 'CSE';
alter table public.profiles add column if not exists year int;
alter table public.profiles add column if not exists usn text;

-- ---------------------------------------------------------
-- 2. Privilege and onboarding columns read by 2026102207
-- ---------------------------------------------------------
alter table public.profiles add column if not exists role text not null default 'student';
alter table public.profiles add column if not exists faculty_status text not null default 'none';
alter table public.profiles add column if not exists designation text;
alter table public.profiles add column if not exists employee_id text;
alter table public.profiles add column if not exists expertise text[] default '{}'::text[];
alter table public.profiles add column if not exists member_type text default 'student';
alter table public.profiles add column if not exists graduation_year int;

-- ---------------------------------------------------------
-- 3. Timestamp used by the profile/application sync triggers
-- ---------------------------------------------------------
alter table public.profiles add column if not exists updated_at timestamptz
  default timezone('utc'::text, now());

alter table public.faculty_applications add column if not exists updated_at timestamptz
  default timezone('utc'::text, now());

-- ---------------------------------------------------------
-- 4. Default for rows created before member_type existed.
--
-- Do not rewrite existing profiles here. The column default covers new
-- rows; the live preflight already established that member_type exists
-- and permits faculty on the target database.
-- ---------------------------------------------------------
alter table public.profiles alter column member_type set default 'student';

-- ---------------------------------------------------------
-- 5. The signup trigger's ON CONFLICT clause needs this partial index.
--    It is part of 2026101402; recreate it only if it was lost.
-- ---------------------------------------------------------
create unique index if not exists faculty_applications_one_pending
  on public.faculty_applications (user_id)
  where status = 'pending';

commit;

notify pgrst, 'reload schema';
