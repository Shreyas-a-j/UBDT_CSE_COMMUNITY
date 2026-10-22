#!/usr/bin/env bash
# =========================================================
# UCC 2.0 — clean disposable PostgreSQL 16 rehearsal
#
# Drives the REAL Supabase CLI against the CANONICAL migration files in
# supabase/migrations/. It NEVER touches a hosted project.
#
#   1. fresh container
#   2. Supabase stub
#   3. pre-Phase-1 consolidated baseline (the shape production has today)
#   4. seed live-shaped profile data
#   5. supabase db push --dry-run  -> must list the canonical files
#   6. supabase db push            -> applies them via the CLI
#   7. ledger check                -> one row per canonical migration, in order
#   8. supabase db push            -> must report "up to date"
#   9. supabase/verify_schema.sql
#  10. supabase/test-ucc2-phase1.sql
#  11. supabase/test-faculty-onboarding.sql
#  12. negative controls (both must FAIL with the expected message)
#  13. residue check
#
# Requires: docker, a POSIX shell, and the Supabase CLI.
# Usage:    bash supabase/local-rehearsal/run-rehearsal.sh
# Exit 0 = rehearsal passed.
# =========================================================
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CTR="${CTR:-ucc2-rehearsal-$$}"
PORT="${PORT:-$(( 20000 + ($$ % 20000) ))}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/ucc2-rehearsal.XXXXXX")"
PG="docker exec -i $CTR psql -v ON_ERROR_STOP=1 -U postgres -d ucc2"
DBURL="postgresql://postgres:ucc2@127.0.0.1:$PORT/ucc2?sslmode=disable"

# The canonical chain, in dependency order. These are the file names the
# CLI reads straight out of supabase/migrations/ — no copies, no renames.
CANONICAL=(
  2026101301_network_and_faculty
  2026101302_network_fixes
  2026101303_usn_unique_and_columns
  2026101401_auth_profile_provisioning
  2026101402_faculty_applications
  2026102001_delete_policies
  2026102201_member_identity_and_contacts
  2026102202_notification_targeting_and_visits
  2026102203_global_usn_uniqueness
  2026102204_duplicate_usn_signup_guard
  2026102205_announcement_images_and_reactions
  2026102206_faculty_approval_status_alignment
  2026102207_secure_faculty_onboarding
  2026102208_single_admin_succession
  2026102209_admin_bootstrap
  2026102210_admin_role_check_alignment
  2026102211_signup_provisioning_schema_alignment
  2026102212_faculty_visibility_and_email_verification
)

FAIL=0
step() { printf '\n\033[1m>>> %s\033[0m\n' "$1"; }
note() { printf '    %s\n' "$1"; }
ok()   { printf '    \033[32mok\033[0m  %s\n' "$1"; }
bad()  { printf '    \033[31m*** %s ***\033[0m\n' "$1"; FAIL=1; }
expect_fail() { # $1=outfile $2=expected message fragment
  if grep -qF "$2" "$1"; then
    printf '    \033[32mok\033[0m  negative control failed as intended: %s\n' "$2"
  else
    bad "NEGATIVE CONTROL DID NOT TRIP (expected: $2)"
  fi
}
# One scalar per line, trimmed. psql -t -A is unaligned, but trim the ends
# anyway so a stray newline or padding can never break a comparison.
q() { $PG -t -A -c "$1" 2>/dev/null | sed 's/^[[:space:]]*//; s/[[:space:]]*$//' | grep -v '^$'; }

cleanup() {
  # Shut postgres down cleanly FIRST. Some Docker setups refuse to KILL a
  # container ("could not kill container: permission denied"), but a clean
  # postgres shutdown lets `docker rm` succeed without needing a kill.
  docker exec -u postgres "$CTR" pg_ctl -D /var/lib/postgresql/data -m fast stop >/dev/null 2>&1
  if ! docker rm -f "$CTR" >/dev/null 2>&1; then
    printf '\n[warning] could not remove container %s — remove it manually: docker rm -f %s\n' "$CTR" "$CTR"
  fi
}
trap cleanup EXIT

# ----------------------------------------------------------------- CLI
CLI="${SUPABASE_CLI:-$(command -v supabase 2>/dev/null || true)}"
if [ -z "$CLI" ] || [ ! -x "$CLI" ]; then
  for cand in "$HOME"/.nvm/versions/node/*/bin/supabase /usr/local/bin/supabase; do
    [ -x "$cand" ] && { CLI="$cand"; break; }
  done
fi
if [ -z "$CLI" ] || [ ! -x "$CLI" ]; then
  echo "Supabase CLI not found. Install it, or set SUPABASE_CLI=/path/to/supabase."; exit 1
fi

step "0. tooling"
note "supabase CLI: $CLI ($("$CLI" --version))"
note "container: $CTR on port $PORT"

# ---------------------------------------------------------- 1. container
step "1. fresh disposable PostgreSQL 16 instance"
docker run -d --name "$CTR" -e POSTGRES_PASSWORD=ucc2 -e POSTGRES_DB=ucc2 \
  -p "$PORT":5432 postgres:16 >/dev/null 2>&1 \
  || { echo "cannot start container '$CTR' (port $PORT may be in use)"; exit 1; }
for _ in $(seq 1 60); do docker exec "$CTR" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
$PG -c "select version();" | sed -n '3p' | sed 's/^/    /'

# -------------------------------------------------------------- 2. stub
step "2. Supabase stub (hosted-shaped auth.users, RLS enabled, no id default)"
$PG -q < "$REPO/supabase/local-rehearsal/auth-stub.sql" >/dev/null 2>&1 \
  || { echo "STUB FAILED"; $PG < "$REPO/supabase/local-rehearsal/auth-stub.sql"; exit 1; }
ok "stub applied"

# ---------------------------------------------------------- 3. baseline
step "3. pre-Phase-1 consolidated baseline (production's current shape)"
# The baseline migrations are PATCHES on top of the consolidated schema:
# 2026101301_network_and_faculty.sql assumes public.events already exists,
# so the chain cannot be replayed from an empty database on its own.
# If the working-tree schema.sql already contains the Phase 1 objects, fall
# back to the last committed revision, which is the pre-Phase-1 baseline.
if grep -q 'member_type' "$REPO/supabase/schema.sql"; then
  git -C "$REPO" show HEAD:supabase/schema.sql > "$WORK/schema_baseline.sql" 2>/dev/null \
    || { echo "cannot read the pre-Phase-1 baseline from git"; exit 1; }
  note "baseline: git HEAD:supabase/schema.sql (working tree already contains Phase 1)"
else
  cp "$REPO/supabase/schema.sql" "$WORK/schema_baseline.sql"
  note "baseline: supabase/schema.sql"
fi
if grep -qE 'member_type|profile_contacts|content_visits|dedupe_key' "$WORK/schema_baseline.sql"; then
  bad "resolved baseline contains Phase 1 objects — it is not the pre-Phase-1 baseline"
  exit 1
fi
out=$($PG < "$WORK/schema_baseline.sql" 2>&1) || { echo "FAILED: baseline schema"; echo "$out" | tail -25; exit 1; }
ok "baseline applied"

# -------------------------------------------------------------- 4. seed
step "4. seed live-shaped profile data (11 profiles / 10 USNs / 0 collisions)"
# profiles.id references auth.users(id), so every seeded profile needs a
# backing auth user.
$PG -q >/dev/null 2>&1 <<'SQL'
insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
select gen_random_uuid(), 'seed' || g || '@example.com', encode(gen_random_bytes(16), 'base64'),
       now(), '{}'::jsonb, now(), now()
from generate_series(1, 11) g;
insert into public.profiles (id, email, name, usn, year, branch, role, faculty_status, member_type, created_at)
select u.id, 'seed' || g || '@example.com', 'Seed Member ' || g,
       case when g <= 10 then '4UB24CS' || lpad(g::text, 3, '0') else null end,
       case when g <= 8 then (g % 4) + 1 else null end, 'CSE',
       -- No seeded administrator: Phase 11 preflight requires an existing
       -- admin to already be approved faculty, and Phase 12's bootstrap
       -- rehearsal needs the true "no admin yet" state.
       case when g <= 2 then 'faculty' else 'student' end,
       case when g <= 2 then 'approved' else 'none' end,
       case when g <= 2 then 'faculty' else 'student' end,
       now() - (g || ' days')::interval
from generate_series(1, 11) g
join auth.users u on u.email = 'seed' || g || '@example.com';
SQL
note "seeded profiles: $(q "select count(*) from public.profiles;")"

# ------------------------------------------------- 5. CLI dry-run
step "5. supabase db push --dry-run (must list the canonical files, in order)"
"$CLI" db push --db-url "$DBURL" --workdir "$REPO" --skip-vault --dry-run > "$WORK/dryrun.out" 2>&1
rc=$?
grep -E '^ • ' "$WORK/dryrun.out" | sed 's/^ *• /      /'
if [ $rc -ne 0 ]; then bad "dry run exited $rc"; sed 's/^/      /' "$WORK/dryrun.out" | head -20; fi
: > "$WORK/expected.txt"
for m in "${CANONICAL[@]}"; do echo "$m.sql" >> "$WORK/expected.txt"; done
grep -E '^ • ' "$WORK/dryrun.out" | sed 's/^ *• *//' > "$WORK/actual.txt"
if diff -q "$WORK/expected.txt" "$WORK/actual.txt" >/dev/null; then
  ok "dry run lists exactly the ${#CANONICAL[@]} canonical migrations, in dependency order"
else
  bad "dry run list does not match the canonical order"
  diff -u "$WORK/expected.txt" "$WORK/actual.txt" | sed 's/^/      /'
fi

# ------------------------------------------------- 6. CLI push
step "6. supabase db push (applies the canonical chain via the CLI)"
"$CLI" db push --db-url "$DBURL" --workdir "$REPO" --skip-vault > "$WORK/push.out" 2>&1
rc=$?
grep -E 'Applying migration|Error|error' "$WORK/push.out" | sed 's/^/      /' | head -20
if [ $rc -ne 0 ]; then bad "db push exited $rc"; sed 's/^/      /' "$WORK/push.out" | head -25; fi
[ $rc -eq 0 ] && ok "db push completed"

# ------------------------------------------------- 7. ledger
step "7. migration ledger (unique version per migration, in order)"
q "select version from supabase_migrations.schema_migrations order by version;" | sed 's/^/      /'
note "$(q "select count(*) || ' rows / ' || count(distinct version) || ' distinct versions' from supabase_migrations.schema_migrations;")"
rows=$(q "select count(*) from supabase_migrations.schema_migrations;")
distinct=$(q "select count(distinct version) from supabase_migrations.schema_migrations;")
if [ "$rows" = "${#CANONICAL[@]}" ] && [ "$distinct" = "${#CANONICAL[@]}" ]; then
  ok "${#CANONICAL[@]} ledger rows, ${#CANONICAL[@]} distinct versions — no collisions"
else
  bad "ledger has $rows rows / $distinct distinct versions (expected ${#CANONICAL[@]} / ${#CANONICAL[@]})"
fi
: > "$WORK/expected_versions.txt"
for m in "${CANONICAL[@]}"; do echo "${m%%_*}" >> "$WORK/expected_versions.txt"; done
q "select version from supabase_migrations.schema_migrations order by version;" > "$WORK/actual_versions.txt"
if diff -q "$WORK/expected_versions.txt" "$WORK/actual_versions.txt" >/dev/null; then
  ok "ledger versions match the canonical chain, in dependency order"
else
  bad "ledger versions do not match the canonical chain"
  diff -u "$WORK/expected_versions.txt" "$WORK/actual_versions.txt" | sed 's/^/      /'
fi

# ------------------------------------------------- 8. idempotency
step "8. supabase db push again (must report the database is up to date)"
"$CLI" db push --db-url "$DBURL" --workdir "$REPO" --skip-vault > "$WORK/push2.out" 2>&1
rc=$?
grep -E 'up to date|Applying migration|Error' "$WORK/push2.out" | sed 's/^/      /' | head -5
if grep -qi 'up to date' "$WORK/push2.out" && [ $rc -eq 0 ]; then
  ok "second push reported the database is up to date"
else
  bad "second push did not report 'up to date' (exit $rc)"
  sed 's/^/      /' "$WORK/push2.out" | head -15
fi

# ------------------------------------------------- 9. verifier
step "9. supabase/verify_schema.sql"
$PG < "$REPO/supabase/verify_schema.sql" > "$WORK/verify.out" 2>&1
rc=$?
note "exit=$rc"
grep -E 'VERIFICATION PASSED|^psql.*ERROR|FAIL:' "$WORK/verify.out" | sed 's/^/    /' | head -20
[ $rc -ne 0 ] && FAIL=1

# ------------------------------------------------- 10. smoke tests
step "10. supabase/test-ucc2-phase1.sql"
$PG < "$REPO/supabase/test-ucc2-phase1.sql" > "$WORK/tests.out" 2>&1
rc=$?
note "exit=$rc"
grep -E 'PASS [0-9]|NOTE [0-9]|FAIL|PRECONDITION|^psql.*ERROR' "$WORK/tests.out" | sed 's/^/    /' | head -40
if grep -qE 'FAIL:|PRECONDITION FAILED' "$WORK/tests.out"; then
  bad "POSITIVE RUN REPORTED A FAILURE"; FAIL=1
fi
[ $rc -ne 0 ] && FAIL=1
if grep -q 'NOTE 6' "$WORK/tests.out"; then
  bad "test 6 SKIPPED its RLS assertions (role switch unavailable)"
else
  ok "test 6 RLS deny-direction was behaviourally asserted (not skipped)"
fi

# ------------------------------------------------- 11. faculty onboarding tests
step "11. supabase/test-faculty-onboarding.sql"
$PG < "$REPO/supabase/test-faculty-onboarding.sql" > "$WORK/faculty-onboarding.out" 2>&1
rc=$?
note "exit=$rc"
grep -E 'TEST [0-9]|PASS|FAIL|All Phase 8' "$WORK/faculty-onboarding.out" | sed 's/^/    /' | head -40
if grep -qE 'FAIL:|ERROR' "$WORK/faculty-onboarding.out"; then
  bad "FACULTY ONBOARDING TESTS REPORTED A FAILURE"; FAIL=1
fi
[ $rc -ne 0 ] && FAIL=1
grep -q 'All Phase 8 faculty onboarding SQL tests passed' "$WORK/faculty-onboarding.out" \
  && ok "all faculty onboarding scenarios passed" \
  || bad "faculty onboarding suite did not reach its summary"
$PG -q -c "delete from auth.users where email like 'phase8-%@example.com';" >/dev/null 2>&1

# --------------------------------- 11a. faculty visibility tests
step "11a. supabase/test-faculty-visibility.sql"
$PG < "$REPO/supabase/test-faculty-visibility.sql" > "$WORK/faculty-visibility.out" 2>&1
rc=$?
note "exit=$rc"
grep -E 'TEST [A-F]|PASS|FAIL|SKIP|All Phase 12' "$WORK/faculty-visibility.out" | sed 's/^/    /' | head -40
if grep -qE 'FAIL:|ERROR' "$WORK/faculty-visibility.out"; then
  bad "FACULTY VISIBILITY TESTS REPORTED A FAILURE"; FAIL=1
fi
[ $rc -ne 0 ] && FAIL=1
grep -q 'All Phase 12 faculty visibility SQL tests passed' "$WORK/faculty-visibility.out" \
  && ok "verification RPC, backfill and realtime scenarios passed" \
  || bad "faculty visibility suite did not reach its summary"
$PG -q -c "delete from auth.users where email like 'phase12-%@example.com';" >/dev/null 2>&1

# --------------------------------- 11b. one-time admin bootstrap
step "11b. initial administrator bootstrap (one-time, owner-only)"
$PG < "$REPO/supabase/test-admin-bootstrap-fixtures.sql" > "$WORK/bootstrap-fixtures.out" 2>&1
rc=$?
if [ $rc -eq 0 ]; then
  ok "bootstrap fixtures created (demo pending, approved peer, personal student)"
else
  bad "bootstrap fixtures failed"
  sed 's/^/      /' "$WORK/bootstrap-fixtures.out" | tail -15
fi

# (a) The demo account is still pending: bootstrap must refuse and change nothing.
$PG < "$REPO/supabase/admin/bootstrap-initial-admin.sql" > "$WORK/bootstrap-ineligible.out" 2>&1
rc=$?
if [ $rc -ne 0 ] && grep -qF 'Bootstrap refused' "$WORK/bootstrap-ineligible.out"; then
  ok "ineligible demo account was refused"
else
  bad "bootstrap did not refuse the ineligible demo account (exit $rc)"
  sed 's/^/      /' "$WORK/bootstrap-ineligible.out" | tail -15
fi
admin_count=$(q "select count(*) from public.profiles where role = 'admin';")
state_count=$(q "select count(*) from public.admin_bootstrap_state;")
if [ "$admin_count" = "0" ] && [ "$state_count" = "0" ]; then
  ok "refused attempt left no admin and no bootstrap marker"
else
  bad "refused attempt left admin=$admin_count marker=$state_count"
fi

# (b) Simulate the legitimate approval of the same account, then bootstrap.
$PG < "$REPO/supabase/test-admin-bootstrap-eligible.sql" > "$WORK/bootstrap-eligible.out" 2>&1 \
  || { bad "could not prepare the eligible demo profile"; sed 's/^/      /' "$WORK/bootstrap-eligible.out" | tail -15; }
$PG < "$REPO/supabase/admin/bootstrap-initial-admin.sql" > "$WORK/bootstrap-success.out" 2>&1
rc=$?
if [ $rc -eq 0 ]; then
  ok "approved-faculty demo account bootstrapped"
else
  bad "bootstrap of the approved demo account failed (exit $rc)"
  sed 's/^/      /' "$WORK/bootstrap-success.out" | tail -15
fi

# (c) Invariants + succession behaviour.
$PG < "$REPO/supabase/test-admin-bootstrap.sql" > "$WORK/bootstrap-tests.out" 2>&1
rc=$?
grep -E 'PASS A[0-9]|FAIL|All Phase 12' "$WORK/bootstrap-tests.out" | sed 's/^/    /' | head -30
if grep -q 'FAIL' "$WORK/bootstrap-tests.out"; then
  bad "ADMIN BOOTSTRAP TESTS REPORTED A FAILURE"; FAIL=1
fi
[ $rc -ne 0 ] && { bad "admin bootstrap test suite exited $rc"; FAIL=1; }

# (d) Re-running the one-time capability must refuse on the permanent marker.
$PG < "$REPO/supabase/admin/bootstrap-initial-admin.sql" > "$WORK/bootstrap-second.out" 2>&1
rc=$?
if [ $rc -ne 0 ] && grep -qF 'already been completed' "$WORK/bootstrap-second.out"; then
  ok "second bootstrap attempt was permanently refused"
else
  bad "bootstrap capability was not disabled after success (exit $rc)"
  sed 's/^/      /' "$WORK/bootstrap-second.out" | tail -15
fi

# Remove rehearsal-only accounts and history; the migration ledger remains.
$PG -q -c "delete from public.admin_nominations;
            delete from public.admin_audit_log;
            delete from public.admin_bootstrap_state;
            delete from auth.users where email in (
              'demo@gmail.com', 'admin-peer@example.com', 'student-account@example.com'
            );" >/dev/null 2>&1

# ------------------------------------------------- 12. negative controls
step "12. negative controls (each MUST fail with the expected message)"
note "(a) unsafe contact_visibility default"
$PG -q -c "alter table public.profile_contacts alter column contact_visibility set default 'public';" >/dev/null 2>&1
$PG < "$REPO/supabase/test-ucc2-phase1.sql" > "$WORK/neg_a.out" 2>&1
expect_fail "$WORK/neg_a.out" "FAIL: profile_contacts.contact_visibility default is not private"
$PG -q -c "alter table public.profile_contacts alter column contact_visibility set default 'private';" >/dev/null 2>&1

note "(b) leaky read policy on profile_contacts"
$PG -q -c 'create policy "Runbook negative control" on public.profile_contacts for select using (true);' >/dev/null 2>&1
$PG < "$REPO/supabase/test-ucc2-phase1.sql" > "$WORK/neg_b.out" 2>&1
expect_fail "$WORK/neg_b.out" "FAIL: anon sees"
$PG -q -c 'drop policy "Runbook negative control" on public.profile_contacts;' >/dev/null 2>&1

# ------------------------------------------------- 13. residue
step "13. residue check (only the seeded rows and the migration ledger may remain)"
$PG -c "select 'profiles' t, count(*) from public.profiles
        union all select 'profile_contacts', count(*) from public.profile_contacts
        union all select 'content_visits', count(*) from public.content_visits
        union all select 'notifications', count(*) from public.notifications
        union all select 'auth.users', count(*) from auth.users
        union all select 'ledger rows', count(*) from supabase_migrations.schema_migrations;" | sed 's/^/    /'

if [ $FAIL -eq 0 ]; then
  rm -rf "$WORK"
  printf '\n\033[1m=== REHEARSAL PASSED ===\033[0m\n'
  exit 0
fi
printf '\n\033[1m=== REHEARSAL FAILED (see *** above) ===\033[0m\n'
printf 'artefacts kept in %s\n' "$WORK"
exit 1
