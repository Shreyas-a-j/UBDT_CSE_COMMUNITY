-- =========================================================
-- UCC Phase 12 — one-time initial administrator bootstrap
-- Date: 2026-10-22
-- Migration: 2026102209_admin_bootstrap.sql
--
-- Apply after 2026102208_single_admin_succession.sql.
--
-- This migration adds the *bookkeeping* for a single, operator-run bootstrap.
-- It deliberately does not promote anyone and it does not leave a callable
-- privileged function behind. The promotion itself is the one-off,
-- owner-executed script in supabase/admin/bootstrap-initial-admin.sql.
--
-- Invariants
-- ----------
--   1. public.admin_bootstrap_state has exactly zero or one row. Once the
--      bootstrap completes, the marker blocks every later run, including after
--      an administrator resigns. Recovery after a resignation is the explicit
--      operator process from Phase 11, not a second bootstrap.
--   2. The audit log now accepts the 'bootstrap' action so the initial grant
--      is recorded with the same actor/target/outcome evidence as succession.
--   3. No browser role can read or write the marker: RLS is enabled with no
--      policies and all table privileges are revoked from anon/authenticated.
--
-- The hard "at most one admin" guarantee remains the partial unique index
-- public.profiles_single_admin from Phase 11. This migration does not weaken it.
-- =========================================================

begin;

-- ---------------------------------------------------------
-- 1. Extend the audit vocabulary with the one-time bootstrap action.
-- ---------------------------------------------------------
alter table public.admin_audit_log
  drop constraint if exists admin_audit_log_action_check;

alter table public.admin_audit_log
  add constraint admin_audit_log_action_check
  check (action in (
    'bootstrap',
    'nomination_created',
    'nomination_declined',
    'nomination_cancelled',
    'admin_transfer',
    'resignation',
    'recovery'
  ));

-- ---------------------------------------------------------
-- 2. Permanent one-time marker.
--
-- The boolean primary key can only ever hold TRUE, so at most one row can
-- exist. The bootstrap script inserts this row in the same transaction as the
-- role change and the audit entry; a failure rolls all three back together.
-- ---------------------------------------------------------
create table if not exists public.admin_bootstrap_state (
  bootstrap_key boolean primary key default true,
  constraint admin_bootstrap_state_single_row check (bootstrap_key is true),
  completed_at timestamptz not null default timezone('utc'::text, now()),
  completed_by text not null,
  target_id uuid references public.profiles(id) on delete set null,
  target_email text not null,
  detail text
);

comment on table public.admin_bootstrap_state is
  'UCC Phase 12: permanent marker proving the one-time initial administrator bootstrap ran. Presence blocks every later bootstrap attempt.';

-- This marker is operator/audit infrastructure, never client-readable data.
alter table public.admin_bootstrap_state enable row level security;

revoke all on table public.admin_bootstrap_state from public;
revoke all on table public.admin_bootstrap_state from anon;
revoke all on table public.admin_bootstrap_state from authenticated;

-- No SELECT policy is created. Even if a future policy is added, the table
-- privileges above must be granted explicitly first.

-- ---------------------------------------------------------
-- 3. Make the marker append-only for ordinary roles. The owner remains able
--    to perform a documented disaster-recovery repair, but no runtime role
--    can silently delete the proof that bootstrap already happened.
-- ---------------------------------------------------------
create or replace function public.prevent_admin_bootstrap_state_rewrite()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null then
    raise exception using
      errcode = '42501',
      message = 'The administrator bootstrap marker is append-only.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_admin_bootstrap_state_append_only
  on public.admin_bootstrap_state;
create trigger trg_admin_bootstrap_state_append_only
before update or delete on public.admin_bootstrap_state
for each row execute procedure public.prevent_admin_bootstrap_state_rewrite();

revoke all on function public.prevent_admin_bootstrap_state_rewrite() from public;

commit;

notify pgrst, 'reload schema';
