# Migration Dependency & Execution Order

**Author:** Agent 1 — Database Audit and Migration Coordinator  
**Date:** 2026-10-14  
**Status:** Proposed — awaiting coordination with Agents 2–7

---

## Current State (Already Applied to Live DB)

These migrations are the current baseline. **Do not re-apply.**

| # | File | Purpose | Applied? |
|---|---|---|---|
| 1 | `20261013_network_and_faculty.sql` | Base: profiles expanded, events, posts, comments, faculty_applications, connection_requests, conversations, messages, announcements, all functions + triggers + RLS | ✅ (per repo history) |
| 2 | `20261013_network_fixes.sql` | Legacy user_profiles sync, protect employee_id/designation, connection participant immutability, partial unique indices, race-safe conversations | ✅ (per repo history) |
| 3 | `20261013_usn_unique_and_columns.sql` | USN normalization, partial unique index for students, protect_profile_privileges extended to USN | ✅ (per repo history) |

**Verification command after baseline:**
```sql
-- Run supabase/verify_schema.sql in Supabase SQL Editor
-- Then confirm:
NOTIFY pgrst, 'reload schema';
```

---

## Proposed Migration Execution Order (Agents 2–7)

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

After each agent applies their migration, run:

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
SELECT tgname, tgrelid::regclass AS table_name, tgenabled
FROM pg_trigger
WHERE NOT tgisinternal
  and tgnamespace = 'public'::regnamespace
ORDER BY tgrelid::regclass::text, tgname;
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
- `supabase/migrations/20261013_network_and_faculty.sql`
- `supabase/migrations/20261013_network_fixes.sql`
- `supabase/migrations/20261013_usn_unique_and_columns.sql`
- `supabase/schema.sql` (unless consolidating all migrations — coordinate with Agent 1)

---

## Deployment Sequence

```
1. Agent 1 publishes this document + docs/database-audit.md
2. Each agent (2–7) reviews the conflict matrix and confirms shared decisions
3. Agents apply migrations IN ORDER (2 → 3 → 4 → 5 → 6 → 7)
4. After each migration: NOTIFY pgrst, 'reload schema';
5. After all migrations: run full verify_schema.sql
6. Run npm run build to confirm zero TypeScript errors
7. Manual functional testing per checklist in docs/database-audit.md §10
```
