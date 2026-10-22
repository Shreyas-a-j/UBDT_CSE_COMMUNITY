# Database Audit Report

**Date:** 2026-10-14  
**Auditor:** Agent 1 — Database Audit and Migration Coordinator  
**Repository:** UBDT CSE Community  
**Scope:** All SQL migrations, schema definition, TypeScript types, Supabase queries, constraints, indexes, triggers, and RLS policies.

---

## 1. Canonical Schema Reference

The canonical schema for **new installs** is `supabase/schema.sql`. It is a complete, self-contained file that creates every table, function, trigger, policy, and index in a single idempotent pass.

For **existing databases**, the canonical upgrade path is:

```
1. supabase/migrations/2026101301_network_and_faculty.sql   (base: tables + functions + RLS)
2. supabase/migrations/2026101302_network_fixes.sql         (fixes: sync, triggers, constraints)
3. supabase/migrations/2026101303_usn_unique_and_columns.sql (fixes: USN uniqueness, protect USN)
4. NOTIFY pgrst, 'reload schema';
5. Verify with supabase/verify_schema.sql
```

Both paths should converge to the same schema state.

---

## 2. Existing Schema Objects

### 2.1 Tables (13 public tables)

| Table | Purpose | FK → profiles(id) |
|---|---|---|
| `profiles` | Canonical user profile (PK = auth.users.id) | — |
| `events` | Events / workshops | host_id ON DELETE CASCADE |
| `event_rsvps` | Event attendance | event_id, user_id ON DELETE CASCADE |
| `posts` | Discussion & showcase posts | author_id ON DELETE CASCADE |
| `comments` | Post comments (self-referencing via parent_id) | post_id, author_id ON DELETE CASCADE; parent_id ON DELETE CASCADE |
| `likes` | Post likes | post_id, user_id ON DELETE CASCADE |
| `upvotes` | Post upvotes | post_id, user_id ON DELETE CASCADE |
| `notifications` | User notifications | user_id ON DELETE CASCADE |
| `faculty_applications` | Faculty verification workflow | user_id ON DELETE CASCADE; reviewed_by ON DELETE SET NULL |
| `connection_requests` | Connection requests | requester_id, addressee_id ON DELETE CASCADE |
| `conversations` | Chat conversations | — |
| `conversation_participants` | Conversation members | conversation_id, user_id ON DELETE CASCADE |
| `messages` | Chat messages | conversation_id, sender_id ON DELETE CASCADE |
| `announcements` | Faculty announcements | author_id ON DELETE CASCADE |
| `direct_conversation_pairs` | 1:1 conversation pair index (race-safe) | lesser_user, greater_user, conversation_id ON DELETE CASCADE |

### 2.2 Key Constraints

**profiles:**
- `id` → `auth.users.id` ON DELETE CASCADE, primary key
- `usn` unique (partial unique index `profiles_student_usn_unique` for students only, case-insensitive)
- `role` check: `('student', 'faculty', 'admin')`
- `faculty_status` check: `('none', 'pending', 'verified', 'rejected')`
- `year` check: 1–4
- `protect_profile_privileges` trigger protects `role`, `faculty_status`, `employee_id`, `designation`, `usn` from non-admin self-update

**faculty_applications:**
- Unique partial index: one `pending` application per `user_id`
- `enforce_faculty_application_transition` trigger blocks invalid inserts/updates
- `on_faculty_application_status` trigger auto-updates profile on approval/rejection

**connection_requests:**
- `connection_no_self` check (requester ≠ addressee)
- `connection_pending_pair` partial unique index (one pending per requester→addressee)
- `connection_active_pair` partial unique index (one active connection per unordered pair)
- `enforce_connection_transition` trigger guards status changes and participant immutability
- `on_connection_change` trigger emits notifications

### 2.3 Indexes

| Index | Table | Purpose |
|---|---|---|
| `profiles_lower_name_idx` | profiles | Search by name (lowercase) |
| `profiles_usn_idx` | profiles | USN lookup |
| `profiles_year_idx` | profiles | Year filter |
| `profiles_role_idx` | profiles | Role filter |
| `profiles_branch_idx` | profiles | Branch filter |
| `profiles_skills_gin` | profiles | GIN array search |
| `profiles_interests_gin` | profiles | GIN array search |
| `profiles_student_usn_unique` | profiles | Student USN uniqueness (partial) |
| `notifications_user_created_idx` | notifications | Ordered fetch |
| `announcements_created_idx` | announcements | Ordered fetch |
| `messages_conversation_created_idx` | messages | Ordered fetch |
| `connection_addressee_status_idx` | connection_requests | Incoming request fetch |
| `connection_requester_status_idx` | connection_requests | Outgoing request fetch |
| `direct_conversation_pairs_conv_idx` | direct_conversation_pairs | Lookup by conversation |

### 2.4 Functions (SECURITY DEFINER)

| Function | Purpose |
|---|---|
| `public.is_admin(uid)` | Check admin role |
| `public.is_verified_faculty(uid)` | Check faculty+verified or admin |
| `public.are_connected(a, b)` | Check accepted connection |
| `public.is_conversation_participant(cid)` | Check message access |
| `public.emit_notification(...)` | Insert notification (internal only) |
| `public.handle_new_user()` | Trigger: create profile on auth signup |
| `public.protect_profile_privileges()` | Trigger: block non-admin role/status changes |
| `public.update_updated_at_column()` | Trigger: auto-populate updated_at |
| `public.on_faculty_application_status()` | Trigger: update profile on approval/rejection |
| `public.enforce_faculty_application_transition()` | Trigger: validate faculty status changes |
| `public.on_connection_change()` | Trigger: emit connection notifications |
| `public.enforce_connection_transition()` | Trigger: validate connection status transitions |
| `public.on_message_insert()` | Trigger: update conversation + emit notification |
| `public.get_or_create_direct_conversation(other_user)` | RPC: race-safe conversation creation |
| `public.enforce_conversation_participant_count()` | Trigger: max 2 participants for direct convos |

### 2.5 Triggers

| Trigger | Table | Event | Function |
|---|---|---|---|
| `on_auth_user_created` | auth.users | AFTER INSERT | handle_new_user |
| `trg_protect_profile_privileges` | profiles | BEFORE UPDATE | protect_profile_privileges |
| `trg_update_profiles_updated_at` | profiles | BEFORE UPDATE | update_updated_at_column |
| `trg_update_announcements_updated_at` | announcements | BEFORE UPDATE | update_updated_at_column |
| `trg_update_conversations_updated_at` | conversations | BEFORE UPDATE | update_updated_at_column |
| `trg_update_faculty_app_updated_at` | faculty_applications | BEFORE UPDATE | update_updated_at_column |
| `trg_faculty_application_transition` | faculty_applications | BEFORE INSERT/UPDATE | enforce_faculty_application_transition |
| `trg_faculty_application_status` | faculty_applications | AFTER UPDATE | on_faculty_application_status |
| `trg_connection_transition` | connection_requests | BEFORE UPDATE | enforce_connection_transition |
| `trg_connection_change` | connection_requests | AFTER INSERT/UPDATE | on_connection_change |
| `trg_message_insert` | messages | AFTER INSERT | on_message_insert |
| `trg_enforce_participant_count` | conversation_participants | BEFORE INSERT | enforce_conversation_participant_count |

### 2.6 RLS Policies

All 14 tables have RLS enabled. Key policy highlights:

- `profiles`: public SELECT; self INSERT/UPDATE (privilege fields protected by trigger)
- `faculty_applications`: own/admin SELECT; self INSERT (pending only); admin UPDATE
- `connection_requests`: relevant parties SELECT; requester INSERT; either party UPDATE
- `conversations/messages`: participant-only via `is_conversation_participant()` helper
- `direct_conversation_pairs`: ALL DENIED (write only via RPC)
- `notifications`: user's own only
- `announcements`: public SELECT; verified faculty INSERT; author/admin UPDATE/DELETE

### 2.7 Realtime Publication

Tables with `replica identity full` in `supabase_realtime` publication:
- `messages`
- `notifications`
- `conversation_participants`

---

## 3. Missing / Previously Missing Objects

The following were historically missing and are now **present in all migrations and schema.sql**:

| Object | Status | Migrated By |
|---|---|---|
| `public.faculty_applications` | ✅ Present | migration 1 |
| `public.connection_requests` | ✅ Present | migration 1 |
| `profiles.email` column | ✅ Present | migration 1 |
| `profiles.thumbhash` column | ✅ Present | migration 1 |
| `profiles.updated_at` column | ✅ Present | migration 1 |
| `profiles.designation` column | ✅ Present | migration 1 |
| `profiles.employee_id` column | ✅ Present | migration 1 |
| `profiles.faculty_status` column | ✅ Present | migration 1 |
| `profiles.expertise` column | ✅ Present | migration 1 |
| `profiles.role` column | ✅ Present | migration 1 |
| `profiles.section` column | ✅ Present | migration 1 |
| `profiles.interests` column | ✅ Present | migration 1 |
| `profiles.direct_conversation_pairs` table | ✅ Present | migration 2 |
| `on_auth_user_created` trigger on auth.users | ✅ Present | all migrations |
| `profiles_student_usn_unique` partial index | ✅ Present | migration 3 |
| `connection_pending_pair` partial unique index | ✅ Present | migration 2 |

---

## 4. Known Errors & Risk Factors

### 4.1 handle_new_user Insert Target (FIXED — Agent 2 owns)

**Problem (historical):** The task description states `handle_new_user` currently inserts into `public.user_profiles` instead of `public.profiles`. However, inspection of the current codebase shows the function correctly targets `public.profiles` in all three migration files and `schema.sql`.

**Resolution:** This was already fixed. Agent 2's task (per the original instructions) is confirmed complete for this item. No additional migration needed.

### 4.2 Auth Users Without Matching Profiles

**Problem:** Some `auth.users` rows exist without corresponding `profiles` rows. When the app later attempts to insert a `comment` or `event_rsvp` referencing such a user, the FK constraint `profiles(id) ON DELETE CASCADE` will fail with a foreign-key violation.

**Risk:** High — any authenticated user without a profile row will get a 500 error on their first comment or RSVP.

**Mitigation (in progress):** `AuthContext.tsx` already has a fallback that inserts a profile row if one is missing (lines ~57–80). However, this insert can fail silently due to race conditions or schema cache lag.

**Recommendation for Agents:** Any migration should **not** drop or alter existing profiles. Adding orphan auth users' profiles should be done carefully via `ON CONFLICT (id) DO UPDATE` to avoid data loss.

### 4.3 Faculty Directory Querying `profiles.email`

**Problem (historical):** Faculty directory pages previously requested `profiles.email` which did not exist at schema creation time. This column is now present in all migrations.

**Resolution:** ✅ Column exists. No action needed.

### 4.4 Comment/RSVP FK Violations

**Problem:** `comments.author_id` and `event_rsvps.user_id` reference `profiles(id)`. If a user creates a comment or RSVP before their profile row is fully ready (race condition between auth signup and profile creation), the insert will fail.

**Risk:** Medium — intermittent 500 errors for new users.

**Mitigation:** Ensure `handle_new_user` trigger runs reliably on every auth signup. The current implementation is correct. Agent 2 should verify the trigger fires on all signup flows.

---

## 5. TypeScript Database Types vs. Actual Schema

### 5.1 Profile Interface (`lib/types.ts:15-36`)

| Field | TypeScript Type | DB Column | Match? |
|---|---|---|---|
| `id` | `string` | `uuid` (PK) | ✅ |
| `email` | `string \| null` | `text` nullable | ✅ |
| `usn` | `string \| null` | `text` nullable | ✅ |
| `name` | `string` | `text NOT NULL DEFAULT 'Member'` | ✅ |
| `year` | `number \| null` | `int` nullable | ✅ |
| `branch` | `string` | `text NOT NULL DEFAULT 'CSE'` | ✅ |
| `section` | `string \| null` | `text` nullable | ✅ |
| `bio` | `string \| null` | `text` nullable | ✅ |
| `avatar_url` | `string \| null` | `text` nullable | ✅ |
| `thumbhash` | `string \| null` | `text` nullable | ✅ |
| `skills` | `string[]` | `text[] DEFAULT '{}'` | ✅ |
| `interests` | `string[]` | `text[] DEFAULT '{}'` | ✅ |
| `role` | `UserRole` | `text` check constraint | ✅ |
| `faculty_status` | `FacultyStatus` | `text` check constraint | ✅ |
| `designation` | `string \| null` | `text` nullable | ✅ |
| `employee_id` | `string \| null` | `text` nullable | ✅ |
| `expertise` | `string[]` | `text[] DEFAULT '{}'` | ✅ |
| `created_at` | `string` | `timestamptz NOT NULL` | ✅ |
| `updated_at` | `string \| null` | `timestamptz` nullable | ✅ |
| `connection_count` | `number \| undefined` | — (computed, not in DB) | ✅ (virtual) |

### 5.2 ConnectionRequest Interface (`lib/types.ts:122-131`)

Matches `connection_requests` table plus virtual `requester`/`addressee` embedded profiles.

### 5.3 FacultyApplication Interface (`lib/types.ts:169-182`)

Matches `faculty_applications` table exactly.

### 5.4 Event, EventRsvp, Post, Comment, Notification, Conversation, Message, Announcement

All TypeScript interfaces map 1:1 to their respective tables.

---

## 6. Conflict Report — Files Multiple Agents Must Not Edit Independently

### 6.1 Migrations (DO NOT edit independently)

| File | Reason |
|---|---|
| `supabase/migrations/2026101301_network_and_faculty.sql` | Base migration. Agents 3–7 should build ADDITIVE migrations on top; do not modify this file. |
| `supabase/migrations/2026101302_network_fixes.sql` | Fix migration. Same rule applies. |
| `supabase/migrations/2026101303_usn_unique_and_columns.sql` | USN fix migration. Same rule applies. |
| `supabase/schema.sql` | Canonical reference. Only edit if consolidating all migrations into a new version. |

### 6.2 TypeScript Types (coordinate before editing)

| File | Reason |
|---|---|
| `lib/types.ts` | Every agent's queries reference these types. Adding new DB tables requires type additions here. Coordinate with Agent 1 before modifying. |

### 6.3 Shared Functions / Patterns

| File | Reason |
|---|---|
| `contexts/AuthContext.tsx` | Contains `fetchProfile()` and the fallback profile-creation logic. Any migration that adds profile columns must also consider the fallback insertion. **Agent 2 owns `handle_new_user` but Agent 1 must coordinate on profile column additions.** |
| `lib/profile.ts` | Contains `normalizeProfile()`, `profileWritableFields()`, `fallbackProfileFromAuth()`. New profile columns must be added to all three functions. **All agents adding profile fields must update this file.** |
| `app/api/admin/faculty/route.ts` + `[id]/route.ts` | Admin API for faculty applications. Agents 3–5 that touch faculty features must coordinate here. |
| `hooks/useConnections.ts` | Connection hook. Agents adding connection features must coordinate here. |
| `lib/supabase/middleware.ts` | Route protection logic. New protected routes require middleware updates. **Agent 1 must approve.** |

### 6.4 Pages Requiring Cross-Agent Coordination

| Page | Coordinates With |
|---|---|
| `app/people/[id]/page.tsx` | FEAT-003 (people directory), FEAT-004 (connections) |
| `app/connections/page.tsx` | FEAT-003 (connections UI) |
| `app/admin/page.tsx` | FEAT-005 (admin dashboard) |
| `app/signup/faculty/page.tsx` | FEAT-002 (faculty signup) |
| `app/faculty/dashboard/page.tsx` | FEAT-005 (faculty portal) |

---

## 7. Migration Naming Convention

Proposed convention for all future migrations:

```
YYYYMMDD_<feature-slug>.sql
```

Examples:
- `20261014_comments_v2.sql`
- `20261014_event_rsvps_add_reminder.sql`
- `20261014_announcements_add_featured.sql`

Each migration must:
1. Be **additive only** (no DROP TABLE, no DELETE, no column removal)
2. Be **idempotent** (use `IF NOT EXISTS`, `DROP ... IF EXISTS`, `ALTER ... IF EXISTS`)
3. End with `NOTIFY pgrst, 'reload schema';`
4. Include a header comment documenting what it does and its dependency order

---

## 8. Migration Dependency Order (Agents 2–7)

```
[BASE] Already applied:
  1. 2026101301_network_and_faculty.sql
  2. 2026101302_network_fixes.sql
  3. 2026101303_usn_unique_and_columns.sql

[AGENTS — apply in this order to avoid conflicts]

Step 0 (Agent 1 — you): Produce this audit.

Step 1 (Agent 2 — handle_new_user + profile sync):
  Migration: 20261014_handle_new_user_fix.sql
  Depends on: Steps 0, 1 (base migrations)
  Effects: Updates handle_new_user trigger function; ensures auth user → profile sync
  Coordination: Agents 3, 4, 5, 6, 7 must use the new handle_new_user behavior

Step 2 (Agent 3 — comments/feed improvements):
  Migration: 20261014_comments_and_feed.sql
  Depends on: Steps 0–1
  Effects: May add new columns to comments or posts
  Coordination: Must not touch profiles, connections, or faculty tables

Step 3 (Agent 4 — event RSVP enhancements):
  Migration: 20261014_event_rsvps_fix.sql
  Depends on: Steps 0–1
  Effects: May add reminder columns to events/event_rsvps
  Coordination: Must not touch comments, connections, or faculty tables

Step 4 (Agent 5 — messaging improvements):
  Migration: 20261014_messaging_fixes.sql
  Depends on: Steps 0–3
  Effects: May add columns to messages/conversations
  Coordination: Must not touch profiles, events, or faculty tables

Step 5 (Agent 6 — faculty directory enhancements):
  Migration: 20261014_faculty_directory.sql
  Depends on: Steps 0–4
  Effects: May add columns to profiles (expertise display) or announcements
  Coordination: Must coordinate with Agent 2 on profile column additions
  Must update lib/profile.ts normalizeProfile() if new columns added

Step 6 (Agent 7 — admin dashboard enhancements):
  Migration: 20261014_admin_enhancements.sql
  Depends on: Steps 0–5
  Effects: May add columns to faculty_applications
  Coordination: Must not redefine existing faculty_applications schema
```

**Critical shared decisions (Agent 1 must confirm with each agent before they proceed):**

| Decision | Affected Agents | Recommended Value |
|---|---|---|
| New profile columns beyond existing set | 2, 3, 4, 5, 6, 7 | Must be additive; must update `normalizeProfile()` and `profileWritableFields()` |
| `handle_new_user` insert columns | 2 | Must match current `schema.sql` (id, email, name, usn, year, branch, section, bio, skills, interests, role, faculty_status) |
| Faculty `profiles.email` usage | 5, 6 | `profiles.email` exists; safe to query |
| Connection pair semantics | 3, 4 | Use `connection_active_pair` partial index; respect immutability trigger |
| RLS policy additions | All | Must follow existing policy patterns; never disable RLS |

---

## 9. Existing Schema Inventory

### 9.1 Tables with Row Counts (diagnostic — run in Supabase SQL Editor)

```sql
SELECT
  'profiles' AS table_name, count(*) AS row_count FROM public.profiles
UNION ALL SELECT 'events', count(*) FROM public.events
UNION ALL SELECT 'event_rsvps', count(*) FROM public.event_rsvps
UNION ALL SELECT 'posts', count(*) FROM public.posts
UNION ALL SELECT 'comments', count(*) FROM public.comments
UNION ALL SELECT 'likes', count(*) FROM public.likes
UNION ALL SELECT 'upvotes', count(*) FROM public.upvotes
UNION ALL SELECT 'notifications', count(*) FROM public.notifications
UNION ALL SELECT 'faculty_applications', count(*) FROM public.faculty_applications
UNION ALL SELECT 'connection_requests', count(*) FROM public.connection_requests
UNION ALL SELECT 'conversations', count(*) FROM public.conversations
UNION ALL SELECT 'conversation_participants', count(*) FROM public.conversation_participants
UNION ALL SELECT 'messages', count(*) FROM public.messages
UNION ALL SELECT 'announcements', count(*) FROM public.announcements
UNION ALL SELECT 'direct_conversation_pairs', count(*) FROM public.direct_conversation_pairs;
```

### 9.2 Orphaned Auth Users (users without profiles)

```sql
SELECT u.id, u.email, u.created_at
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.id IS NULL
ORDER BY u.created_at;
```

### 9.3 Orphaned Profiles (profiles without auth users)

```sql
SELECT p.id, p.name, p.email, p.created_at
FROM public.profiles p
LEFT JOIN auth.users u ON u.id = p.id
WHERE u.id IS NULL
ORDER BY p.created_at;
```

---

## 10. Final Deployment Checklist

### Pre-Deployment Verification

- [ ] All three existing migrations applied in order (1 → 2 → 3)
- [ ] `NOTIFY pgrst, 'reload schema';` executed after each migration
- [ ] `supabase/verify_schema.sql` passes all checks
- [ ] Zero orphaned auth users with missing profiles (or acceptable small number)
- [ ] Zero duplicate pending connection pairs
- [ ] Zero duplicate pending faculty applications per user
- [ ] TypeScript build passes: `npm run build` exits 0

### Agent-Specific Checks (to be completed by each agent)

- [ ] **Agent 2:** `handle_new_user` inserts into `public.profiles` (verified in migration)
- [ ] **Agent 3:** New comment/feed columns don't break existing FK constraints
- [ ] **Agent 4:** Event RSVP schema changes don't break existing `event_rsvps` data
- [ ] **Agent 5:** Messaging changes don't affect existing conversation participants
- [ ] **Agent 6:** Faculty directory queries include `profiles.email` (already present)
- [ ] **Agent 7:** Admin dashboard uses existing `faculty_applications` schema unchanged

### Post-Deployment Verification

- [ ] Run `supabase/verify_schema.sql` again
- [ ] Sign up a new student — profile created automatically
- [ ] Sign up as faculty — `faculty_applications` row created, profile has `faculty_status='pending'`
- [ ] Send a connection request — notification emitted, partial unique index enforced
- [ ] Post a comment — FK to profiles succeeds
- [ ] RSVP to an event — FK to profiles succeeds
- [ ] Message a connection — `get_or_create_direct_conversation` RPC works
- [ ] Approve faculty application as admin — profile role updates to `faculty`
- [ ] Try to PATCH own `role` as non-admin — blocked by trigger
- [ ] Try to change connection participant IDs — blocked by trigger

---

## 11. Data Preservation Guarantees

- No migration drops any table
- No migration deletes any row
- No migration disables RLS
- No migration disables foreign keys
- No migration resets auth users
- Legacy `user_profiles` data is migrated to `profiles` via conditional sync (migration 2)
- All existing accounts and community data are preserved
