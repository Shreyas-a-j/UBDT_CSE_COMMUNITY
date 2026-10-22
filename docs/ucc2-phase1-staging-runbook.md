# UCC 2.0 — Phase 1 Staging Provisioning Runbook

**Audience:** the operator who will create and apply to a **dedicated staging**
Supabase project.
**Status:** ready to execute — **but the staging project and its credentials do
not exist yet.** See §9.
**Scope:** provisioning, applying, and verifying UCC 2.0 Phase 1 on a
*separate, non-production* Supabase project. No Phase 2 UI work.

Every command below was checked against the **installed Supabase CLI
v2.121.0** (`supabase <command> --help`) and against the official reference
(`https://supabase.com/docs/reference/cli/`). The migration-ledger behaviour
in §2 was additionally **reproduced with the real CLI** against a disposable
PostgreSQL 16 database; the transcript is reproduced there. Nothing here is
guessed.

> **Production is not a target for any step in this runbook.** The only
> Supabase project currently reachable from this repository is production
> (`NEXT_PUBLIC_SUPABASE_URL` in `.env` / `.env.local`). Do not run any
> command in this document against it.

---

## 1. What the local rehearsal proved — and what it cannot prove

`supabase/local-rehearsal/` replays the entire chain on disposable
PostgreSQL 16: baseline → the four Phase 1 migrations → `verify_schema.sql`
→ seven smoke tests → both negative controls → residue check. It passes.

**The local stub cannot validate any of the following. These are the reasons
staging is mandatory, and they are the reason a "green" local run must never
be reported as a staged validation:**

| Not validated locally | Why the stub cannot |
|---|---|
| **GoTrue signup behaviour** — the real `auth.users` insert pipe, and whether a rejected duplicate-USN signup leaves an orphaned auth user | the stub's `auth.users` is a hand-written table, not GoTrue |
| **Hosted JWT claims** — `auth.uid()` inside RLS policies, `is_admin()`, and the `protect_profile_privileges` admin path with real claims | the stub's `auth.uid()` reads a synthetic GUC; no JWT is ever signed or verified |
| **Actual Supabase SQL Editor / `postgres` permissions** — above all whether the session may `INSERT` into `auth.users`, where RLS is enabled on hosted | the stub runs as a `BYPASSRLS` superuser, so this is never exercised |
| **PostgREST schema-cache behaviour** — whether `notify pgrst, 'reload schema'` is enough on a real project, or a manual reload is needed | the stub has no PostgREST |
| **A project's actual auth-schema version** | the stub mirrors `supabase/postgres` `schema-17.sql` + the `supabase/auth` migrations, which may drift from a live project |

The repaired smoke test now has a **precondition probe** for the third row:
if the session cannot insert into `auth.users`, the suite aborts with
`PRECONDITION FAILED: this session cannot INSERT into auth.users …` instead
of failing later as a confusing foreign-key error. **Treat that message as a
blocked run, not a test failure.**

---

## 2. Migration version prefixes (resolved 2026-10-22)

> ### ✅ The version-collision defect is fixed.
>
> The canonical files in `supabase/migrations/` now each carry a **unique**
> CLI version, and `supabase db push` applies the whole chain in one go.

### 2.1 What the defect was, and how it was found

The CLI identifies a migration by the digits before the **first** underscore:

```
supabase/cli → apps/cli-go/pkg/migration/file.go
  migrateFilePattern = regexp.MustCompile(`^([0-9]+)_(.*)\.sql$`)
```

and stores that value in a table whose version column is the primary key:

```
  CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (version text NOT NULL PRIMARY KEY)
```

Ten files shared four prefixes (`20261013` x3, `20261014` x2, `20261020`,
`20261022` x4). Reproduced with CLI v2.121.0 against a disposable database:

```
Applying migration 20261022_01_member_identity_and_contacts.sql...
Applying migration 20261022_02_notification_targeting_and_visits.sql...
ERROR: duplicate key value violates unique constraint "schema_migrations_pkey" (SQLSTATE 23505)
Key (version)=(20261022) already exists.
```

The push is **not** atomic across files, so the database was left
**half-migrated**: `profiles.member_type` and `public.profile_contacts`
existed, while `public.content_visits` and
`profiles_usn_normalized_unique` did not. A second push failed identically.

### 2.2 The canonical mapping

Every file now carries a unique `YYYYMMDDNN` version, and the sequence
suffix preserves the original dependency order (sorting the versions as
strings yields exactly the intended apply sequence):

| Previous file | Canonical file | Canonical CLI version |
|---|---|---|
| `20261013_network_and_faculty.sql` | `2026101301_network_and_faculty.sql` | `2026101301` |
| `20261013_network_fixes.sql` | `2026101302_network_fixes.sql` | `2026101302` |
| `20261013_usn_unique_and_columns.sql` | `2026101303_usn_unique_and_columns.sql` | `2026101303` |
| `20261014_auth_profile_provisioning.sql` | `2026101401_auth_profile_provisioning.sql` | `2026101401` |
| `20261014_faculty_applications.sql` | `2026101402_faculty_applications.sql` | `2026101402` |
| `20261020_delete_policies.sql` | `2026102001_delete_policies.sql` | `2026102001` |
| `20261022_01_member_identity_and_contacts.sql` | `2026102201_member_identity_and_contacts.sql` | `2026102201` |
| `20261022_02_notification_targeting_and_visits.sql` | `2026102202_notification_targeting_and_visits.sql` | `2026102202` |
| `20261022_03_global_usn_uniqueness.sql` | `2026102203_global_usn_uniqueness.sql` | `2026102203` |
| `20261022_04_duplicate_usn_signup_guard.sql` | `2026102204_duplicate_usn_signup_guard.sql` | `2026102204` |

### 2.3 Migration history compatibility — no repair is needed

**No environment has ever recorded the old versions in a CLI ledger**, so
nothing has to be repaired anywhere:

- `supabase/.temp/project-ref` — the file `supabase link` writes — has never
  existed in this repository. `supabase db push` requires a linked project,
  so the CLI has never applied anything here. The baseline was applied by
  hand through the Supabase SQL Editor, which writes no ledger.
- `supabase/schema.sql` — the consolidated schema — contains no
  `supabase_migrations` objects, confirming it was hand-maintained rather
  than produced by `supabase db pull`.
- The four Phase 1 files were provably never applied anywhere: read-only
  probes against production showed `profiles.member_type` absent
  (`42703`) and `profile_contacts` / `content_visits` absent (`PGRST205`),
  and the staging project has had no migrations applied.

**Defensive check before the first push** (staging only, read-only):

```sh
psql "$STAGING_DB_URL" -v ON_ERROR_STOP=1 -c \
  "select version, name from supabase_migrations.schema_migrations order by version;"
```

If this returns rows, the project already has a ledger. If any of them is a
**legacy** version (`20261013`, `20261014`, `20261020`, `20261022`), stop and
map it with the table in §2.2 before pushing:

```sh
supabase migration repair 20261022 --status reverted   # legacy group
supabase migration repair 2026102201 --status applied  # canonical
```

Never run a repair against production.

### 2.4 The fix is verified

`supabase/local-rehearsal/run-rehearsal.sh` drives the real CLI against the
canonical files and asserts the end state: the dry run lists exactly the ten
canonical files in dependency order, the push applies them, the ledger holds
**10 rows / 10 distinct versions** in the canonical order, a second push
reports *"Remote database is up to date."*, `verify_schema.sql` passes, all
seven smoke tests pass, both negative controls trip, and no residue remains.

---

## 3. Provision the staging project

### 3.1 Create a separate project

Use the dashboard (**staging must be a separate project**, never a branch of
production and never the production project itself), or the CLI:

```sh
supabase projects list                              # confirm what already exists
supabase projects create ucc2-staging \
  --org-id "$SUPABASE_ORG_ID" \
  --region "$SUPABASE_REGION" \
  --db-password "$STAGING_DB_PASSWORD" \
  --size "medium"
```

Verified usage: `supabase projects create [flags] [<name>]`. Flags:
`--org-id`, `--db-password`, `--region` (choices include `ap-south-1`,
`eu-west-1`, `us-east-1`, `us-west-2`, …), `--size` (choices include
`micro`, `small`, `medium`, `large`, …), `--high-availability`.

> Prefer the dashboard for creation: it shows the generated project ref and
> database password in one place, and lets you confirm the region and plan
> before anything is created. The CLI form above is equivalent.

Record, in a password manager (never in this repository):

| Item | Value |
|---|---|
| Project ref (the `supabase.co` subdomain) | `____________________` |
| Database password | `____________________` |
| Region | `____________________` |
| Direct connection URI | `postgresql://postgres.[REF]:[PASSWORD]@db.[REF].supabase.co:5432/postgres` |
| Pooler connection URI | `postgresql://postgres.[REF]:[PASSWORD]@aws-0-<REGION>.pooler.supabase.com:5432/postgres` |

### 3.2 Obtain database access securely

- Generate a **personal access token** at
  `https://supabase.com/dashboard/account/tokens` for the CLI
  (`supabase login --token <token>`; the token is stored in native
  credentials storage, or `~/.supabase/access-token`).
- The **database password** is separate from the access token. Supply it via
  `SUPABASE_DB_PASSWORD` for non-interactive runs — never as a literal in a
  command that lands in a shell history file, a script, or this repository.
- The direct connection URI is needed for `psql`. **Percent-encode the
  password** — special characters in it will otherwise break the URI. (The
  CLI says the same about `--db-url`: "must be percent-encoded".)
- `.env` and `.env.local` are git-ignored (`.env*`). Do **not** add a
  staging block to them: that file feeds the Next.js build and would
  silently repoint the deployed app at staging. Keep staging credentials in
  the shell environment or a password manager only.

### 3.3 Confirm the target before doing anything else

```sh
# 1. Link and check what the CLI now points at.
supabase link --project-ref "$STAGING_PROJECT_REF" --password "$STAGING_DB_PASSWORD"
cat supabase/.temp/project-ref        # must print the STAGING ref, nothing else

# 2. Independently confirm via SQL that you are on the right database.
psql "$STAGING_DB_URL" -v ON_ERROR_STOP=1 -c \
  "select current_database(), current_user, inet_server_addr(), version();"
```

Verified usage: `supabase link [flags] [<ref-or-branch>]`; flags
`--project-ref`, `--password`/`-p`, `--skip-pooler` (use the direct
connection instead of the pooler — needed when the pooler is unreachable,
e.g. an IPv6-only project). The ref may also be given positionally, but the
CLI rejects using both forms at once.

**Stop condition:** if `supabase/.temp/project-ref` is not the staging ref, or
if the SQL session is not on the staging project, **stop immediately**. Do not
continue with the rest of this runbook on the basis of "it is probably right".

### 3.4 Confirm you have permission to apply migrations

`supabase db push`, `db pull`, and `db dump` all require a linked project
(or an explicit `--db-url` / `--project-ref`). The database password must
belong to a role that can run DDL in `public` — on Supabase that is the
`postgres` role.

A read-only probe that proves connectivity **and** DDL capability without
changing anything:

```sh
psql "$STAGING_DB_URL" -v ON_ERROR_STOP=1 -c \
  "create table if not exists public._ucc2_ddl_probe(id int); drop table public._ucc2_ddl_probe;"
```

If that fails with a permission error, you have the wrong credentials or the
wrong role. Fix that before continuing.

### 3.5 Back up the staging database

On a brand-new project there is no data, so this is a formality — but it is
the step that makes the rest of this runbook reversible, and it is the step
you will want when the project is later re-seeded with production-like data.

```sh
# Schema-only snapshot (needs Docker; the CLI runs pg_dump in a container)
supabase db dump --linked -f "$BACKUP_DIR/staging-schema-before.sql"

# Data snapshot
supabase db dump --linked --data-only -f "$BACKUP_DIR/staging-data-before.sql"
```

Verified usage: `supabase db dump [flags]`; flags `-f/--file`, `--data-only`,
`--role-only`, `-s/--schema`, `-x/--exclude`, `--use-copy`,
`--keep-comments`, `--dry-run`, `--linked`, `--local`, `--db-url`,
`--project-ref`, `-p/--password`.

Note on the data dump: Supabase-managed schemas are excluded from the
*schema* dump, but the **data** dump does include `auth` (only
`auth.schema_migrations` is excluded, via `--exclude-table`). That matters
here because `public.profiles.id` references `auth.users(id)` — a data
restore is only coherent if the `auth.users` rows come with it, and `pg_dump`
orders them correctly because of that foreign key.

Also record the dashboard's **point-in-time recovery** state for the project
(Supabase provides PITR on paid plans) — that is the real safety net, and the
`db dump` artefacts are the portable copy.

Store the backup outside the repository.

---

## 4. Establish the baseline schema on staging

Staging must start in the **same state as production**, i.e. the
*pre-Phase-1* consolidated schema, so that applying the four Phase 1 files
exercises the real path.

The working-tree `supabase/schema.sql` already contains the Phase 1 objects.
The pre-Phase-1 baseline is the last committed revision:

```sh
git show HEAD:supabase/schema.sql > "$BACKUP_DIR/staging-baseline.sql"

# Sanity check: the baseline must NOT contain any Phase 1 object.
grep -cE 'member_type|profile_contacts|content_visits|dedupe_key' "$BACKUP_DIR/staging-baseline.sql"   # expect 0
```

Apply it to staging:

```sh
psql "$STAGING_DB_URL" -v ON_ERROR_STOP=1 -f "$BACKUP_DIR/staging-baseline.sql"
```

`supabase/local-rehearsal/run-rehearsal.sh` resolves this baseline
automatically and is the reference for the expected end state.

> If the working tree's `supabase/schema.sql` is ever committed **with** the
> Phase 1 objects, `git show HEAD:…` will no longer be the pre-Phase-1
> baseline. The rehearsal harness prints which baseline it used — always
> read that line.

**Pre-flight the USN collisions** (runbook §2). On an empty staging project
this returns no groups; on a project seeded with production-like data it is
the check that protects migration `2026102203`:

```sh
psql "$STAGING_DB_URL" -v ON_ERROR_STOP=1 -f supabase/diagnostics/usn_collisions.sql
```

---

## 5. Apply the Phase 1 migrations

### Path A — SQL Editor / `psql` (ledger-free alternative)

This is the path the Phase 1 runbook already documents
(`docs/ucc2-phase1-runbook.md` §3). It applies the four files directly and
never touches the CLI's migration ledger, so it is unaffected by the ledger
mechanics in §2. Use it when you want the SQL Editor's transaction
behaviour, or when the CLI cannot reach the project.

**Via the dashboard SQL Editor** (staging project → SQL Editor), run each
file in order as its own statement batch:

1. `supabase/migrations/2026102201_member_identity_and_contacts.sql`
2. `supabase/migrations/2026102202_notification_targeting_and_visits.sql`
3. `supabase/migrations/2026102203_global_usn_uniqueness.sql`
4. `supabase/migrations/2026102204_duplicate_usn_signup_guard.sql`

In the SQL Editor, **delete or comment out every line beginning with `\`**
(those are `psql` meta-commands and are syntax errors in the editor). Each
file is otherwise plain SQL and ends with its own
`notify pgrst, 'reload schema';` — keep that final statement intact.

**Via `psql`** (repeat for each file, in order, one transaction each):

```sh
for f in 2026102201_member_identity_and_contacts \
         2026102202_notification_targeting_and_visits \
         2026102203_global_usn_uniqueness \
         2026102204_duplicate_usn_signup_guard; do
  echo "== $f"
  psql "$STAGING_DB_URL" -v ON_ERROR_STOP=1 -f "supabase/migrations/$f.sql" || break
done
```

`ON_ERROR_STOP=1` matters: without it `psql` continues past an error and you
can end up with a half-applied migration.

### Path B — Supabase CLI (now the recommended path)

The canonical files carry unique versions (§2), so the CLI can apply the
whole chain directly from the repository. No workdir, no copies, no renames.

```sh
cd "$REPO"
supabase link --project-ref "$STAGING_PROJECT_REF" --password "$STAGING_DB_PASSWORD"

supabase db push --dry-run     # MUST list exactly the 10 canonical files
supabase db push               # applies them in order
```

Verified usage: `supabase db push [flags]`; flags `--linked`, `--local`,
`--db-url`, `--project-ref`, `-p/--password`, `--dry-run`, `--include-all`,
`--include-roles`, `--include-seed`, `--skip-vault`.

**`--dry-run` is mandatory before the real push.** If it lists anything other
than the ten canonical files in §2.2, stop (§8).

`supabase db push` applies **all ten** files, including the six baseline
migrations. On staging the baseline has already been applied in §4 as the
consolidated schema, and those six files are idempotent — the local
rehearsal applies them the same way and passes. The dry run confirms the
list before anything is written.

This exact sequence was executed against a disposable database with CLI
v2.121.0 and produced:

```
Would push these migrations:
 • 2026101301_network_and_faculty.sql
 • 2026101302_network_fixes.sql
 • 2026101303_usn_unique_and_columns.sql
 • 2026101401_auth_profile_provisioning.sql
 • 2026101402_faculty_applications.sql
 • 2026102001_delete_policies.sql
 • 2026102201_member_identity_and_contacts.sql
 • 2026102202_notification_targeting_and_visits.sql
 • 2026102203_global_usn_uniqueness.sql
 • 2026102204_duplicate_usn_signup_guard.sql
...
Applying migration 2026101301_network_and_faculty.sql...
...
Applying migration 2026102204_duplicate_usn_signup_guard.sql...
{"upToDate":false,...,"message":"Finished supabase db push."}
```

with a ten-row ledger of ten distinct versions, a second push reporting
`"Remote database is up to date."`, and all Phase 1 objects present in the
database.

**Never run `supabase db reset --linked`** against staging or production. The
CLI reference states that this flag "executes a SQL script to identify and
drop all user created entities in the remote database". It is listed here
only so it is recognised and avoided.

---

## 6. Verify

### 6.1 Migration ledger

```sh
supabase migration list --linked
```

Verified usage: `supabase migration list [flags]`; flags `--linked`,
`--local`, `--db-url`, `--project-ref`, `-p/--password`. Output is a
`LOCAL │ REMOTE │ TIME (UTC)` table.

Under Path A there is no CLI ledger at all, because the migrations were
applied directly; that is acceptable and matches production, which also has
no ledger. If the project does have a ledger, confirm the recorded versions
match what was applied and repair any gap explicitly:

```sh
supabase migration repair 2026102201 --status applied    # record it
supabase migration repair 2026102201 --status reverted   # remove the record
```

Verified usage: `supabase migration repair [flags] [<version...>]`; flags
`--status <applied|reverted>` (required), `--linked`, `--local`, `--db-url`,
`--project-ref`, `-p/--password`. Note the version argument accepts **one or
more** versions.

Direct check of the ledger table:

```sh
psql "$STAGING_DB_URL" -v ON_ERROR_STOP=1 -c \
  "select version, name from supabase_migrations.schema_migrations order by version;"
```

### 6.2 Schema verifier

```sh
psql "$STAGING_DB_URL" -v ON_ERROR_STOP=1 -f supabase/verify_schema.sql
```

Success: `VERIFICATION PASSED` on stdout, exit code `0`. Failure: a non-zero
exit listing every mismatch (object, expected fragment, actual). In the SQL
Editor, strip the `\` lines first.

### 6.3 Behavioural smoke tests

```sh
psql "$STAGING_DB_URL" -v ON_ERROR_STOP=1 -f supabase/test-ucc2-phase1.sql
```

Success: `PASS 1` … `PASS 7` and exit code `0`. Strip the `\` lines in the
SQL Editor.

Watch the notices, not just the exit code:

- `NOTE 3` — the session carried auth claims, so the privilege deny-path was
  **skipped**. Not acceptable for a staging validation; re-run in a session
  with no claims.
- `NOTE 6` — `SET ROLE anon` was unavailable, so the RLS assertions were
  **skipped**. Not acceptable; record it as an incomplete run.
- `PRECONDITION FAILED: this session cannot INSERT into auth.users …` — the
  session lacks the privilege the fixtures need (hosted `auth.users` has RLS
  enabled). This is a **blocked run**, not a test failure. Either re-run as a
  role with that privilege, or document that the suite cannot run in the SQL
  Editor on this project and fall back to the Admin API for fixture creation.

### 6.4 Negative controls (prove the tests still bite)

Run these on staging **only after** the suite has passed cleanly, and revert
immediately afterwards:

```sql
-- (a) unsafe default must FAIL test 6
alter table public.profile_contacts
  alter column contact_visibility set default 'public';

-- (b) leaky read policy must FAIL test 6
create policy "Runbook negative control" on public.profile_contacts
  for select using (true);
```

Expected: the suite fails with
`FAIL: profile_contacts.contact_visibility default is not private` and
`FAIL: anon sees 3 contact rows; expected exactly 1 (the public one)`.
Then revert both:

```sql
alter table public.profile_contacts
  alter column contact_visibility set default 'private';
drop policy "Runbook negative control" on public.profile_contacts;
```

### 6.5 Drift check

```sh
supabase db dump --linked -f "$BACKUP_DIR/staging-schema-after.sql"
diff -u "$BACKUP_DIR/staging-schema-before.sql" "$BACKUP_DIR/staging-schema-after.sql"
```

The diff should contain **only** the Phase 1 additions. Anything else means
something else touched the database.

Note: `supabase db pull` is *not* the right tool for a read-only comparison —
it writes a new file into `supabase/migrations/` and updates the remote
ledger. Use it only deliberately, and discard the generated file afterwards.

---

## 7. The real hosted checks (runbook §8)

These are the behaviours the local stub cannot establish. They are the
reason the staging run exists. Full list in
`docs/ucc2-phase1-runbook.md` §8; each needs a human or a script with
credentials, and each must be recorded with its actual result.

| # | Check | How to observe it | What a failure means |
|---|---|---|---|
| 1 | GoTrue signup + duplicate-USN rejection | sign up through the app/GoTrue with a USN already registered | the §7 guard is not firing in the real runtime |
| 2 | Failed signup leaves **no orphaned auth user** | after the rejected signup, check `auth.users` for the attempted address | orphans accumulate and the "owner" semantics are wrong |
| 3 | Existing-account login and profile recovery | sign in with a pre-existing account; confirm the profile is found, not duplicated | the auth↔profile pipe is broken on hosted |
| 4 | Alumni identity without faculty/admin privileges | sign up with alumni intent; confirm `member_type='alumni'`, `role='student'`, `faculty_status='none'` | privilege escalation |
| 5 | Faculty approval with a **real admin JWT** | approve an application as an admin through the app; confirm `auth.uid()` and `is_admin()` behave | the protection trigger blocks legitimate admin writes, or lets them through for non-admins |
| 6 | Private contact visibility through PostgREST | read `profile_contacts` as anon, as a member, and as the owner; compare to `contact_visibility` | RLS is not enforced on the real path |
| 7 | Notification target validation, dedupe, and read behaviour | emit the same `dedupe_key` twice; confirm one row; mark read | duplicate notifications or a broken read flag |
| 8 | Content-visit ownership and uniqueness | visit the same content twice; confirm one row, owned by the viewer | visit rows leak or duplicate |
| 9 | PostgREST schema cache refresh | query the new columns/tables through the API right after the apply | the app breaks until a manual reload — record the extra step |

---

## 8. Stop conditions

**Stop, do not improvise, if any of these occur.** Each one has a documented
path forward; none of them should be worked around by weakening a control.

| Trigger | Required action |
|---|---|
| **USN collisions exist** (`supabase/diagnostics/usn_collisions.sql` returns any group) | **Stop before `2026102203`.** That migration refuses to run by design. Produce a masked diagnostic and reconcile **manually with the affected members**. Never merge, delete, or reassign an account automatically; never copy a USN across accounts. |
| **Any `PRECONDITION FAILED`** from the smoke test | Stop. The migration set is incomplete or the session lacks a needed privilege. Fix the cause and re-run; do not skip the precondition. |
| **The target is production** — `supabase/.temp/project-ref` shows the production ref, or the SQL session resolves to the production host | **Stop immediately.** Re-link to staging and re-confirm §3.3 from scratch. Do not "just look". |
| **Unexpected schema drift** — the §6.5 diff contains changes beyond the Phase 1 additions | Stop. Something outside this runbook touched the database. Identify it before applying anything else. |
| **A smoke test fails** | Stop. Do not "adjust the test to pass", do not weaken RLS, triggers, or constraints, and do not skip the failing assertion. Re-read the runbook's §6 remediation branch for USN collisions; otherwise report the failure with its exact output. |
| **`2026102203` raises** `Cannot enforce global USN uniqueness…` | Stop. It changed no data. Run the diagnostic, reconcile manually, re-run. |
| **`supabase db push` fails with `duplicate key … schema_migrations_pkey`** | Stop. This should no longer be possible — the canonical files have unique versions (§2). If it happens, the files on disk are not the canonical ones: re-check the file list in `supabase/migrations/` against §2.2, and confirm you are pushing the repository's own directory. |
| **The CLI dry run lists anything other than the intended files** | Stop. You are about to push a baseline patch onto a project that already has the consolidated schema. |
| **Any request to apply migrations to production** | Requires explicit, written authorisation for *that* request. A general "go ahead" on Phase 2 is not authorisation to migrate production. |

---

## 9. Current blocker

**No hosted migration has been applied.** A dedicated staging project is
reported as available, but this task explicitly forbids connecting to or
mutating any hosted database, so nothing was applied and nothing was
probed. The following are still not present in this environment and were not
invented:

- the staging project ref
- a staging database password or connection URI
- a `SUPABASE_ACCESS_TOKEN` / personal access token
- `psql` (not installed here)

**Available now:** the Supabase CLI **v2.121.0** at
`/home/shreyas/.nvm/versions/node/v24.21.0/bin/supabase`, and Docker for the
local rehearsal.

**Still missing:** `supabase/config.toml` — the repository has never been
CLI-linked, and `supabase/.temp/` contains only `cli-latest`. `supabase init`
creates it. Path A does not need it at all; Path B needs it only if the
CLI complains about a missing local configuration.

**Production was not contacted** beyond the read-only schema probes already
reported (which established that the Phase 1 migrations are not applied to
production, and that production has zero USN collisions).

**Next step:** run §3 (confirm the staging ref and DB password, back up,
confirm the target), then §4 (baseline), then §5 Path B (CLI dry run, then
push). The version-collision defect that would have made §5 Path B fail
half-way is fixed and verified locally (§2.4), so the hosted push is now a
single clean operation.
