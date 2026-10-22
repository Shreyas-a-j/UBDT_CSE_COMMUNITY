-- =========================================================
-- UCC Phase 12.1 — profiles.role must allow 'admin'
-- Date: 2026-10-22
-- Migration: 2026102210_admin_role_check_alignment.sql
--
-- Why this exists
-- ---------------
-- Phase 11/12 grant role = 'admin', but some hand-migrated live databases
-- still carry an older profiles_role_check that only allows 'student' and
-- 'faculty'. In that state the one-time bootstrap fails with:
--
--   23514: new row for relation "profiles" violates check constraint
--          "profiles_role_check"
--
-- The canonical base migrations already widen this constraint, but the
-- bootstrap must not assume every environment has them. This migration makes
-- the permission explicit and idempotent before the bootstrap is run.
--
-- It only widens the allowed role vocabulary. It does not promote anyone,
-- does not rewrite existing rows, and does not weaken any other constraint.
-- Apply after 2026102209_admin_bootstrap.sql and before the one-time
-- bootstrap script.
-- =========================================================

begin;

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('student', 'faculty', 'admin'));

commit;

notify pgrst, 'reload schema';
