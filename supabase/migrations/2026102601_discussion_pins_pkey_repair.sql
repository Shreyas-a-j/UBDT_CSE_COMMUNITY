-- =========================================================
-- UCC 2.0 — repair the discussion_pins primary key
-- Date: 2026-10-26
-- Migration: 2026102601_discussion_pins_pkey_repair.sql
--
-- Why this migration exists
-- -------------------------
-- The reported error:
--
--   duplicate key value violates unique constraint "discussion_pins_pkey"
--
-- is not an active-duplicate bug. A pre-2026102302 partial deployment of
-- public.discussion_pins created PRIMARY KEY (post_id) instead of the
-- canonical PRIMARY KEY (id). 2026102302 deliberately only adds a primary
-- key "when the old table has none ... to avoid conflicting with an existing
-- key on a different column", so a legacy key on post_id survives that
-- migration.
--
-- Because unpin/expiry keeps the history row (unpinned_at is set), re-pinning
-- the same discussion inserts a new row with the same post_id. The partial
-- unique index correctly allows that (the old row is inactive), but the
-- legacy primary key on post_id rejects it with the reported pkey error.
--
-- What this migration does
-- ------------------------
-- 1. Ensures the surrogate `id` exists, is backfilled for legacy rows, and
--    defaults to gen_random_uuid().
-- 2. Drops a primary key only when it is not exactly (id). A canonical
--    PRIMARY KEY (id) is left untouched; this migration is safe to re-run.
-- 3. Adds PRIMARY KEY (id) when no primary key exists.
-- 4. Re-asserts the partial unique index that allows at most one ACTIVE pin
--    per discussion while preserving unlimited history.
--
-- Safety
-- ------
-- * No rows are deleted. Pin history is preserved; only the key definition
--   changes.
-- * Duplicate ids (possible only on a pre-PK table) are given fresh UUIDs;
--   no foreign key references discussion_pins.id.
-- * The function bodies, privileges and RLS policies are unchanged.
-- * If public.discussion_pins is missing entirely the migration stops with a
--   clear message instead of silently doing nothing.
-- =========================================================

begin;

do $$
begin
  if to_regclass('public.discussion_pins') is null then
    raise exception
      'public.discussion_pins is missing; apply 2026102301/2026102302 first';
  end if;
end $$;

-- 1. Surrogate key: column, backfill, duplicate repair, default, NOT NULL.
alter table public.discussion_pins add column if not exists id uuid;

update public.discussion_pins
set id = gen_random_uuid()
where id is null;

with ranked as (
  select ctid, row_number() over (partition by id order by ctid) as rn
  from public.discussion_pins
)
update public.discussion_pins p
set id = gen_random_uuid()
from ranked r
where p.ctid = r.ctid
  and r.rn > 1;

alter table public.discussion_pins alter column id set default gen_random_uuid();
alter table public.discussion_pins alter column id set not null;

-- 2. Drop a primary key that is not exactly (id). This is the repair for the
--    legacy PRIMARY KEY (post_id) shape.
do $$
declare
  v_conname text;
  v_cols text[];
begin
  select c.conname, array_agg(a.attname order by k.ord)
    into v_conname, v_cols
  from pg_constraint c
  cross join lateral unnest(c.conkey) with ordinality as k(attnum, ord)
  join pg_attribute a
    on a.attrelid = c.conrelid
   and a.attnum = k.attnum
  where c.conrelid = 'public.discussion_pins'::regclass
    and c.contype = 'p'
  group by c.conname;

  if v_conname is not null and v_cols is distinct from array['id'] then
    execute format(
      'alter table public.discussion_pins drop constraint %I',
      v_conname
    );
  end if;
end $$;

-- 3. Canonical primary key.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.discussion_pins'::regclass
      and contype = 'p'
  ) then
    alter table public.discussion_pins
      add constraint discussion_pins_pkey primary key (id);
  end if;
end $$;

-- 4. One ACTIVE pin per discussion; history rows are unlimited.
create unique index if not exists discussion_pins_one_active_per_discussion
  on public.discussion_pins (post_id)
  where unpinned_at is null;

comment on column public.discussion_pins.id is
  'Surrogate primary key. History rows (unpinned/expired) are retained.';

notify pgrst, 'reload schema';

commit;
