-- =========================================================
-- Discussion pins — legacy primary-key repair regression
--
-- Reproduces the deployed failure
--   duplicate key value violates unique constraint "discussion_pins_pkey"
-- by simulating the pre-2026102302 shape PRIMARY KEY (post_id), then applies
-- supabase/migrations/2026102601_discussion_pins_pkey_repair.sql and proves:
--   * the primary key becomes exactly (id) with a gen_random_uuid() default;
--   * the partial active-pin unique index still exists;
--   * pin -> duplicate (controlled) -> unpin -> re-pin all work;
--   * historical rows are preserved (nothing is deleted).
--
-- Run after auth-stub.sql + schema.sql (or the full migration chain):
--
--   psql ... -v ON_ERROR_STOP=1 \
--     -v repair_file=/tmp/2026102601_discussion_pins_pkey_repair.sql \
--     -f supabase/test-discussion-pins-legacy-pkey.sql
--
-- When run from the repository root the default repair_file path below works.
-- =========================================================

\set ON_ERROR_STOP 1

\if :{?repair_file}
\else
  \set repair_file 'supabase/migrations/2026102601_discussion_pins_pkey_repair.sql'
\endif

\echo '============================================'
\echo 'Discussion pins — legacy PK repair regression'
\echo '============================================'

create extension if not exists pgcrypto;

-- ---------------------------------------------------------
-- Fixtures (self-contained; no dependency on other test files)
-- ---------------------------------------------------------
-- Test-only reset: a legacy PRIMARY KEY (post_id) cannot exist over multiple
-- history rows for one post, so this disposable-DB test starts from an empty
-- pin table. The repair migration itself NEVER deletes pin history.
delete from public.discussion_pins;
delete from public.posts where title like 'PinRepairTest %';
delete from public.profiles where email = 'pinrepair-faculty@example.com';
delete from auth.users where email = 'pinrepair-faculty@example.com';

insert into auth.users (
  id, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at
) values (
  gen_random_uuid(), 'pinrepair-faculty@example.com', 'x', now(),
  '{"name":"PinRepair Faculty","intent":"student"}'::jsonb, now(), now()
);

alter table public.profiles disable trigger trg_protect_profile_privileges;
update public.profiles
set role = 'faculty', faculty_status = 'approved', member_type = 'faculty'
where email = 'pinrepair-faculty@example.com';
alter table public.profiles enable trigger trg_protect_profile_privileges;

insert into public.posts (author_id, type, title, body)
select id, 'discussion', 'PinRepairTest discussion', 'body'
from public.profiles where email = 'pinrepair-faculty@example.com';

select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (select id from public.profiles where email = 'pinrepair-faculty@example.com'),
    'role', 'authenticated'
  )::text,
  false
);

-- ---------------------------------------------------------
-- 1. Simulate the legacy deployed shape and reproduce the error
-- ---------------------------------------------------------
alter table public.discussion_pins drop constraint if exists discussion_pins_pkey;
alter table public.discussion_pins
  add constraint discussion_pins_pkey primary key (post_id);

do $$
declare
  v_post uuid;
begin
  select id into v_post from public.posts where title = 'PinRepairTest discussion';
  perform public.pin_discussion(v_post);
  perform public.unpin_discussion(v_post);
end $$;

do $$
declare
  v_post uuid;
  v_msg text;
begin
  select id into v_post from public.posts where title = 'PinRepairTest discussion';
  begin
    perform public.pin_discussion(v_post);
  exception when others then
    v_msg := sqlerrm;
  end;

  if v_msg is null then
    raise exception 'FAIL: legacy PRIMARY KEY (post_id) did not reject the re-pin';
  end if;
  if position('discussion_pins_pkey' in v_msg) = 0 then
    raise exception 'FAIL: expected discussion_pins_pkey, got "%"', v_msg;
  end if;
  raise notice 'PASS L0: legacy PK reproduces "discussion_pins_pkey" on re-pin';
end $$;

-- ---------------------------------------------------------
-- 2. Apply the repair migration
-- ---------------------------------------------------------
\echo 'Applying :repair_file'
\i :repair_file

-- ---------------------------------------------------------
-- 3. Structural assertions
-- ---------------------------------------------------------
do $$
declare
  v_def text;
  v_default text;
begin
  select pg_get_constraintdef(oid) into v_def
  from pg_constraint
  where conrelid = 'public.discussion_pins'::regclass and contype = 'p';

  if v_def is distinct from 'PRIMARY KEY (id)' then
    raise exception 'FAIL: primary key is "%", expected PRIMARY KEY (id)', v_def;
  end if;

  select column_default into v_default
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'discussion_pins'
    and column_name = 'id';

  if v_default is null or position('gen_random_uuid' in v_default) = 0 then
    raise exception 'FAIL: id default is "%"', v_default;
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'discussion_pins'
      and indexname = 'discussion_pins_one_active_per_discussion'
  ) then
    raise exception 'FAIL: active-pin partial unique index is missing';
  end if;

  raise notice 'PASS L1: PK is (id), default is gen_random_uuid(), active index present';
end $$;

-- Idempotency: running the repair again must be a no-op.
\i :repair_file

do $$
declare
  v_def text;
begin
  select pg_get_constraintdef(oid) into v_def
  from pg_constraint
  where conrelid = 'public.discussion_pins'::regclass and contype = 'p';
  if v_def is distinct from 'PRIMARY KEY (id)' then
    raise exception 'FAIL: re-running the repair changed the PK to "%"', v_def;
  end if;
  raise notice 'PASS L2: repair is idempotent';
end $$;

-- ---------------------------------------------------------
-- 4. Behaviour after repair
-- ---------------------------------------------------------
do $$
declare
  v_post uuid;
  v_msg text;
  v_total int;
  v_active int;
begin
  select id into v_post from public.posts where title = 'PinRepairTest discussion';

  -- The re-pin that previously failed now succeeds.
  perform public.pin_discussion(v_post);

  -- A second pin while active is a controlled, meaningful error.
  begin
    perform public.pin_discussion(v_post);
  exception when others then
    v_msg := sqlerrm;
  end;
  if v_msg is null or position('already pinned' in lower(v_msg)) = 0 then
    raise exception 'FAIL: duplicate pin was not controlled (got "%")', coalesce(v_msg, 'no error');
  end if;

  -- Unpin and re-pin again: the original reported workflow.
  perform public.unpin_discussion(v_post);
  perform public.pin_discussion(v_post);

  select count(*), count(*) filter (where unpinned_at is null)
    into v_total, v_active
  from public.discussion_pins
  where post_id = v_post;

  if v_active <> 1 then
    raise exception 'FAIL: expected 1 active row, found %', v_active;
  end if;
  if v_total < 3 then
    raise exception 'FAIL: expected preserved history (>=3 rows), found %', v_total;
  end if;

  raise notice 'PASS L3: re-pin works, duplicate controlled, % history rows preserved (1 active)', v_total;
end $$;

\echo 'Legacy pkey repair regression: PASS'
