-- =========================================================
-- UCC 2.0 — Phase 1B: global normalized USN uniqueness
-- Date: 2026-10-22
--
-- Forward-only. Intentionally NOT best-effort: if existing profiles
-- share a normalized USN, this migration raises an exception and stops.
-- It never merges profiles, deletes accounts, or reassigns a USN.
--
-- Normalization convention (single source of truth for the invariant):
--
--   upper(btrim(usn))
--
-- The uniqueness domain is every profile with a non-empty USN, regardless
-- of role or member_type. Faculty/admin profiles without a USN, and
-- profiles with NULL/empty USN, remain outside the index. This replaces
-- the old profiles_student_usn_unique index, which stopped protecting a
-- USN as soon as its owner became an alumnus.
--
-- If this migration fails:
--   1. Run supabase/diagnostics/usn_collisions.sql (read-only, masked).
--   2. Resolve each group with the affected people. Never delete or merge
--      accounts automatically. Either set the non-owner's usn to NULL
--      (the legitimate-missing-USN policy) or to the corrected USN.
--   3. Re-run this migration.
--
-- The diagnostic and remediation steps are also documented in
-- docs/ucc2-phase1-runbook.md.
-- =========================================================

-- ---------------------------------------------------------
-- 1. Pre-flight diagnostic (no data modified, no USN printed)
-- ---------------------------------------------------------

do $$
declare
  v_groups int;
  v_rows int;
begin
  select count(*), coalesce(sum(cnt), 0)
  into v_groups, v_rows
  from (
    select upper(btrim(usn)) as usn_norm, count(*) as cnt
    from public.profiles
    where usn is not null and btrim(usn) <> ''
    group by upper(btrim(usn))
    having count(*) > 1
  ) duplicates;

  if v_groups > 0 then
    raise exception using
      message = format(
        'Cannot enforce global USN uniqueness: %s normalized USN value(s) are shared by %s profile(s). No profiles were changed.',
        v_groups,
        v_rows
      ),
      detail = 'Duplicate groups span all member types. Full USNs are deliberately not emitted here.',
      hint = 'Run supabase/diagnostics/usn_collisions.sql, resolve every group with the affected members, then re-run this migration.';
  end if;
end $$;

-- ---------------------------------------------------------
-- 2. Build the global expression index
--
-- Any index left by a partial earlier run is dropped and rebuilt so a
-- stale definition cannot silently satisfy "if not exists". This runs in
-- the same transaction as the rest of the migration, so a failure
-- restores the previous state.
-- ---------------------------------------------------------

do $$
begin
  execute 'drop index if exists public.profiles_usn_normalized_unique';

  execute $sql$
    create unique index profiles_usn_normalized_unique
      on public.profiles ((upper(btrim(usn))))
      where usn is not null and btrim(usn) <> ''
  $sql$;
exception when unique_violation then
  raise exception using
    message = 'Cannot enforce global USN uniqueness: a duplicate USN appeared while building the index. No profiles were changed.',
    hint = 'Run supabase/diagnostics/usn_collisions.sql and resolve the affected profiles, then re-run this migration.';
end $$;

comment on index public.profiles_usn_normalized_unique is
  'UCC 2.0 invariant: upper(btrim(usn)) is unique across all profiles with a non-empty USN, including alumni.';

-- ---------------------------------------------------------
-- 3. Remove the superseded student-only index
--
-- Dropped only after the global index exists. Until that point the old
-- index remains in force.
-- ---------------------------------------------------------

drop index if exists public.profiles_student_usn_unique;

-- ---------------------------------------------------------
-- 4. Reload PostgREST schema cache
-- ---------------------------------------------------------

notify pgrst, 'reload schema';
