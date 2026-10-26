-- =========================================================
-- UCC 2.0 — discussion pin authorization: admins are always allowed
-- Date: 2026-10-23
-- Migration: 2026102302_discussion_pin_admin_authorization.sql
--
-- Why this migration exists
-- -------------------------
-- 2026102301_discussion_pins.sql authorized pin/unpin only through
-- public.is_verified_faculty(auth.uid()). That helper's deployed definition
-- is not guaranteed to treat an administrator as verified: on a database
-- that missed 2026102206_faculty_approval_status_alignment.sql it may only
-- accept role = 'faculty' with an approved/verified status. The result was
-- that public.is_admin(auth.uid()) was never consulted, and an administrator
-- without faculty approval could not pin or unpin.
--
-- The permission rule is now explicit and identical in both RPCs:
--
--   public.is_admin(auth.uid())
--   OR public.is_verified_faculty(auth.uid())
--
-- Admin access is therefore independent of role = 'faculty',
-- faculty_status, or any approved faculty application. This migration does
-- NOT change is_admin(), is_verified_faculty(), profiles, faculty onboarding,
-- or any unrelated policy.
--
-- Rules preserved from 2026102301
-- -------------------------------
--   * at most 3 active pins globally;
--   * every pin expires 7 days after it was created;
--   * expired pins are invisible to the API and do not occupy a slot;
--   * any authorized admin or verified faculty member may unpin any pin;
--   * duplicate pin requests never create a second active row;
--   * the advisory lock serializes the global count, so concurrent requests
--     cannot exceed three;
--   * a rejected pin never silently evicts another pin;
--   * the table is read-only to API roles; mutations run through
--     SECURITY DEFINER functions with a fixed search_path.
--
-- Safety
-- ------
-- * Additive and idempotent: CREATE TABLE/INDEX IF NOT EXISTS,
--   ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE FUNCTION,
--   DROP POLICY IF EXISTS + CREATE POLICY.
-- * Safe to run after 2026102301, or on its own if that migration was never
--   applied to the project. It also repairs a pre-existing discussion_pins
--   table from an earlier partial attempt: CREATE TABLE IF NOT EXISTS does
--   not add columns, so the missing columns and constraints are added
--   explicitly before the partial unique index.
-- * The canonical discussion reference is post_id. A previous partial
--   version used discussion_id, and an earlier repair added that column
--   alongside the deployed post_id. This migration merges any discussion_id
--   value into post_id and drops the duplicate column, so there is exactly
--   one source of truth and the NOT NULL post_id constraint can be honoured.
-- * No pin history is deleted. Older duplicate active rows (if any) are
--   closed by setting unpinned_at; their history is preserved.
-- =========================================================

begin;

-- ---------------------------------------------------------
-- 1. Pin storage (no-op when 2026102301 already ran)
--
-- A row is ACTIVE while:
--   unpinned_at is null AND pin_expires_at > now()
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

-- Repair a table created by an earlier partial version. ADD COLUMN IF NOT
-- EXISTS is a no-op on the canonical table. Every column the RPCs/indexes
-- need is added here, because CREATE TABLE IF NOT EXISTS never alters an
-- existing table.
alter table public.discussion_pins
  add column if not exists id uuid;
alter table public.discussion_pins
  add column if not exists post_id uuid;
alter table public.discussion_pins
  add column if not exists pinned_by uuid;
alter table public.discussion_pins
  add column if not exists pinned_at timestamp with time zone;
alter table public.discussion_pins
  add column if not exists pin_expires_at timestamp with time zone;
alter table public.discussion_pins
  add column if not exists unpinned_at timestamp with time zone;
alter table public.discussion_pins
  add column if not exists unpinned_by uuid;

-- Merge the legacy discussion_id column into post_id and drop it. Dropping
-- the column also drops the old indexes and foreign key that referenced it;
-- those objects are recreated on post_id below.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'discussion_pins'
      and column_name = 'discussion_id'
  ) then
    execute 'update public.discussion_pins
             set post_id = discussion_id
             where post_id is null';
    execute 'alter table public.discussion_pins drop column discussion_id';
  end if;
end $$;

-- Fail with a specific message instead of a generic NOT NULL violation if a
-- legacy row somehow has no discussion reference at all.
do $$
declare
  v_orphans bigint;
begin
  select count(*) into v_orphans
  from public.discussion_pins
  where post_id is null;

  if v_orphans > 0 then
    raise exception
      'Cannot repair discussion_pins: % row(s) have no post_id', v_orphans;
  end if;
end $$;

alter table public.discussion_pins
  alter column post_id set not null;

-- Backfill ids for rows from a table that had no id column, then make the
-- default match the canonical table so pin_discussion() can INSERT ... RETURNING.
update public.discussion_pins
set id = gen_random_uuid()
where id is null;

alter table public.discussion_pins
  alter column id set default gen_random_uuid();
alter table public.discussion_pins
  alter column pinned_at set default timezone('utc'::text, now());
alter table public.discussion_pins
  alter column pin_expires_at set default (timezone('utc'::text, now()) + interval '7 days');

-- Add the named constraints when an earlier table omitted them. NOT VALID
-- keeps the migration safe on old rows; PostgreSQL still enforces the rule
-- for every new insert/update made through the RPC.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.discussion_pins'::regclass
      and conname = 'discussion_pins_expiry_check'
  ) then
    alter table public.discussion_pins
      add constraint discussion_pins_expiry_check
      check (pin_expires_at > pinned_at) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.discussion_pins'::regclass
      and conname = 'discussion_pins_unpin_pair_check'
  ) then
    alter table public.discussion_pins
      add constraint discussion_pins_unpin_pair_check
      check (unpinned_at is not null or unpinned_by is null) not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint c
    join pg_attribute a
      on a.attrelid = c.conrelid
     and a.attnum = any (c.conkey)
    where c.conrelid = 'public.discussion_pins'::regclass
      and c.contype = 'f'
      and a.attname = 'post_id'
  ) then
    alter table public.discussion_pins
      add constraint discussion_pins_post_id_fkey
      foreign key (post_id) references public.posts(id)
      on delete cascade not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.discussion_pins'::regclass
      and conname = 'discussion_pins_pinned_by_fkey'
  ) then
    alter table public.discussion_pins
      add constraint discussion_pins_pinned_by_fkey
      foreign key (pinned_by) references public.profiles(id)
      on delete cascade not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.discussion_pins'::regclass
      and conname = 'discussion_pins_unpinned_by_fkey'
  ) then
    alter table public.discussion_pins
      add constraint discussion_pins_unpinned_by_fkey
      foreign key (unpinned_by) references public.profiles(id)
      on delete set null not valid;
  end if;

  -- Add a primary key only when the old table has none. This avoids
  -- conflicting with an existing key on a different column.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.discussion_pins'::regclass
      and contype = 'p'
  ) then
    alter table public.discussion_pins
      add constraint discussion_pins_pkey primary key (id);
  end if;
end $$;

-- If an older table allowed more than one open row for a discussion, keep
-- the newest and close the rest. This preserves history and lets the partial
-- unique index be created without deleting anything.
with ranked as (
  select
    id,
    row_number() over (
      partition by post_id
      order by pinned_at desc nulls last, id desc
    ) as rn
  from public.discussion_pins
  where unpinned_at is null
)
update public.discussion_pins p
set unpinned_at = timezone('utc'::text, now())
from ranked r
where p.id = r.id
  and r.rn > 1;

create unique index if not exists discussion_pins_one_active_per_discussion
  on public.discussion_pins (post_id)
  where unpinned_at is null;

create index if not exists discussion_pins_active_idx
  on public.discussion_pins (pinned_at desc, pin_expires_at desc)
  where unpinned_at is null;

create index if not exists discussion_pins_post_idx
  on public.discussion_pins (post_id, pinned_at desc);

-- ---------------------------------------------------------
-- 2. Pin an existing discussion
--
-- The earlier partial feature may have installed these RPCs with a different
-- return type (for example void). CREATE OR REPLACE cannot change a return
-- type, so drop the old signatures first. The whole migration runs in one
-- transaction: if anything below fails, the old functions are restored.
--
-- Authorization is the explicit OR below. is_admin() is checked first but
-- both branches are evaluated independently; an admin never needs a faculty
-- role or faculty_status.
-- ---------------------------------------------------------
drop function if exists public.pin_discussion(uuid);
drop function if exists public.unpin_discussion(uuid);

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
  -- one-active-row index. No background job is required.
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
  -- pin's global count.
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
-- API roles may read active pins but never write them directly. Only
-- signed-in members can call the SECURITY DEFINER mutation path; anon cannot.
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
-- unpinned rows stay private. No write policies exist, so direct writes are
-- denied even if a grant drifts in the future.
-- ---------------------------------------------------------
alter table public.discussion_pins enable row level security;

drop policy if exists "Active discussion pins are viewable by everyone"
  on public.discussion_pins;
create policy "Active discussion pins are viewable by everyone"
  on public.discussion_pins
  for select
  using (unpinned_at is null and pin_expires_at > now());

-- Make the new function definitions visible to PostgREST immediately.
notify pgrst, 'reload schema';

commit;
