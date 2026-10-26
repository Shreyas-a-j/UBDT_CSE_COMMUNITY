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
#  14. fresh-install check: supabase/schema.sql in a separate database
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
  2026102213_faculty_review_atomic
  2026102301_discussion_pins
  2026102302_discussion_pin_admin_authorization
  20261023025000_backfill_updated_at_helper
  2026102303_notification_publish_schema
  2026102304_notification_publish_triggers
  2026102401_android_push_schema
  2026102402_android_push_triggers
  2026102403_disable_publish_email
  2026102501_notification_retention
  2026102502_admission_numbers_and_usn_linking
  2026102601_discussion_pins_pkey_repair
  2026102602_admin_nominee_eligibility
  2026102603_announcement_delete_policy
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
  # HEAD stopped being the pre-Phase-1 baseline once the Phase 1 schema was
  # committed (8aa3ca7 "Brand new features added"). Walk history for the
  # newest schema.sql revision that still predates the Phase 1 markers —
  # the same revision this harness used when it last ran green.
  baseline_rev=""
  for rev in $(git -C "$REPO" log --format=%H -- supabase/schema.sql); do
    # Read the file into a variable first: under `set -o pipefail`,
    # `git show | grep -q` reports git's SIGPIPE (141) once grep exits on
    # the first match, which would invert the test above. A here-string
    # has no pipeline, so grep's status is the status.
    schema_at_rev="$(git -C "$REPO" show "$rev:supabase/schema.sql" 2>/dev/null)" || continue
    if ! grep -qE 'member_type|profile_contacts|content_visits|dedupe_key' <<<"$schema_at_rev"; then
      baseline_rev="$rev"
      break
    fi
  done
  [ -n "$baseline_rev" ] || { echo "cannot find a pre-Phase-1 schema.sql revision in git history"; exit 1; }
  git -C "$REPO" show "$baseline_rev:supabase/schema.sql" > "$WORK/schema_baseline.sql" \
    || { echo "cannot read the pre-Phase-1 baseline from git"; exit 1; }
  note "baseline: git ${baseline_rev:0:7}:supabase/schema.sql (newest pre-Phase-1 revision)"
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
seed_out=$($PG -q 2>&1 <<'SQL'
insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
select gen_random_uuid(), 'seed' || g || '@example.com', encode(gen_random_bytes(16), 'base64'),
       now(), '{}'::jsonb, now(), now()
from generate_series(1, 11) g;
-- The auth trigger already provisions a profile for each seeded user. Upsert
-- the live-shaped fields onto those rows. member_type does not exist in the
-- pre-Phase-1 baseline; migration 2026102201 backfills it from role later.
insert into public.profiles (id, email, name, usn, year, branch, role, faculty_status, created_at)
select u.id, 'seed' || g || '@example.com', 'Seed Member ' || g,
       case when g <= 10 then '4UB24CS' || lpad(g::text, 3, '0') else null end,
       case when g <= 8 then (g % 4) + 1 else null end, 'CSE',
       -- No seeded administrator: Phase 11 preflight requires an existing
       -- admin to already be approved faculty, and Phase 12's bootstrap
       -- rehearsal needs the true "no admin yet" state.
       -- The pre-Phase-1 constraint only allows 'verified'; migration
       -- 2026102206 later accepts both 'verified' and 'approved'.
       case when g <= 2 then 'faculty' else 'student' end,
       case when g <= 2 then 'verified' else 'none' end,
       now() - (g || ' days')::interval
from generate_series(1, 11) g
join auth.users u on u.email = 'seed' || g || '@example.com'
on conflict (id) do update set
  email = excluded.email,
  name = excluded.name,
  usn = excluded.usn,
  year = excluded.year,
  branch = excluded.branch,
  role = excluded.role,
  faculty_status = excluded.faculty_status,
  created_at = excluded.created_at;
SQL
)
seed_rc=$?
if [ $seed_rc -ne 0 ]; then
  bad "seed failed (exit $seed_rc)"
  printf '%s\n' "$seed_out" | tail -20 | sed 's/^/    /'
  exit 1
fi
seeded_profiles=$(q "select count(*) from public.profiles;")
seeded_usns=$(q "select count(*) from public.profiles where usn is not null;")
seeded_dupes=$(q "select count(*) from (select usn from public.profiles where usn is not null group by usn having count(*) > 1) d;")
note "seeded profiles: $seeded_profiles / USNs: $seeded_usns / duplicate USNs: $seeded_dupes"
if [ "$seeded_profiles" = "11" ] && [ "$seeded_usns" = "10" ] && [ "$seeded_dupes" = "0" ]; then
  ok "seed produced 11 profiles, 10 unique USNs and no collisions"
else
  bad "seed counts are wrong (expected 11 profiles / 10 USNs / 0 duplicate USNs)"
  exit 1
fi

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

# --------------------------------- 11c. discussion pins
step "11c. supabase/test-discussion-pins.sql"
$PG < "$REPO/supabase/test-discussion-pins.sql" > "$WORK/discussion-pins.out" 2>&1
rc=$?
note "exit=$rc"
grep -E 'TEST [0-9]|PASS|FAIL|SKIP|All discussion pin' "$WORK/discussion-pins.out" | sed 's/^/    /' | head -50
if grep -qE 'FAIL:|ERROR' "$WORK/discussion-pins.out"; then
  bad "DISCUSSION PIN TESTS REPORTED A FAILURE"; FAIL=1
fi
[ $rc -ne 0 ] && FAIL=1
grep -q 'All discussion pin SQL tests passed' "$WORK/discussion-pins.out" \
  && ok "pin authorization, 3-pin limit, expiry, unpin and concurrency scenarios passed" \
  || bad "discussion pin suite did not reach its summary"
$PG -q -c "delete from auth.users where email like 'pin-%@example.com';" >/dev/null 2>&1

# --------------------------------- 11c2. legacy discussion_pins primary key
step "11c2. supabase/test-discussion-pins-legacy-pkey.sql"
docker cp "$REPO/supabase/migrations/2026102601_discussion_pins_pkey_repair.sql" \
  "$CTR":/tmp/repair.sql >/dev/null 2>&1
$PG -v repair_file=/tmp/repair.sql < "$REPO/supabase/test-discussion-pins-legacy-pkey.sql" > "$WORK/discussion-pins-legacy.out" 2>&1
rc=$?
note "exit=$rc"
grep -E 'PASS L|FAIL|ERROR|Legacy pkey' "$WORK/discussion-pins-legacy.out" | sed 's/^/    /' | head -20
if grep -qE 'FAIL|ERROR' "$WORK/discussion-pins-legacy.out"; then
  bad "LEGACY DISCUSSION_PINS PK REGRESSION FAILED"; FAIL=1
fi
[ $rc -ne 0 ] && FAIL=1
grep -q 'Legacy pkey repair regression: PASS' "$WORK/discussion-pins-legacy.out" \
  && ok "legacy PRIMARY KEY (post_id) reproduced, repaired, history preserved" \
  || bad "legacy pin regression did not reach its summary"
$PG -q -c "delete from auth.users where email = 'pinrepair-faculty@example.com';" >/dev/null 2>&1

# --------------------------------- 11c3. administrator nominee eligibility
step "11c3. supabase/test-admin-nominee-eligibility.sql"
$PG < "$REPO/supabase/test-admin-nominee-eligibility.sql" > "$WORK/admin-eligibility.out" 2>&1
rc=$?
note "exit=$rc"
grep -E 'PASS E|FAIL|ERROR|Admin nominee' "$WORK/admin-eligibility.out" | sed 's/^/    /' | head -20
if grep -qE 'FAIL|ERROR' "$WORK/admin-eligibility.out"; then
  bad "ADMIN NOMINEE ELIGIBILITY REGRESSION FAILED"; FAIL=1
fi
[ $rc -ne 0 ] && FAIL=1
grep -q 'Admin nominee eligibility regression: PASS' "$WORK/admin-eligibility.out" \
  && ok "legacy member_type faculty eligible; student/alumni/self/non-admin rejected" \
  || bad "admin nominee eligibility regression did not reach its summary"
$PG -q -c "delete from auth.users where email like 'nominee-%@example.com';" >/dev/null 2>&1

# --------------------------------- 11c4. announcements DELETE policy
step "11c4. supabase/test-announcement-delete-policy.sql"
$PG < "$REPO/supabase/test-announcement-delete-policy.sql" > "$WORK/announcement-delete.out" 2>&1
rc=$?
note "exit=$rc"
grep -E 'PASS A|FAIL|ERROR|Announcement delete policy regression' "$WORK/announcement-delete.out" | sed 's/^/    /' | head -20
if grep -qE 'FAIL|ERROR' "$WORK/announcement-delete.out"; then
  bad "ANNOUNCEMENT DELETE POLICY REGRESSION FAILED"; FAIL=1
fi
[ $rc -ne 0 ] && FAIL=1
grep -q 'Announcement delete policy regression: PASS' "$WORK/announcement-delete.out" \
  && ok "announcement DELETE policy: author/admin allowed, other faculty/student denied" \
  || bad "announcement delete regression did not reach its summary"

# --------------------------------- 11d. publish fan-out + Android push
step "11d. supabase/test-notification-fanout.sql"
$PG < "$REPO/supabase/test-notification-fanout.sql" > "$WORK/notification-fanout.out" 2>&1
rc=$?
note "exit=$rc"
grep -E 'TEST [0-9]|PASS|FAIL|PRECONDITION|All publish fan-out' "$WORK/notification-fanout.out" | sed 's/^/    /' | head -50
if grep -qE 'FAIL:|PRECONDITION FAILED|ERROR' "$WORK/notification-fanout.out"; then
  bad "PUBLISH FAN-OUT / PUSH TESTS REPORTED A FAILURE"; FAIL=1
fi
[ $rc -ne 0 ] && FAIL=1
grep -q 'All publish fan-out SQL tests passed' "$WORK/notification-fanout.out" \
  && ok "fan-out, push opt-out, email block, showcase tenures, dedupe and RLS passed" \
  || bad "publish fan-out suite did not reach its summary"
$PG -q -c "delete from auth.users where email like 'notif-%@example.com' or email like 'showcase-%@example.com';" >/dev/null 2>&1

# --------------------------------- 11e. notification retention
step "11e. supabase/test-notification-retention.sql"
$PG < "$REPO/supabase/test-notification-retention.sql" > "$WORK/notification-retention.out" 2>&1
rc=$?
note "exit=$rc"
grep -E 'TEST [0-9]|PASS|FAIL|PRECONDITION|All notification retention' "$WORK/notification-retention.out" | sed 's/^/    /' | head -60
if grep -qE 'FAIL:|PRECONDITION FAILED|ERROR' "$WORK/notification-retention.out"; then
  bad "NOTIFICATION RETENTION TESTS REPORTED A FAILURE"; FAIL=1
fi
[ $rc -ne 0 ] && FAIL=1
grep -q 'All notification retention SQL tests passed' "$WORK/notification-retention.out" \
  && ok "24-hour retention, batching, push-state safety, dedupe ledger, showcase tenure and RLS passed" \
  || bad "notification retention suite did not reach its summary"
$PG -q -c "delete from auth.users where email like 'retention-%@example.com';" >/dev/null 2>&1

# --------------------------------- 11f. admission numbers + USN linking
step "11f. supabase/test-admission-numbers.sql"
$PG < "$REPO/supabase/test-admission-numbers.sql" > "$WORK/admission-numbers.out" 2>&1
rc=$?
note "exit=$rc"
grep -E 'TEST [0-9]|PASS|FAIL|All admission' "$WORK/admission-numbers.out" | sed 's/^/    /' | head -40
if grep -qE 'FAIL:|ERROR' "$WORK/admission-numbers.out"; then
  bad "ADMISSION-NUMBER / USN-LINKING TESTS REPORTED A FAILURE"; FAIL=1
fi
[ $rc -ne 0 ] && FAIL=1
grep -q 'All admission-number and USN-linking tests passed' "$WORK/admission-numbers.out" \
  && ok "first-year admission, duplicate rollback, years 2-4 rejection, USN linking and RLS passed" \
  || bad "admission-number suite did not reach its summary"
$PG -q -c "delete from auth.users where email like 'ucc-admission-%@example.com';" >/dev/null 2>&1

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
        union all select 'discussion_pins', count(*) from public.discussion_pins
        union all select 'notifications', count(*) from public.notifications
        union all select 'notification_push_outbox', count(*) from public.notification_push_outbox
        union all select 'notification_dedupe_ledger', count(*) from public.notification_dedupe_ledger
        union all select 'showcase_top_entries', count(*) from public.showcase_top_entries
        union all select 'auth.users', count(*) from auth.users
        union all select 'ledger rows', count(*) from supabase_migrations.schema_migrations;" | sed 's/^/    /'

for table in profile_contacts content_visits discussion_pins notifications notification_push_outbox notification_dedupe_ledger showcase_top_entries; do
  n=$(q "select count(*) from public.$table;")
  if [ "$n" = "0" ]; then
    ok "residue: $table is empty"
  else
    bad "residue: $table has $n row(s)"
  fi
done
for check in "profiles:11" "auth.users:11" "supabase_migrations.schema_migrations:${#CANONICAL[@]}"; do
  table=${check%:*}
  want=${check##*:}
  n=$(q "select count(*) from $table;")
  if [ "$n" = "$want" ]; then
    ok "residue: $table has the expected $want row(s)"
  else
    bad "residue: $table has $n row(s), expected $want"
  fi
done

# --------------------------------- 14. fresh schema.sql install
step "14. fresh-install schema.sql (new-install path, separate database)"
FRESH_DB="ucc2_fresh_$$"
FRESH_PG="docker exec -i $CTR psql -v ON_ERROR_STOP=1 -U postgres -d $FRESH_DB"
docker exec "$CTR" psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "create database \"$FRESH_DB\";" >/dev/null 2>&1 \
  || bad "could not create the fresh-install database"
$FRESH_PG -q < "$REPO/supabase/local-rehearsal/auth-stub.sql" > "$WORK/fresh-stub.out" 2>&1 \
  || { bad "fresh-install auth stub failed"; tail -20 "$WORK/fresh-stub.out" | sed 's/^/    /'; }
$FRESH_PG -q < "$REPO/supabase/schema.sql" > "$WORK/fresh-schema.out" 2>&1
rc=$?
if [ $rc -ne 0 ]; then
  bad "supabase/schema.sql failed on a fresh PostgreSQL 16 install"
  tail -30 "$WORK/fresh-schema.out" | sed 's/^/    /'
else
  ok "supabase/schema.sql applied to a fresh PostgreSQL 16 database"
  for check in \
    "core tables:4:select count(*) from pg_tables where schemaname='public' and tablename in ('notifications','notification_push_outbox','notification_dedupe_ledger','showcase_top_entries')" \
    "dedupe trigger:1:select count(*) from pg_trigger where tgname='trg_guard_notification_dedupe'" \
    "retention functions:3:select count(*) from pg_proc where proname in ('cleanup_expired_notifications','ensure_notification_retention_schedule','notification_push_outbox_is_terminal')" \
    "updated_at helper:1:select count(*) from pg_proc where proname='update_updated_at_column'" \
    "retention scan index:1:select count(*) from pg_indexes where schemaname='public' and indexname='notifications_created_at_idx'"; do
    label=${check%%:*}
    rest=${check#*:}
    want=${rest%%:*}
    sql=${rest#*:}
    got=$(docker exec "$CTR" psql -t -A -U postgres -d "$FRESH_DB" -c "$sql" 2>/dev/null | tr -d '[:space:]')
    if [ "$got" = "$want" ]; then
      ok "fresh schema: $label = $want"
    else
      bad "fresh schema: $label is '$got', expected $want"
    fi
  done

  detachable=$(docker exec "$CTR" psql -t -A -U postgres -d "$FRESH_DB" -c \
    "select is_nullable from information_schema.columns where table_schema='public' and table_name='notification_push_outbox' and column_name='notification_id';" 2>/dev/null | tr -d '[:space:]')
  if [ "$detachable" = "YES" ]; then
    ok "fresh schema: push outbox notification_id is detachable"
  else
    bad "fresh schema: push outbox notification_id is '$detachable', expected YES"
  fi
fi
docker exec "$CTR" psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "drop database if exists \"$FRESH_DB\";" >/dev/null 2>&1 || true

if [ $FAIL -eq 0 ]; then
  rm -rf "$WORK"
  printf '\n\033[1m=== REHEARSAL PASSED ===\033[0m\n'
  exit 0
fi
printf '\n\033[1m=== REHEARSAL FAILED (see *** above) ===\033[0m\n'
printf 'artefacts kept in %s\n' "$WORK"
exit 1
