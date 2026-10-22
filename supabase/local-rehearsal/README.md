# UCC 2.0 — local migration rehearsal

A throwaway PostgreSQL 16 environment that replays the **entire** UCC 2.0
Phase 1 validation using the **real Supabase CLI** against the **canonical**
migration files in `supabase/migrations/`:

baseline → `supabase db push` → migration-ledger check → a second push →
`supabase/verify_schema.sql` → seven Phase 1 behavioural smoke tests →
the Phase 8 faculty-onboarding suite → both negative controls → residue check.

It never touches a hosted project. It exists because the only Supabase
project currently reachable from this repository is **production**, and
production is not a rehearsal environment.

## Why it exists

Phase 1's validation was originally reported as passing, but three defects
made the files in the repository unusable as written (see
`docs/ucc2-phase1-runbook.md` §8). This harness is what proved them, and it
is the regression net for the fixes.

It also reproduces the *hosted* privilege model closely enough to catch
host-only failures before they reach staging — in particular
`public.profiles.id references auth.users(id)`, which broke every profile
fixture until the fixtures were made auth-backed.

Finally, it is what proved the migration **version-collision** defect and
then proved the fix: the CLI derives a migration's identity from the digits
before the first underscore and stores it as a primary key, so ten files
sharing four prefixes made `supabase db push` fail halfway and leave the
database half-migrated. The canonical filenames now carry unique versions,
and this harness asserts exactly that.

## Requirements

- `docker`
- a POSIX shell
- the Supabase CLI (v2.121.0 or later; it is auto-detected, or set
  `SUPABASE_CLI=/path/to/supabase`)

No `psql`, no credentials, and no network access to any Supabase project are
required. The CLI is invoked with `--db-url` against the local container and
`--skip-vault`, so it never contacts the Supabase platform and never needs a
`config.toml`.

## Run it

```sh
bash supabase/local-rehearsal/run-rehearsal.sh
```

Exit code `0` means the rehearsal passed. It prints, in order:

| Step | What it proves |
|---|---|
| 1 | a fresh disposable PostgreSQL 16 container |
| 2 | the Supabase stub (hosted-shaped `auth.users`, RLS enabled, no `id` default) |
| 3 | the pre-Phase-1 consolidated baseline — production's current shape |
| 4 | live-shaped seed data (11 profiles, 10 USNs, 0 collisions) |
| 5 | `supabase db push --dry-run` lists **exactly** the canonical files, in dependency order |
| 6 | `supabase db push` applies them through the CLI |
| 7 | the ledger holds one row per canonical migration, with distinct versions, in order |
| 8 | a second `supabase db push` reports **"Remote database is up to date."** |
| 9 | `supabase/verify_schema.sql` — expects `VERIFICATION PASSED` |
| 10 | `supabase/test-ucc2-phase1.sql` — expects `PASS 1–7`; also asserts test 6's RLS deny-direction was *asserted*, not skipped |
| 11 | `supabase/test-faculty-onboarding.sql` — expects all 11 faculty onboarding scenarios to pass |
| 12 | both negative controls — each **must** fail with its expected message |
| 13 | a residue check — only the seeded rows and the migration ledger rows may remain |

On failure the run exits `1` and keeps its artefacts in a temporary
directory (the path is printed) for inspection.

## Files

| File | Role |
|---|---|
| `run-rehearsal.sh` | The driver: container, CLI push, ledger check, verification, negative controls, residue check |
| `auth-stub.sql` | Minimal Supabase runtime: `auth` schema, `auth.users`, `auth.uid()`, `anon` / `authenticated` / `service_role` roles, `supabase_realtime` publication |

## Baseline selection

The baseline migrations are **patches on top of** the consolidated schema:
`2026101301_network_and_faculty.sql` assumes `public.events` already exists,
so the chain cannot be replayed from an empty database on its own.

The harness therefore applies the consolidated `supabase/schema.sql` first.
If the working-tree copy already contains the Phase 1 objects (it currently
does), the harness falls back to the last committed revision —
`git show HEAD:supabase/schema.sql` — which is the true pre-Phase-1
baseline. The choice is printed at run time, and the harness aborts if the
resolved baseline turns out to contain Phase 1 objects.

## What the stub does and does not prove

`auth-stub.sql` deliberately mirrors the hosted Supabase auth schema:

- `auth.users.id` is `NOT NULL` with **no default** (as upstream), so a
  fixture that omits it fails locally exactly as it would on a hosted project
- `auth.users.confirmed_at` is a `GENERATED` column and cannot be written
  directly (as upstream)
- `email_confirmed_at` exists (upstream renamed `confirmed_at` to it)
- RLS is **enabled** on `auth.users` with no policy, as hosted does — so the
  session role must be a `BYPASSRLS` role, which is the same condition the
  smoke test's precondition probe checks
- `auth.uid()` reads the `sub` claim exactly as upstream does

**It cannot prove** anything that depends on the hosted Supabase runtime:
GoTrue's real signup pipe and error text, live JWT claims and `is_admin()`,
PostgREST's schema-cache reaction, or a project's actual auth-schema version.
Those remain gated on a hosted staging run — see
`docs/ucc2-phase1-runbook.md` §8 and `docs/ucc2-phase1-staging-runbook.md`.
