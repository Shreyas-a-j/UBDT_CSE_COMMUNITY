# UCC 2.0 — Phase 1 Operations Runbook

**Audience:** whoever applies and verifies the UCC 2.0 Phase 1 schema changes on a
Supabase project (applied via `supabase db push` or the SQL Editor).
**Status:** ready to apply; see "What has and has not been validated" before the
first production run.

---

## 1. Scope and artifacts

Phase 1 hardens the database only. It deliberately ships **no website UI and no
mobile changes** — those are Phase 2.

| Artifact | Role |
|---|---|
| `supabase/migrations/2026102201_member_identity_and_contacts.sql` | Phase 1A: `member_type` / `graduation_year` / public links on `profiles`; new `public.profile_contacts` (RLS); hardened `protect_profile_privileges()`; alumni-aware `handle_new_user()`; faculty-application trigger keeps `member_type` in sync |
| `supabase/migrations/2026102202_notification_targeting_and_visits.sql` | Phase 1C: notification content targeting (`content_type` + `content_id` + `dedupe_key`, checked and indexed), duplicate-safe `emit_notification()`, new `public.content_visits` (RLS) |
| `supabase/migrations/2026102203_global_usn_uniqueness.sql` | Phase 1B: unique index on `upper(btrim(usn))` across **all** profiles with a non-empty USN (students *and* alumni); deliberately blocking on pre-existing collisions |
| `supabase/migrations/2026102204_duplicate_usn_signup_guard.sql` | Phase 1D: duplicate-USN signup aborts the whole `auth.users` insert (SQLSTATE 23505) — no orphan auth account |
| `supabase/diagnostics/usn_collisions.sql` | READ‑ONLY diagnostic: masked duplicate-USN groups; run before Phase 1B and whenever 1B fails |
| `supabase/verify_schema.sql` | Post-apply verifier: checks **definitions**, not just object names |
| `supabase/test-ucc2-phase1.sql` | Behavioural smoke tests for every Phase 1 invariant |

Execution order is fixed: **01 → 02 → 03 → 04** (01 and 02 are independent of
each other, but 03 intentionally narrows the USN index after both, and 04
documents behaviour on top of all of them). `docs/migration-dependency-order.md`
tracks the broader migration graph.

---

## 2. Pre-flight (before touching production)

1. **USN collisions.** If `2026102203` has not been applied yet, run
   `supabase/diagnostics/usn_collisions.sql` first. It is read-only, masks USNs,
   and returns no names/emails — safe to paste into an incident log.
   - **Zero duplicate groups:** proceed.
   - **Duplicate groups exist:** resolve *deliberately, never automatically*
     (§6), then apply the migrations.
2. **Baseline snapshot.** Take a point-in-time backup / pitr restore point
   before the first apply, so §6 remediation has a safety net.
3. **No expected downtime.** All migrations are forward-only, additive, and
   re-runnable, except Phase 1B, which refuses to run (and changes nothing)
   when collisions exist.

---

## 3. Applying the migrations

Apply **in filename order**, transactionally. The Supabase CLI does this by
default (`supabase db push`). If pasting into the SQL Editor instead, each file
is self-contained plain SQL (no psql meta-commands), and each file ends with its
own `notify pgrst, 'reload schema';` — keep that final statement intact.

After all four are applied, PostgREST has been reloaded by the migrations
themselves; no manual `NOTIFY` is required.

### If a migration fails mid-run

Nothing partial survives: migrations run in a transaction and abort cleanly.
Re-run the same file after addressing its cause. Do **not** skip ahead to a
later phase — later migrations assume the earlier ones landed completely.

---

## 4. Post-apply verification — `supabase/verify_schema.sql`

Run it **after every apply** (or pasted batch). It verifies expected
*definitions* (index expressions, constraint text, function identity
arguments and bodies, execute grants), not mere existence, and prints a
full inventory first so a failed run still leaves troubleshooting data
on screen.

**Via psql (automated):**

```sh
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/verify_schema.sql
```

- Success: `VERIFICATION PASSED` on stdout, exit code 0.
- Failure: the final exception lists **every** failure (object, expected
  fragment, what was actually found) and the process exits non-zero.

**Via Supabase SQL Editor:** delete or comment out every line beginning with
`\` first — `\echo` headings are psql meta-commands and are syntax errors in the
editor. All SQL below them is plain and editor-safe. Same result text:
`VERIFICATION PASSED`, or an exception listing all failures.

---

## 5. Smoke tests — `supabase/test-ucc2-phase1.sql`

Run after a green verification. Seven behavioural tests, one transaction each:

1. Profile identity columns and constraints (`member_type`, `graduation_year`
   1950–2200, public-link host checks) — via the INSERT path.
2. Global normalized USN uniqueness (student×alumni, case- and
   whitespace-insensitive).
3. Alumni signup identity; faculty privileges cannot be self-assigned.
4. Notification targeting checks + `emit_notification` duplicate suppression +
   legacy five-argument call compatibility.
5. One `content_visits` row per (user, content) pair + type and time-order
   checks.
6. `profile_contacts` constraints, private-by-default, RLS denies
   unauthenticated reads/writes.
7. Duplicate-USN signup guard aborts; no orphaned auth user; owner untouched.

**Via psql (automated):**

```sh
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/test-ucc2-phase1.sql
```

Expected: `PASS 1:` … `PASS 7:` notices and exit code 0. In the SQL Editor,
first delete or comment out the `\echo` lines (same caveat as §4).

**Guarantees and honest limitations:**

- The script never disables or weakens a security trigger. Fixture rows are
  synthetic (random `4UB99CS###`-style USNs, random `@example.com` emails).
- **The session must be able to `INSERT` into `auth.users`.**
  `public.profiles.id` is `uuid references auth.users(id)`, so every profile
  fixture is backed by a real auth user — the script creates one through the
  normal signup path (`on_auth_user_created` → `handle_new_user()`), then
  replaces the auto-provisioned profile with the exact row the test needs.
  `auth.users.id` is `NOT NULL` with no default upstream, so the script
  always supplies it explicitly. Hosted Supabase has RLS enabled on
  `auth.users`; the precondition block probes this capability up front and
  aborts with `PRECONDITION FAILED: this session cannot INSERT into
  auth.users …` rather than letting it surface later as a confusing
  foreign-key violation. Run the script as the SQL editor's `postgres` role
  (or any role holding that privilege).
- Every test is its own transaction: fixtures are deleted on success and the
  block auto-rolls-back on an unexpected failure, so the script leaves no
  residue in either case. A precondition block aborts early (with a
  "PRECONDITION FAILED: run <migration> first" message) if Phase 1 objects are
  missing, so partial application is not misreported as passes-and-failures.
- Privilege tests run in the **deny direction** (as `anon`/`authenticated`
  with no JWT claims — the SQL Editor has none). A session that *does* carry
  admin claims legitimately passes the protection trigger; in that case test 3
  prints `NOTE 3` and skips instead of false-failing. If `SET ROLE` is not
  permitted for the running user, test 6 prints `NOTE 6` and skips its RLS
  assertions — the script still passes, but record the skip: it means the RLS
  behaviour was not exercised in that run.

### Negative controls (how to prove the tests still bite)

Before trusting a green run, run each once on a throwaway environment:

```sql
-- (a) unsafe default must FAIL test 6
alter table public.profile_contacts
  alter column contact_visibility set default 'public';
-- (b) leaky read policy must FAIL test 6
create policy "Runbook negative control" on public.profile_contacts
  for select using (true);
```

Expected outcome for each: non-zero exit / an exception containing
`FAIL: profile_contacts.contact_visibility default is not private` or
`FAIL: anon sees 3 contact rows; expected exactly 1 (the public one)`.
Revert both changes afterwards. (Validated on throwaway PostgreSQL 16;
both controls were caught.)

---

## 6. Branch: duplicate-USN collisions (Phase 1B failure)

`2026102203` is intentionally **not** best-effort. If `profiles` already
contains two rows sharing a normalized USN, it raises:

```
Cannot enforce global USN uniqueness: a duplicate USN appeared while
building the index. No profiles were changed.
hint: Run supabase/diagnostics/usn_collisions.sql and resolve the affected
profiles, then re-run this migration.
```

No data was modified (the old student-only index stays in force until the
global one exists). Remediation, per `usn_collisions.sql` and the migration
header:

1. Run the diagnostic; identify the accounts behind each masked group.
2. Confirm with the affected people which account owns the USN. Pick a
   canonical owner.
3. For every other profile, either set `usn = NULL` (the legitimate-missing-USN
   policy) or a corrected USN — via the SQL Editor, **inside one transaction**,
   temporarily disabling only the protection trigger during the window:

   ```sql
   begin;
   alter table public.profiles
     disable trigger trg_protect_profile_privileges;
   update public.profiles set usn = null
     where id = '<non-owner-profile-id>';
   alter table public.profiles
     enable trigger trg_protect_profile_privileges;
   commit;
   ```

   The `update` fails to stick without this window: the trigger reverts USN
   changes made without an admin JWT.
4. Re-run the migration.

**Never** delete profiles, merge accounts, or copy a USN across accounts to
make the index build. Those change account ownership; they require the owners'
explicit consent and a separate, reviewed data-fix migration.

---

## 7. Signup behaviour after Phase 1D

When a user tries to sign up with a USN already registered to another account:

- The signup **aborts atomically** (SQLSTATE 23505, `USN is already registered
  to another account.`). No `auth.users` row and no profile row survive.
- Non-duplicate failures (bad email, unknown other key violations) behave
  exactly as before.
- Support guidance: tell the user their USN is already linked to an existing
  account; resolution (e.g., recovering that account) is a human process, not a
  data tweak. Nothing was half-created by the failed attempt.

Note: this guard fires inside the database trigger, which we validated in
plain SQL. Whether GoTrue surfaces the underlying error message verbatim to
the client is a Supabase-runtime property we have **not** validated — see §8.

---

## 8. What has and has not been validated

**Validated** (disposable local PostgreSQL 16, migrations applied verbatim;
stub for `auth.users` / `auth.uid()` / the `anon` + `authenticated` roles,
shaped to match the hosted Supabase auth schema):

- `verify_schema.sql`: clean run exits 0 with `VERIFICATION PASSED`; negative
  controls (anon execute grant, legacy handler body, non-unique USN index
  rebuild) each caught with actionable details.
- `test-ucc2-phase1.sql`: exit 0 with `PASS 1–7`; both §5 negative controls
  caught. The RLS deny-direction in test 6 was **behaviourally asserted**, not
  skipped — the run emitted no `NOTE 6`. The script leaves no residue: after a
  clean run only the seeded rows remain.
- All four Phase 1 migrations re-run cleanly over an already-migrated
  database (idempotency), and the verifier and all seven tests stay green
  afterwards.
- All SQL is plain and editor-safe apart from `\echo` headings.

> **Correction (2026-10-22, rehearsal repair).** The earlier claim of
> "`PASS 1–7`" was **not reproducible with the files as they stood in the
> repository**. Three defects made the chain unusable as written, all now
> fixed:
>
> 1. `2026101303_usn_unique_and_columns.sql` declared two `exception` clauses
>    in one PL/pgSQL block — a syntax error that made the file unappliable.
> 2. `test-ucc2-phase1.sql` inserted profile fixtures straight into
>    `public.profiles`, which violates `profiles_id_fkey` on the real schema.
> 3. `test-ucc2-phase1.sql` contained an unterminated string literal in
>    test 6, so the whole script failed to parse; the same line's
>    `column_default` pattern was also wrong and would have failed the
>    positive run once the literal was closed.
>
> A fourth defect was found later, in the **migration layout** rather than
> in the test: ten files shared four version prefixes, and the Supabase CLI
> keys a migration by the digits before the first underscore and stores that
> as a primary key. `supabase db push` therefore applied the first file of a
> group and then failed, leaving the database half-migrated. Every file now
> carries a unique `YYYYMMDDNN` version; the mapping and the
> history-compatibility evidence are in
> `docs/migration-dependency-order.md`, and the fix is re-verified on every
> run of `supabase/local-rehearsal/run-rehearsal.sh`.
>
> A fifth, separate problem was found during the rehearsal and is **not** a
> defect in the test: `2026101301_network_and_faculty.sql` assumes
> `public.events` already exists, so the baseline chain cannot be replayed
> from an empty database on its own. The consolidated `supabase/schema.sql`
> is the true baseline; replay it first, then the baseline migrations.

**Not yet validated in the real Supabase runtime** (first production apply
should therefore be followed by §4/§5 and the manual checks below):

- Real GoTrue signup through the actual `auth.users` pipe (realism of new
  metadata shapes, and what error text the client actually sees for §7).
- Live JWT claims: `auth.uid()` inside policies, `is_admin()`, and the
  `protect_profile_privileges` admin path with real claims present.
- PostgREST reaction to new tables/columns/constraints after `reload schema`
  (e.g., whether stale caches need a manual reload on this project).
- Whether the hosted SQL editor's `postgres` role may `INSERT` into
  `auth.users` (RLS is enabled there). The test's precondition probe checks
  this and fails loudly rather than silently skipping — see §5.

---

## 9. Residual risks (known, deliberate, tracked for Phase 2)

- `public.profiles.email` remains publicly selectable (profiles has a public
  SELECT policy). This is why contact details live in `profile_contacts`
  instead of `profiles`. Removing the email exposure is a Phase 2 decision:
  the app currently relies on it.
- The web `AuthContext` can insert `profiles` directly when the signup trigger
  did not fire; such rows get the database defaults (`member_type = 'student'`).
  A user signalling alumni intent through that edge path lands as student
  until the app-level flow is updated (Phase 2; `apps/mobile` twin untouched
  in Phase 1).
- Phase 1C establishes the notification **data model** only: no notification
  UI, no broadcast triggers, no retention jobs yet.

---

## 10. Rollback policy

All four migrations are **forward-only**; no automated down-migration is
provided. Each is safe to re-run (additive or `create or replace`), except
Phase 1B, which blocks by design until collisions are resolved (§6).

If a phase must be un-applied, do it as its own reviewed change (drop the new
objects/policies explicitly), not by restoring a vague older snapshot — and
coordinate first, because app code shipped in the same release may depend on
the new columns. The verifier is the normalizer: after any manual surgery,
`verify_schema.sql` defines what "correct" means.
