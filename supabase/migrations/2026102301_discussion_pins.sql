-- =========================================================
-- UCC 2.0 — verified faculty discussion pinning
-- Date: 2026-10-23
-- Migration: 2026102301_discussion_pins.sql
--
-- Why this migration exists
-- -------------------------
-- The community feed needs a small, faculty-controlled set of pinned
-- discussions. The rules are deliberately narrow:
--   * any verified faculty member may pin any discussion, including one
--     written by somebody else;
--   * at most 3 pins are active across the whole community at once;
--   * every pin lasts exactly 7 days and expires by query logic, with no
--     scheduled cleanup job;
--   * re-pinning an expired discussion starts a new 7-day period;
--   * unpinning immediately frees a slot.
--
-- Why a dedicated table
-- ---------------------
-- public.posts is the existing discussions table (type = 'discussion').
-- Adding pinned_at/pin_expires_at columns to posts would only allow one
-- historical pin per discussion and would mix pin lifecycle with content.
-- A separate table keeps the discussion row untouched, preserves history
-- (unpinned/expired rows remain), and lets a partial unique index enforce
-- one active pin per discussion.
--
-- Concurrency
-- -----------
-- pin_discussion() takes a transaction-scoped advisory lock before it
-- counts active pins. Concurrent pin calls therefore serialize: the first
-- three commit, every later caller re-reads the count and is rejected. A
-- plain count-then-insert without the lock could let two callers both see
-- two active pins and both insert a third and fourth row.
--
-- Security
-- --------
-- * RLS is enabled. Everyone who can read discussions can read ACTIVE pin
--   information; expired and unpinned rows are not visible through the API.
-- * There are no INSERT/UPDATE/DELETE policies and write privileges are
--   revoked from anon/authenticated, so the table cannot be mutated
--   directly by a student (or any client).
-- * Mutations go through SECURITY DEFINER functions that re-check
--   public.is_admin(auth.uid()) OR public.is_verified_faculty(auth.uid())
--   and take pinned_by from auth.uid(), never from a client argument.
-- * No service-role key is involved.
--
-- Safety
-- ------
-- * Additive only: no existing table, row, policy or grant is changed.
-- * Idempotent: CREATE TABLE/INDEX IF NOT EXISTS, CREATE OR REPLACE
--   FUNCTION, DROP POLICY IF EXISTS + CREATE POLICY.
-- * The table is new, so existing discussions/comments/reactions/authors
--   are untouched.
-- =========================================================

begin;

-- ---------------------------------------------------------
-- 1. Pin records
--
-- A row is ACTIVE while:
--   unpinned_at is null AND pin_expires_at > now()
-- Expired rows stay in the table as history but never appear in the feed
-- and never count toward the 3-pin limit.
-- ---------------------------------------------------------
create table if not exists public.discussion_pins (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  pinned_by uuid not null references public.profiles(id) on delete cascade,
  pinned_at timestamp with time zone not null default timezone('utc'::text, now()),
  pin_expires_at timestamp with time zone not null
    default (timezone('utc'::text, now()) + interval '7 days'),
  unpinned_at timestamp with time zone,
  unpinned_by uuid references public.profiles(id) on delete set null,
  constraint discussion_pins_expiry_check
    check (pin_expires_at > pinned_at),
  constraint discussion_pins_unpin_pair_check
    check (unpinned_at is not null or unpinned_by is null)
);

-- At most one active pin row per discussion. Expired rows are closed by
-- pin_discussion() before a re-pin, so they cannot block a new period.
-- The predicate cannot include now() (not immutable), so expiry is handled
-- by the function and by the active queries.
create unique index if not exists discussion_pins_one_active_per_discussion
  on public.discussion_pins (post_id)
  where unpinned_at is null;

-- Feed query: active rows newest-first. The partial predicate keeps the
-- index small as pin history grows.
create index if not exists discussion_pins_active_idx
  on public.discussion_pins (pinned_at desc, pin_expires_at desc)
  where unpinned_at is null;

create index if not exists discussion_pins_post_idx
  on public.discussion_pins (post_id, pinned_at desc);

-- ---------------------------------------------------------
-- 2. Pin an existing discussion
-- ---------------------------------------------------------
create or replace function public.pin_discussion(p_discussion_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamp with time zone := timezone('utc'::text, now());
  v_discussion public.posts%rowtype;
  v_pin_id uuid;
  v_active_count integer;
begin
  if v_uid is null
     or not (
       public.is_admin(v_uid)
       or public.is_verified_faculty(v_uid)
     ) then
    raise exception 'Only admins and verified faculty can pin or unpin discussions.'
      using errcode = '42501';
  end if;

  if p_discussion_id is null then
    raise exception 'A discussion id is required.' using errcode = '22023';
  end if;

  -- Serialize the global slot check. Transaction-scoped: released on
  -- commit/rollback, including when an exception is raised below.
  perform pg_advisory_xact_lock(2026102301::bigint);

  select *
    into v_discussion
  from public.posts
  where id = p_discussion_id;

  if not found then
    raise exception 'Discussion not found.' using errcode = 'P0002';
  end if;

  if v_discussion.type is distinct from 'discussion' then
    raise exception 'Only discussions can be pinned.' using errcode = '22023';
  end if;

  -- Close an expired pin for this discussion so it cannot block the
  -- one-active-row index. This is the only automatic state transition;
  -- no background job is required.
  update public.discussion_pins
  set unpinned_at = v_now
  where post_id = p_discussion_id
    and unpinned_at is null
    and pin_expires_at <= v_now;

  if exists (
    select 1
    from public.discussion_pins
    where post_id = p_discussion_id
      and unpinned_at is null
      and pin_expires_at > v_now
  ) then
    raise exception 'This discussion is already pinned.' using errcode = '23505';
  end if;

  select count(*)
    into v_active_count
  from public.discussion_pins
  where unpinned_at is null
    and pin_expires_at > v_now;

  if v_active_count >= 3 then
    raise exception
      'The community already has 3 active pinned discussions. Wait for a pin to expire or unpin one first.'
      using errcode = '23514';
  end if;

  insert into public.discussion_pins (
    post_id,
    pinned_by,
    pinned_at,
    pin_expires_at
  )
  values (
    p_discussion_id,
    v_uid,
    v_now,
    v_now + interval '7 days'
  )
  returning id into v_pin_id;

  return v_pin_id;
end;
$$;

-- ---------------------------------------------------------
-- 3. Unpin a discussion
-- ---------------------------------------------------------
create or replace function public.unpin_discussion(p_discussion_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamp with time zone := timezone('utc'::text, now());
  v_pin_id uuid;
begin
  if v_uid is null
     or not (
       public.is_admin(v_uid)
       or public.is_verified_faculty(v_uid)
     ) then
    raise exception 'Only admins and verified faculty can pin or unpin discussions.'
      using errcode = '42501';
  end if;

  if p_discussion_id is null then
    raise exception 'A discussion id is required.' using errcode = '22023';
  end if;

  -- Same lock as pin_discussion(), so an unpin cannot interleave with a
  -- pin's count and produce a misleading limit rejection.
  perform pg_advisory_xact_lock(2026102301::bigint);

  update public.discussion_pins
  set
    unpinned_at = v_now,
    unpinned_by = v_uid
  where post_id = p_discussion_id
    and unpinned_at is null
    and pin_expires_at > v_now
  returning id into v_pin_id;

  if v_pin_id is null then
    if exists (
      select 1
      from public.discussion_pins
      where post_id = p_discussion_id
        and unpinned_at is null
        and pin_expires_at <= v_now
    ) then
      raise exception 'This pin has already expired.' using errcode = 'P0002';
    end if;

    raise exception 'This discussion is not pinned.' using errcode = 'P0002';
  end if;

  return v_pin_id;
end;
$$;

-- ---------------------------------------------------------
-- 4. Privileges
--
-- The API roles may read active pins but never write them directly.
-- SECURITY DEFINER functions run as the owner and are the only mutation
-- path. EXECUTE is granted only to signed-in members; anon cannot call it.
-- ---------------------------------------------------------
revoke all on public.discussion_pins from anon, authenticated;
grant select on public.discussion_pins to anon, authenticated;

revoke all on function public.pin_discussion(uuid) from public;
revoke all on function public.pin_discussion(uuid) from anon;
revoke all on function public.pin_discussion(uuid) from authenticated;
grant execute on function public.pin_discussion(uuid) to authenticated;

revoke all on function public.unpin_discussion(uuid) from public;
revoke all on function public.unpin_discussion(uuid) from anon;
revoke all on function public.unpin_discussion(uuid) from authenticated;
grant execute on function public.unpin_discussion(uuid) to authenticated;

-- ---------------------------------------------------------
-- 5. Row Level Security
--
-- Everyone who can read discussions can read ACTIVE pins. Expired and
-- unpinned rows are invisible through PostgREST, which makes expiration
-- effective without any cleanup job. There are deliberately no write
-- policies: direct writes are denied even if a future grant drifts.
-- ---------------------------------------------------------
alter table public.discussion_pins enable row level security;

drop policy if exists "Active discussion pins are viewable by everyone"
  on public.discussion_pins;
create policy "Active discussion pins are viewable by everyone"
  on public.discussion_pins
  for select
  using (unpinned_at is null and pin_expires_at > now());

notify pgrst, 'reload schema';

commit;
