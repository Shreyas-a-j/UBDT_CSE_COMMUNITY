# UBDT CSE Community — Supabase Schema Audit Report

**Date:** 2026-10-13  
**Scope:** `supabase/schema.sql`, `supabase/migrations/20261013_network_and_faculty.sql`  
**Method:** Static code review of SQL + TypeScript application code. No live database was accessible.  

---

## Executive Summary

The initial migration (`20261013_network_and_faculty.sql`) introduces networking, messaging, faculty workflow, and admin features. During static review, **13 issues** were identified across data integrity, race conditions, privilege escalation, and migration safety. All fixes are **additive and idempotent** — no tables are dropped, no user data is deleted.

---

## Issues Found and Fixes Applied

### Issue 1: Legacy `user_profiles` Sync References Non-Existent Columns

**Severity:** High (migration failure on real DBs)  
**Files:** `20261013_network_and_faculty.sql`, `schema.sql`

The sync block in the original migration references `up.username`, `up.display_name`, and `up.thumbhash` unconditionally. The actual `user_profiles` table (from `b09be1a`) never had these columns — it had `id, usn, name, year, branch, bio, avatar_url, skills, created_at`. The task explicitly warns: "Never assume an optional column exists."

**Fix:** The new migration `20261013_network_fixes.sql` replaces the hardcoded sync with a dynamic `DO $$` block that introspects `information_schema.columns` before referencing each legacy column. If `username` exists, it's used for `name`; if `thumbhash` exists, it's migrated; if `email` exists, it's copied — all conditionally.

### Issue 2: `protect_profile_privileges` Doesn't Protect `employee_id` and `designation`

**Severity:** High (privilege escalation)  
**Files:** `schema.sql`, migration

The trigger function only reset `role` and `faculty_status` for non-admin updaters. A faculty user with `role='faculty'` could PATCH their own `employee_id` or `designation` via the Supabase REST API, potentially impersonating another institution or inflating their credentials.

**Fix:** Extended `protect_profile_privileges()` to also set `new.employee_id := old.employee_id` and `new.designation := old.designation` for non-admin users.

### Issue 3: `connection_requests` — Participant IDs Are Mutable

**Severity:** Critical (request forgery)  
**Files:** `20261013_network_and_faculty.sql`

The RLS policy `"Participants update connections"` allows update by either party with `WITH CHECK (auth.uid() = requester_id or auth.uid() = addressee_id)`. This means a requester could change `addressee_id` to point to a different user, or a recipient could change `requester_id`. The `enforce_connection_transition` trigger only validated status changes, not participant ID changes.

**Fix:** Added a guard in `enforce_connection_transition()`:
```sql
if new.requester_id is distinct from old.requester_id or new.addressee_id is distinct from old.addressee_id then
  raise exception 'Cannot change connection participants';
end if;
```

### Issue 4: `connection_pair` Unique Constraint Prevents Re-Requests

**Severity:** Medium (feature breakage)  
**Files:** `20261013_network_and_faculty.sql`

The constraint `unique (requester_id, addressee_id)` creates an unconditional uniqueness constraint. If user A sends a request to user B, B rejects it, A cannot send a new request because the pair already exists in the table (with `status='rejected'`).

**Fix:** Dropped the `connection_pair` constraint and replaced it with a partial unique index on pending status only:
```sql
create unique index connection_pending_pair
  on public.connection_requests (requester_id, addressee_id)
  where status = 'pending';
```
The existing `connection_active_pair` index (which covers both `pending` and `accepted` with a direction-normalized pair) still prevents duplicate active connections.

### Issue 5: Faculty Application Status Not Enforced at DB Level

**Severity:** High (privilege escalation / workflow bypass)  
**Files:** `20261013_network_and_faculty.sql`

The `on_faculty_application_status` trigger is `AFTER UPDATE` — it reacts to status changes but does not prevent them. A non-admin could directly update a faculty application's `status` to `'approved'` via the REST API (the RLS policy `"Admins manage faculty applications"` requires `is_admin`, but only for the `WITH CHECK` clause — the `WITH USING` clause also requires admin, so this is partially protected). However, the insert policy allows any authenticated user to insert with any columns, including `reviewed_by`.

**Fix:** 
1. Added a `BEFORE INSERT OR UPDATE` trigger (`enforce_faculty_application_transition`) that:
   - Requires `status = 'pending'` on insert
   - Requires `reviewed_by IS NULL` and `reviewed_at IS NULL` on insert
   - Only allows admins to change `status` on update
   - Prevents status regression (approved → pending)
   - Only allows admins to set `reviewed_by` / `reviewed_at`
2. Updated the insert RLS policy to include `WITH CHECK` conditions:
   ```sql
   for insert with check (
     auth.uid() = user_id
     and status = 'pending'
     and reviewed_by IS NULL
     and reviewed_at IS NULL
   )
   ```

### Issue 6: `get_or_create_direct_conversation` Has a TOCTOU Race Condition

**Severity:** Medium (duplicate conversations)  
**Files:** `20261013_network_and_faculty.sql`

The function performs a `SELECT` to find an existing conversation, then an `INSERT` to create one if not found. Under concurrent access, two calls can both fail to find a conversation and both create new ones, resulting in duplicate conversations for the same pair of users.

**Fix:** Introduced a `direct_conversation_pairs` table with a primary key on `(lesser_user, greater_user)`. The function now uses:
```sql
insert into public.direct_conversation_pairs (lesser_user, greater_user, conversation_id)
values (lesser, greater, uuid_generate_v4())
on conflict (lesser_user, greater_user) do update
  set conversation_id = EXCLUDED.conversation_id
returning conversation_id into conv_id;
```
This atomically finds or creates the conversation pair, eliminating the race condition.

### Issue 7: No Constraint Preventing 3+ Participants in Direct Conversations

**Severity:** Low (data integrity)  
**Files:** migration

A direct (non-group) conversation should have exactly 2 participants. The schema had no constraint enforcing this.

**Fix:** Added a `before insert` trigger `enforce_conversation_participant_count` on `conversation_participants` that raises an exception if adding a participant to a non-group conversation would exceed 2 participants.

### Issue 8: Missing `updated_at` Auto-Update Triggers

**Severity:** Low (stale timestamps)  
**Files:** `schema.sql`

The `profiles`, `announcements`, `conversations`, and `faculty_applications` tables have `updated_at` columns, but no database triggers to auto-update them. The application sets them in some places (`profileWritableFields` includes `updated_at`), but direct DB updates (e.g., via the faculty approval trigger) would leave `updated_at` stale.

**Fix:** Added a generic `update_updated_at_column()` trigger function and attached it as a `BEFORE UPDATE` trigger on all four tables.

### Issue 9: Missing `Faculty view own application` RLS Policy

**Severity:** Low (feature gap)  
**Files:** `20261013_network_and_faculty.sql`

The faculty application RLS only had policies for:
- Admin can select all
- User can select their own
- User can insert own

But the `USING` clause on `"Users read own faculty applications"` was `auth.uid() = user_id or public.is_admin(auth.uid())`. This is correct, but there was no explicit `FOR SELECT` policy separate from `FOR ALL`. The original code used `FOR SELECT` with that USING clause, which is fine. No fix needed here — this was verified to be correct. The `"Faculty view own application"` policy was added in the updated schema for clarity.

### Issue 10: `direct_conversation_pairs` Table Missing from RLS

**Severity:** Low (security hardening)  
**Files:** migration

New table added without RLS enablement.

**Fix:** Added `alter table public.direct_conversation_pairs enable row level security;` and a policy that denies all direct access (the table is only manipulated by the `SECURITY DEFINER` function).

### Issue 11: `emit_notification` Function Not Explicitly Revoked

**Severity:** Low (security hardening)  
**Files:** `20261013_network_and_faculty.sql`

The function was revoked from `public` in the base migration but the GRANT statement was missing (only other functions had explicit grants). If a `SECURITY DEFINER` chain were miswired, this could allow unauthorized notification creation.

**Fix:** Added explicit `revoke all on function public.emit_notification(uuid, text, text, text, text) from public;` in the fix migration.

### Issue 12: Trigger Functions Not Explicitly Revoked

**Severity:** Low (security hardening)  
**Files:** migration

Internal trigger functions (`enforce_connection_transition`, `enforce_faculty_application_transition`, `enforce_conversation_participant_count`, `update_updated_at_column`) were created without `SECURITY DEFINER` (they don't need it) but were not explicitly revoked from `public`.

**Fix:** Added `revoke all on function ...` for each internal trigger function.

### Issue 13: No `connection_active_pair` Direction-Normalized Race

**Severity:** Verified Safe  
**Files:** `20261013_network_and_faculty.sql`

The `connection_active_pair` unique index uses `least()` / `greatest()` to normalize the pair direction. PostgreSQL's unique index handles concurrent inserts correctly — one transaction will acquire the row lock, the other will wait and then fail on conflict. **No fix needed.**

---

## Application Order

### For Existing Databases (with original `profiles` table and data):

```
1. Apply supabase/migrations/20261013_network_and_faculty.sql
   (the original migration, already in the repo)

2. Apply supabase/migrations/20261013_network_fixes.sql
   (the new fix migration — this patch)

3. Run: NOTIFY pgrst, 'reload schema';
   (or click "Reload Schema" in the Supabase SQL Editor)

4. Verify: Run supabase/verify_schema.sql
```

### For New Databases (fresh Supabase project):

```
1. Apply supabase/schema.sql
   (the complete schema — includes all fixes)

2. Run: NOTIFY pgrst, 'reload schema';

3. Verify: Run supabase/verify_schema.sql
```

---

## Rollback Guidance

**All migrations are additive.** To roll back a specific fix:

| Fix | Rollback Steps |
|-----|---------------|
| Legacy sync fix | Revert `20261013_network_and_faculty.sql` sync block (data already migrated; not reversible without data loss) |
| `employee_id`/`designation` protection | Drop trigger `trg_protect_profile_privileges` and recreate the original function |
| Connection participant immutability | Drop trigger `trg_connection_transition` |
| `connection_pair` → `connection_pending_pair` | Drop `connection_pending_pair`, recreate `constraint connection_pair unique (requester_id, addressee_id)` (will fail if duplicate pending pairs exist) |
| Faculty application transitions | Drop trigger `trg_faculty_application_transition` |
| Race-safe conversations | Drop table `direct_conversation_pairs` (will fail if data exists; must be done before any conversation creation) |
| Updated-at triggers | Drop the `trg_update_*_updated_at` triggers |
| Participant count enforcement | Drop trigger `trg_enforce_participant_count` |

**⚠️ Important:** Some rollbacks (especially `connection_pair` and `direct_conversation_pairs`) may fail if conflicting data exists. Always back up the database before rolling back.

---

## First Administrator Provisioning

**Procedure:** There is no self-service admin registration. The first admin must be provisioned via SQL:

```sql
-- 1. Sign up a normal user via the app (email: your-admin@example.com)
-- 2. After sign-up, promote them to admin:
UPDATE profiles
SET role = 'admin', faculty_status = 'verified'
WHERE email = 'your-admin@example.com';

-- 3. Verify:
SELECT id, email, role, faculty_status FROM profiles WHERE email = 'your-admin@example.com';
```

**Security notes:**
- Only someone with direct database access (Supabase SQL Editor / service_role) can run this.
- The `protect_profile_privileges` trigger ensures no user can set their own `role` to `admin` via the profile update API — the trigger resets `role` to `old.role` for non-admins.
- The `handle_new_user` function always sets `role = 'student'` for new sign-ups.
- Faculty signups go through the application workflow: `faculty_status = 'pending'` → admin approves → `role = 'faculty'`, `faculty_status = 'verified'`.

---

## Security Model

### Role Hierarchy
```
admin            → Full access. Can approve faculty, manage all applications, CRUD all content.
faculty (verified) → Create announcements, events. Can view faculty dashboard.
student          → Default role. Can create posts, RSVP events, send connection requests, message connections.
```

### Privilege Escalation Prevention
- **Profile role/faculty_status:** Protected by `protect_profile_privileges` trigger — only the `is_admin` function (which checks the DB) can allow a role change.
- **Profile employee_id/designation:** Protected by the same trigger — only admins can set these.
- **Faculty application status:** Protected by `enforce_faculty_application_transition` — only admins can change status; users can only insert with `status='pending'`.
- **Connection participants:** Protected by `enforce_connection_transition` — `requester_id` and `addressee_id` cannot be changed after insert.
- **Message sender_id:** The `messages` table has no UPDATE policy, so updates are denied by RLS.
- **Conversation participants:** No INSERT policy exists; participants can only be added via the `SECURITY DEFINER` function `get_or_create_direct_conversation`.

### RLS Policy Summary

| Table | Select | Insert | Update | Delete |
|-------|--------|--------|--------|--------|
| profiles | Public | User's own, role=student | User's own (privilege fields protected by trigger) | — |
| events | Public | auth.uid = host_id | Host or admin | Host or admin |
| event_rsvps | Public | auth.uid = user_id | Own | Own |
| posts | Public | author_id = auth.uid | Author or admin | Author or admin |
| comments | Public | author_id = auth.uid | — | Author or admin |
| likes | Public | user_id = auth.uid | Own | Own |
| upvotes | Public | user_id = auth.uid | Own | Own |
| notifications | auth.uid = user_id | — | Own | — |
| faculty_applications | Own user_id or admin | Own, status=pending, no reviewer | Admin only | — |
| connection_requests | requester or addressee | requester = auth.uid, status=pending | Either party (IDs immutable) | — |
| conversations | is_conversation_participant | Only via function | Participant | — |
| conversation_participants | is_conversation_participant | Only via function | Own row | — |
| messages | is_conversation_participant | sender_id = auth.uid | — | — |
| announcements | Public | is_verified_faculty | Author or admin | Author or admin |
| direct_conversation_pairs | Deny all | Deny all | Deny all | Deny all |

---

## Verification Steps

### Static Verification (no live DB required)
```bash
# 1. TypeScript compilation
npx tsc --noEmit

# 2. Production build
npm run build

# 3. Lint
npm run lint
```

### Database Verification (requires Supabase SQL Editor)
```sql
-- Run the verification script
-- File: supabase/verify_schema.sql
-- Or paste individual queries to check:

-- Check all tables exist
SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';

-- Check RLS is enabled on all tables
SELECT relname, relrowsecurity FROM pg_class
WHERE relnamespace = 'public'::regnamespace AND relkind = 'r';

-- Check all policies exist
SELECT tablename, policyname, cmd FROM pg_policies WHERE schemaname = 'public';

-- Check triggers exist
SELECT tgname, tgrelid::regclass FROM pg_trigger
WHERE NOT tgisinternal AND tgnamespace = 'public'::regnamespace;

-- Check indexes
SELECT indexname, tablename FROM pg_indexes WHERE schemaname = 'public';

-- Check constraints
SELECT table_name, constraint_name, constraint_type
FROM information_schema.table_constraints
WHERE table_schema = 'public';
```

### Functional Testing
1. **Authentication:** Sign up as student, sign up as faculty, verify profile auto-creation.
2. **Profile migration:** If `user_profiles` exists, verify data syncs to `profiles`.
3. **Connections:** Send, accept, reject, cancel requests. Verify no duplicate active pairs. Verify IDs immutable.
4. **Messaging:** Message a connected user. Verify only participants can read. Verify unread counts.
5. **Faculty approval:** Sign up as faculty, login as admin, approve application. Verify role changes to `faculty`.
6. **Privilege escalation:** Attempt to PATCH own `role` or `employee_id` as non-admin. Verify trigger blocks it.

---

## Files Changed

| File | Action |
|------|--------|
| `supabase/migrations/20261013_network_fixes.sql` | **NEW** — Additive fix migration |
| `supabase/schema.sql` | **UPDATED** — Complete schema for new installs (includes all fixes) |
| `supabase/verify_schema.sql` | **NEW** — Verification SQL script |
| `SCHEMA_AUDIT_REPORT.md` | **NEW** — This document |

## Files NOT Modified (Working Features Preserved)

- All `app/**` pages — no UI or logic changes
- All `components/**` — no UI or logic changes
- All `hooks/**` — no changes to application logic
- All `lib/**` — no changes to application logic
- All `contexts/**` — no changes to application logic
