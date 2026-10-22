-- =========================================================
-- Disposable PostgreSQL 16 stub for the Supabase runtime
--
-- Part of the UCC 2.0 local rehearsal harness
-- (supabase/local-rehearsal/run-rehearsal.sh).
--
-- Re-creates the minimum Supabase surface the UCC 2.0 migrations
-- depend on: the `auth` schema, `auth.users`, `auth.uid()`, and the
-- `anon` / `authenticated` / `service_role` roles with table grants.
--
-- The auth.users definition mirrors the hosted Supabase schema
-- (supabase/postgres migrations/schema-17.sql plus the supabase/auth
-- service migrations) closely enough to catch hosted incompatibilities
-- locally:
--   * `id` is NOT NULL with NO DEFAULT -> a fixture that omits it fails
--     here exactly as it would on a hosted project.
--   * `confirmed_at` is a GENERATED column -> it cannot be inserted
--     into directly, same as hosted.
--   * `email_confirmed_at` exists (upstream renamed confirmed_at to it).
--   * RLS is ENABLED on auth.users with no policy, same as hosted. The
--     session role must therefore be a BYPASSRLS role (hosted `postgres`),
--     exactly the condition the smoke-test precondition probe checks.
--
-- This mirrors Supabase's PostgREST privilege model: the API roles get
-- broad table privileges and are constrained by RLS, exactly as they
-- are on a hosted project. It is a rehearsal harness, not a security
-- boundary — never point it at anything real.
-- =========================================================

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;

create schema if not exists auth;

-- Hosted-shaped auth.users.
create table if not exists auth.users (
  instance_id uuid,
  id uuid not null,
  aud varchar(255),
  "role" varchar(255),
  email varchar(255),
  encrypted_password varchar(255),
  email_confirmed_at timestamptz,
  confirmed_at timestamptz generated always as
    (least(email_confirmed_at, phone_confirmed_at)) stored,
  invited_at timestamptz,
  confirmation_token varchar(255),
  confirmation_sent_at timestamptz,
  recovery_token varchar(255),
  recovery_sent_at timestamptz,
  email_change_token_new varchar(255),
  email_change varchar(255),
  email_change_sent_at timestamptz,
  last_sign_in_at timestamptz,
  raw_app_meta_data jsonb,
  raw_user_meta_data jsonb,
  is_super_admin boolean,
  created_at timestamptz,
  updated_at timestamptz,
  phone varchar(15),
  phone_confirmed_at timestamptz,
  phone_change varchar(15) default '',
  phone_change_token varchar(255) default '',
  phone_change_sent_at timestamptz,
  email_change_token_current varchar(255) default '',
  email_change_confirm_status varchar(255) default '',
  email_change_confirm_current varchar(255) default '',
  email_change_reconfirm_status varchar(255) default '',
  banned_until timestamptz,
  reauthentication_token varchar(255) default '',
  reauthentication_sent_at timestamptz,
  is_sso_user boolean not null default false,
  deleted_at timestamptz,
  is_anonymous boolean not null default false,
  constraint users_pkey primary key (id)
);

create unique index if not exists users_email_key on auth.users (email);

-- Hosted enables RLS on auth.users (supabase/auth migration
-- 20240612123726_enable_rls_update_grants). No policy is granted to the
-- session role here: only a BYPASSRLS role (hosted `postgres`) can write.
alter table auth.users enable row level security;

-- Faithful to Supabase: reads the 'sub' claim out of request.jwt.claims
-- (supabase/auth migration 20211202183645_update_auth_uid).
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
    ),
    ''
  )::uuid
$$;

-- Supabase ships a logical replication publication; the consolidated
-- schema.sql attaches tables to it.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

grant usage on schema auth to anon, authenticated, service_role;

grant usage on schema public to anon, authenticated, service_role;

-- Supabase grants the API roles broad table privileges and relies on RLS.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
