-- =========================================================
-- UCC — ONE-TIME initial administrator bootstrap
--
-- Run this file ONCE, as the database owner, in the Supabase SQL Editor (or
-- with a direct owner psql connection), after applying:
--   2026102208_single_admin_succession.sql
--   2026102209_admin_bootstrap.sql
--
-- This file is NOT a migration on purpose: `supabase db push` must never
-- promote an account. It is an explicit operator action.
--
-- What it does, atomically:
--   1. Resolves the account by its verified Supabase identity (auth.users.id),
--      not by trusting a client-supplied role.
--   2. Re-checks that the linked profile is role = 'faculty' and
--      faculty_status = 'approved'. If not, it stops and changes nothing.
--   3. Refuses if any administrator already exists.
--   4. Refuses if the one-time marker was already written.
--   5. Promotes that profile to 'admin' and writes an admin_audit_log row.
--   6. Writes the permanent bootstrap marker, disabling all later runs.
--
-- There is no stored function and no API route left behind. Re-running this
-- file fails on the marker or on the existing administrator.
--
-- IMPORTANT: the account named below is the *input* to this one request, not
-- an authorization rule. No policy, trigger or application code treats this
-- email as an administrator. If the eligibility check fails, STOP and report;
-- do not edit this email to a different account.
-- =========================================================

do $bootstrap$
declare
  -- Operator input for this single bootstrap request.
  c_target_email constant text := 'demo@gmail.com';
  c_reason constant text :=
    'One-time initial administrator bootstrap: verified approved faculty account.';

  v_target_id uuid;
  v_auth_matches int;
  v_profile public.profiles%rowtype;
  v_admin_count int;
  v_operator text := session_user;
  v_now timestamptz := timezone('utc'::text, now());
begin
  -- A SQL Editor / owner connection has no end-user JWT. A signed-in browser
  -- session always does, even if it has somehow reached an owner connection.
  if auth.uid() is not null then
    raise exception using
      errcode = '42501',
      message = 'The initial administrator bootstrap is an owner-only operation.',
      hint = 'Run it in the Supabase SQL Editor or a direct owner connection. Do not expose it through the API.';
  end if;

  -- Serialise concurrent operator attempts. The marker and the single-admin
  -- unique index are the durable guards; this lock only avoids confusing
  -- races between two simultaneous SQL Editor tabs.
  perform pg_advisory_xact_lock(hashtext('ucc.admin_bootstrap'));

  if exists (select 1 from public.admin_bootstrap_state) then
    raise exception using
      errcode = 'P0001',
      message = 'The initial administrator bootstrap has already been completed.',
      hint = 'It is permanently disabled. Use the Phase 11 nomination/acceptance process for any later transfer.';
  end if;

  -- Resolve the verified database identity. The email is only a locator; the
  -- authorization decision below uses the profile linked to auth.users.id.
  select count(*), (array_agg(u.id))[1]
    into v_auth_matches, v_target_id
  from auth.users u
  where lower(btrim(u.email)) = lower(c_target_email);

  if v_auth_matches <> 1 then
    raise exception using
      errcode = 'P0002',
      message = format(
        'Expected exactly one Supabase Auth account for %s, found %s.',
        c_target_email, v_auth_matches
      ),
      hint = 'Stop. Do not substitute another account. Report the mismatch to the operator.';
  end if;

  select p.* into v_profile
  from public.profiles p
  where p.id = v_target_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = format('No profile is linked to the Auth account for %s.', c_target_email),
      hint = 'Stop. Do not create or promote a different account automatically.';
  end if;

  if v_profile.role is distinct from 'faculty'
     or v_profile.faculty_status is distinct from 'approved' then
    raise exception using
      errcode = '42501',
      message = format(
        'Bootstrap refused: %s has role=%s and faculty_status=%s; both role=faculty and faculty_status=approved are required.',
        c_target_email, v_profile.role, v_profile.faculty_status
      ),
      hint = 'Stop and report. Nothing was changed. Do not promote another account automatically.';
  end if;

  select count(*) into v_admin_count
  from public.profiles
  where role = 'admin';

  if v_admin_count > 0 then
    raise exception using
      errcode = 'P0001',
      message = 'Bootstrap refused: an administrator already exists.',
      hint = 'The initial bootstrap cannot create a second administrator. Use Phase 11 succession instead.';
  end if;

  -- Transaction-local switch understood only by the Phase 11 triggers. It is
  -- set here, inside the operator transaction, and cleared at commit.
  perform set_config('ucc.admin_transition', 'on', true);

  update public.profiles
  set role = 'admin',
      -- An approved faculty profile is already a faculty member. This keeps
      -- the Phase 11 admin invariant explicit for legacy rows.
      member_type = 'faculty',
      faculty_status = 'approved',
      updated_at = v_now
  where id = v_target_id;

  insert into public.admin_bootstrap_state (
    completed_by, target_id, target_email, completed_at, detail
  ) values (
    v_operator, v_target_id, lower(c_target_email), v_now, c_reason
  );

  insert into public.admin_audit_log (
    action, actor_id, actor_name, target_id, target_name,
    outcome, detail, metadata, created_at
  ) values (
    'bootstrap',
    null,
    format('operator (%s)', v_operator),
    v_target_id,
    v_profile.name,
    'completed',
    c_reason,
    jsonb_build_object(
      'method', 'one-time database-owner bootstrap',
      'target_email', lower(c_target_email),
      'verified_role', v_profile.role,
      'verified_faculty_status', v_profile.faculty_status,
      'operator', v_operator
    ),
    v_now
  );

  raise notice 'Bootstrap complete: % (%) is now the initial administrator.',
    v_profile.name, v_target_id;
end;
$bootstrap$;
