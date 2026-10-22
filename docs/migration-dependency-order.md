# Migration Dependency & Execution Order

**Author:** Agent 1 — Database Audit and Migration Coordinator  
**Date:** 2026-10-14  
**Status:** Superseded in part — revised 2026-10-22 with the actual file
inventory (see §Current State and §UCC 2.0 Phase 1); the Agent 1–7 phase plan
below is kept as historical context where the landed filenames differ from the
proposal.

---

## Current State (live DB baseline + shipped files still to confirm)

Rows 1–3 are the applied baseline. **Do not re-apply.** Rows 4–5 exist in the
repo but this document has no record of their application against the live DB —
`supabase/verify_schema.sql` settles it (it checks definitions, not names).

| # | File | Purpose | Applied? |
|---|---|---|---|
| 1 | `2026101301_network_and_faculty.sql` | Base: profiles expanded, events, posts, comments, faculty_applications, connection_requests, conversations, messages, announcements, all functions + triggers + RLS | ✅ (per repo history) |
| 2 | `2026101302_network_fixes.sql` | Legacy user_profiles sync, protect employee_id/designation, connection participant immutability, partial unique indices, race-safe conversations | ✅ (per repo history) |
| 3 | `2026101303_usn_unique_and_columns.sql` | USN normalization, partial unique index for students, protect_profile_privileges extended to USN | ✅ (per repo history) |
| 4 | `2026101401_auth_profile_provisioning.sql` | handle_new_user() hardened: full profiles columns populated at signup, USN normalized via upper(btrim()), duplicate-USN conflict path does not orphan auth users | in repo — confirm via `verify_schema.sql` before the UCC 2.0 apply |
| 5 | `2026101402_faculty_applications.sql` | faculty_applications persistence: table, indexes, triggers, RLS, helper functions (idempotent, additive) | in repo — confirm via `verify_schema.sql` before the UCC 2.0 apply |
| 6 | `2026102001_delete_policies.sql` | Hotfix (verified live 2026-10-20): missing DELETE policies on posts/events/comments made author deletions silently no-op under RLS; restores is_admin()-gated admin deletes | ✅ (per its header: verified live on 2026-10-20) |
| 7 | `2026102201` … `2026102207` | UCC 2.0 Phase 1–8 migrations (identity/contacts, notifications/visits, USN uniqueness, signup guard, announcement media, approval vocabulary, secure faculty onboarding) | apply in version order; verified by `supabase/verify_schema.sql` and the local rehearsal |
| 8 | `2026102208_single_admin_succession.sql` | Phase 11: at most one admin, admin must be approved faculty, nomination/acceptance/resignation functions, reviewed directory integration | additive; preflight refuses if existing admins are not approved faculty |
| 9 | `2026102209_admin_bootstrap.sql` | Phase 12: `bootstrap` audit action + permanent one-time marker; contains no promotion | apply after 2208; the promotion is the owner-only script in `supabase/admin/bootstrap-initial-admin.sql` |
| 10 | `2026102210_admin_role_check_alignment.sql` | Phase 12.1: widens `profiles_role_check` to permit `role = 'admin'` on hand-migrated databases that predate the canonical base migration | apply after 2209 and before the bootstrap; contains no promotion |
| 11 | `2026102211_signup_provisioning_schema_alignment.sql` | Phase 12.2: restores the `profiles` columns written by `handle_new_user()` and the application sync triggers on hand-migrated databases that skipped the base column repairs | apply before 2207 on a drifted database; idempotent no-op on the canonical chain |

### Faculty onboarding on a drifted live database

If a faculty signup leaves a `pending` profile but no row in the admin
dashboard, check readiness with `supabase/admin/verify-faculty-onboarding.sql`.
A false `signup_creates_application`, `signup_guard`, or `pending_profile_sync`
means the secure onboarding migration is missing. On a live database that also
predates the base column repairs, apply in this order:

1. `2026102211_signup_provisioning_schema_alignment.sql` — restores the
   columns `2026102207` writes (`profiles.email`, `profiles.updated_at`, and the
   signup fields). It does not rewrite existing profile rows.
2. `2026102207_secure_faculty_onboarding.sql` — installs the atomic signup
   trigger, the self-insert guard, and the application-to-profile sync.

Then re-run the readiness script. All three booleans must be true before
testing a new faculty signup.

**Initial admin:** see `docs/admin-bootstrap.md`. The bootstrap is deliberately
not a migration. `supabase db push` must never promote an account.


### Version prefixes and the Supabase CLI ledger (2026-10-22)

The Supabase CLI identifies a migration by the digits before the **first**
underscore, and stores that value as the **primary key** of
`supabase_migrations.schema_migrations`:

```
supabase/cli → apps/cli-go/pkg/migration/file.go
  migrateFilePattern = regexp.MustCompile(`^([0-9]+)_(.*)\.sql$`)
  CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (version text NOT NULL PRIMARY KEY)
```

The original filenames shared four prefixes across ten files, so
`supabase db push` applied the first file of a group and then failed on the
ledger's primary key — leaving the database **half-migrated**. Every file
therefore now carries a unique `YYYYMMDDNN` version:

| Previous file | Canonical file | Previous CLI version | Canonical CLI version |
|---|---|---|---|
| `20261013_network_and_faculty.sql` | `2026101301_network_and_faculty.sql` | `20261013` | `2026101301` |
| `20261013_network_fixes.sql` | `2026101302_network_fixes.sql` | `20261013` | `2026101302` |
| `20261013_usn_unique_and_columns.sql` | `2026101303_usn_unique_and_columns.sql` | `20261013` | `2026101303` |
| `20261014_auth_profile_provisioning.sql` | `2026101401_auth_profile_provisioning.sql` | `20261014` | `2026101401` |
| `20261014_faculty_applications.sql` | `2026101402_faculty_applications.sql` | `20261014` | `2026101402` |
| `20261020_delete_policies.sql` | `2026102001_delete_policies.sql` | `20261020` | `2026102001` |
| `20261022_01_member_identity_and_contacts.sql` | `2026102201_member_identity_and_contacts.sql` | `20261022` | `2026102201` |
| `20261022_02_notification_targeting_and_visits.sql` | `2026102202_notification_targeting_and_visits.sql` | `20261022` | `2026102202` |
| `20261022_03_global_usn_uniqueness.sql` | `2026102203_global_usn_uniqueness.sql` | `20261022` | `2026102203` |
| `20261022_04_duplicate_usn_signup_guard.sql` | `2026102204_duplicate_usn_signup_guard.sql` | `20261022` | `2026102204` |

The sequence suffix preserves the original dependency order: sorting the
canonical versions as strings yields exactly the intended apply sequence
(20261013×3 → 20261014×2 → 20261020 → 20261022×4).

**Migration history compatibility.** No environment has ever recorded the old
versions in a CLI ledger, so no repair is required:

- `supabase/.temp/project-ref` — the file `supabase link` writes — has never
  existed in this repository. `supabase db push` requires a linked project, so
  the CLI has never applied anything here. The baseline was applied by hand
  through the Supabase SQL Editor, which writes no ledger.
- `supabase/schema.sql` — the consolidated schema — contains no
  `supabase_migrations` objects, confirming it was hand-maintained rather
  than produced by `supabase db pull`.
- The four Phase 1 files were provably never applied anywhere: read-only
  probes against production showed `profiles.member_type` absent
  (`42703`) and `profile_contacts` / `content_visits` absent (`PGRST205`),
  and the staging project has had no migrations applied.

**If an environment ever does hold the old versions in its ledger**, the
mapping above is the repair list: mark each legacy version as reverted and
the canonical one as applied before the next push.

```sh
supabase migration repair 20261022 --status reverted   # legacy group
supabase migration repair 2026102201 --status applied  # canonical
```

Only ever run this against a project you have confirmed is **not**
production, and only after `supabase migration list` has shown the drift.

---

## UCC 2.0 — Phase 1 (written, validated, pending application)

Four migrations dated 2026-10-22, forward-only, in mandatory order. Full apply
instructions, pre-flight checks, verification and the collision branch live in
**`docs/ucc2-phase1-runbook.md`** — read it before applying anything below.

| Order | File | Purpose | Depends on |
|---|---|---|---|
| 1 | `2026102201_member_identity_and_contacts.sql` | `member_type`/`graduation_year`/public links on profiles; new `profile_contacts` (RLS, private by default); hardened `protect_profile_privileges()`; alumni-aware `handle_new_user()` | baseline + #4 |
| 2 | `2026102202_notification_targeting_and_visits.sql` | Notification content targeting (`content_type`/`content_id`/`dedupe_key`, checked + indexed), duplicate-safe `emit_notification()`, new `content_visits` (RLS) | baseline |
| 3 | `2026102203_global_usn_uniqueness.sql` | Unique `upper(btrim(usn))` across all profiles with a non-empty USN (students *and* alumni) — deliberately blocking on pre-existing collisions | #1 |
| 4 | `2026102204_duplicate_usn_signup_guard.sql` | Duplicate-USN signup aborts the whole `auth.users` insert (SQLSTATE 23505); no orphan auth account | #1, #3 |

**Before applying:** pre-flight in the runbook §2 (run
`supabase/diagnostics/usn_collisions.sql`; take a restore point).
**After applying:** run `supabase/verify_schema.sql`, then the behavioural
smoke tests `supabase/test-ucc2-phase1.sql` (runbook §4–§5). Each migration
ends with its own `notify pgrst, 'reload schema';`.

**Verification command after baseline:**
```sql
-- Run supabase/verify_schema.sql in Supabase SQL Editor
-- Then confirm:
NOTIFY pgrst, 'reload schema';
```

---

## Proposed Migration Execution Order (Agents 2–7)

> **Reality check (2026-10-22).** This section is historical planning. What
> actually landed differs from the proposal: Agent 2's phase shipped as
> `2026101401_auth_profile_provisioning.sql` (proposed name:
> `20261014_handle_new_user_and_profile_sync.sql`), Agent 6's phase shipped as
> `2026101402_faculty_applications.sql`, the 20261013 follow-on hotfix
> `2026102001_delete_policies.sql` was undocumented, and phases 3–5 (comments/feed,
> events, messaging) have no landed migration files. The authoritative current
> inventory is the `supabase/migrations/` directory plus the tables above; UCC 2.0
> Phase 1 continues from it (table above and `docs/ucc2-phase1-runbook.md`).

### Phase 0: Coordination (Agent 1 — Current)
- [x] Complete database audit (`docs/database-audit.md`)
- [x] Publish this dependency order document
- [ ] Confirm shared schema decisions with each agent before they begin

### Phase 1: Auth & Profile Sync (Agent 2)

**Migration:** `20261014_handle_new_user_and_profile_sync.sql`

**Purpose:**
- Ensure `public.handle_new_user()` inserts into `public.profiles` (not legacy `user_profiles`)
- Add idempotent sync from any existing `user_profiles` rows that weren't migrated
- Ensure the `on_auth_user_created` trigger is attached to `auth.users`

**Dependencies:** Phase 0 complete; base migrations (1–3) applied.

**Shared schema decisions Agent 2 must confirm with Agent 1:**
- The insert columns for `handle_new_user` must match: `id, email, name, usn, year, branch, section, bio, skills, interests, role, faculty_status`
- `ON CONFLICT (id) DO UPDATE` must only touch safe fields (`email`, `name`)

**Files Agent 2 must also update (coordinate with Agent 1):**
- None beyond the migration itself — `handle_new_user` is a pure SQL function.

### Phase 2: Feed & Comments (Agent 3)

**Migration:** `20261014_comments_and_feed_enhancements.sql`

**Purpose:** TBD by Agent 3 (to be specified after coordination with Agent 1).

**Dependencies:** Phases 0–1 complete.

**Conflicts to avoid:**
- Do NOT modify `profiles`, `connection_requests`, `faculty_applications`, or `conversations` tables.
- Do NOT modify `lib/types.ts` without coordinating with Agent 1.
- Any new columns on `posts` or `comments` must be additive and nullable.

### Phase 3: Events & RSVPs (Agent 4)

**Migration:** `20261014_event_rsvps_enhancements.sql`

**Purpose:** TBD by Agent 4.

**Dependencies:** Phases 0–1 complete.

**Conflicts to avoid:**
- Do NOT modify `profiles`, `connection_requests`, `faculty_applications`, or `conversations` tables.
- Any new columns on `events` or `event_rsvps` must be additive and nullable.

### Phase 4: Messaging (Agent 5)

**Migration:** `20261014_messaging_enhancements.sql`

**Purpose:** TBD by Agent 5.

**Dependencies:** Phases 0–3 complete.

**Conflicts to avoid:**
- Do NOT modify `profiles`, `connection_requests`, `faculty_applications`, or `events` tables.
- Any new columns on `messages` or `conversations` must be additive and nullable.
- Do NOT modify the `get_or_create_direct_conversation` RPC without Agent 1 coordination.

### Phase 5: Faculty Directory (Agent 6)

**Migration:** `20261014_faculty_directory_enhancements.sql`

**Purpose:** TBD by Agent 6.

**Dependencies:** Phases 0–4 complete.

**Conflicts to avoid:**
- Do NOT redefine `faculty_applications` schema (already complete).
- Do NOT modify `connection_requests`.
- If adding new profile columns (e.g., for faculty-specific display), coordinate with Agent 1 and update `lib/profile.ts`.

### Phase 6: Admin Dashboard (Agent 7)

**Migration:** `20261014_admin_dashboard_enhancements.sql`

**Purpose:** TBD by Agent 7.

**Dependencies:** Phases 0–5 complete.

**Conflicts to avoid:**
- Do NOT redefine `faculty_applications` schema (already complete).
- Do NOT modify `profiles` table structure.
- Admin UI changes in `app/admin/page.tsx` must use existing API routes (`/api/admin/faculty`).

---

## Shared Schema Decisions (Agent 1 to Confirm with Each Agent)

### Decision 1: New Profile Columns

**Rule:** Any agent adding a new column to `profiles` must:
1. Use `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` (idempotent)
2. Make the column nullable with a sensible default
3. Update `lib/profile.ts`:
   - `normalizeProfile()` — add the field
   - `profileWritableFields()` — include if user-editable
   - `fallbackProfileFromAuth()` — include if derivable from auth metadata
4. Update `lib/types.ts` — add to `Profile` interface
5. Notify Agent 1 before applying

**Current profiles columns (do not redefine):**
```
id, usn, name, year, branch, section, bio, avatar_url, skills,
created_at, email, interests, thumbhash, role, faculty_status,
designation, employee_id, expertise, updated_at
```

### Decision 2: handle_new_user Behavior

**Current behavior (correct):**
```sql
insert into public.profiles (
  id, email, name, usn, year, branch, section, bio,
  skills, interests, role, faculty_status
) values (...)
on conflict (id) do update set
  email = excluded.email,
  name = coalesce(nullif(public.profiles.name, ''), excluded.name);
```

**Rule:** Agents may not change which columns are written by `handle_new_user`. If new fields need auto-population on signup, file a separate request to Agent 1.

### Decision 3: RLS Policy Pattern

**Rule:** All new RLS policies must follow the existing pattern:
```sql
drop policy if exists "<policy-name>" on public.<table>;
create policy "<policy-name>" on public.<table>
  for <command> using (<qual>) with check (<with-check>);
```

**Never:** disable RLS, use `PERMISSIVE`/`RESTRICTIVE` overrides, or bypass RLS with `SECURITY invoker` on new tables.

### Decision 4: Trigger Naming

**Rule:** New triggers follow the naming convention `trg_<table>_<purpose>`. Existing triggers must not be renamed or removed.

---

## Verification After Each Migration

Primary verification (after every migration or batch): run
`supabase/verify_schema.sql` — it checks definitions, not just names, and
gates pass/fail automatically (runbook §4). The ad-hoc queries below remain
useful for focused inspection; the trigger query is corrected from an older
version of this document (`pg_trigger` has **no `tgnamespace` column** — the
namespace must be resolved through the triggering table):

```sql
-- 1. Schema verification
-- (from supabase/verify_schema.sql)

-- 2. Replication identity check
SELECT relname, relreplicaidentity
FROM pg_class
WHERE relnamespace = 'public'::regnamespace
  AND relkind = 'r';

-- 3. Function signature check
SELECT routine_name, routine_type
FROM information_schema.routines
WHERE routine_schema = 'public'
ORDER BY routine_name;

-- 4. Policy check
SELECT tablename, policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- 5. Trigger check
SELECT t.tgname, t.tgrelid::regclass AS table_name, t.tgenabled
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
WHERE NOT t.tgisinternal
  AND c.relnamespace = 'public'::regnamespace
ORDER BY table_name::text, t.tgname;
```

---

## Conflict Matrix

| Agent | Cannot Edit | Must Coordinate With |
|---|---|---|
| 2 (handle_new_user) | `profiles` table structure | Agent 1 |
| 3 (comments/feed) | `profiles`, `connection_requests`, `faculty_applications` | Agent 1 |
| 4 (events/rsvps) | `profiles`, `connection_requests`, `faculty_applications` | Agent 1 |
| 5 (messaging) | `profiles`, `connection_requests`, `faculty_applications`, `events` | Agent 1 |
| 6 (faculty directory) | `faculty_applications` schema, `connection_requests` | Agent 1, Agent 2 |
| 7 (admin dashboard) | `faculty_applications` schema, `profiles` structure | Agent 1, Agent 6 |

**Agents 3–7 must not edit:**
- `supabase/migrations/2026101301_network_and_faculty.sql`
- `supabase/migrations/2026101302_network_fixes.sql`
- `supabase/migrations/2026101303_usn_unique_and_columns.sql`
- `supabase/schema.sql` (unless consolidating all migrations — coordinate with Agent 1)

---

## Deployment Sequence

```
1. Agent 1 publishes this document + docs/database-audit.md
2. Each agent (2–7) reviews the conflict matrix and confirms shared decisions
3. Agents apply migrations IN ORDER (2 → 3 → 4 → 5 → 6 → 7)
   [actual landed files: see the Current State table above]
4. After each migration: NOTIFY pgrst, 'reload schema';   (10/22 files self-notify)
5. After all migrations: run full verify_schema.sql
6. Run npm run build to confirm zero TypeScript errors
7. Manual functional testing per checklist in docs/database-audit.md §10
```

**UCC 2.0 Phase 1 addendum (2026-10-22):**

```
1. Read docs/ucc2-phase1-runbook.md end to end
2. Pre-flight: supabase/diagnostics/usn_collisions.sql + restore point (runbook §2)
3. Apply, in order, 2026102201 → 02 → 03 → 04 (transactional; re-runnable
   except 03, which blocks on unresolved collisions — runbook §6)
4. supabase/verify_schema.sql  → VERIFICATION PASSED
5. supabase/test-ucc2-phase1.sql → PASS 1–7 (editor: strip \echo lines)
6. Confirm the new signup guard behaves for users (runbook §7)
```
