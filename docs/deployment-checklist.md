# Supabase SQL Deployment Checklist & Verification Queries

**Author:** Agent 1 — Database Audit and Migration Coordinator  
**Date:** 2026-10-14  
**Status:** Ready for execution

---

## Part A: Deployment Checklist

### Pre-Deployment

- [ ] All three baseline migrations have been applied to the live Supabase database:
  - [ ] `2026101301_network_and_faculty.sql`
  - [ ] `2026101302_network_fixes.sql`
  - [ ] `2026101303_usn_unique_and_columns.sql`
- [ ] `NOTIFY pgrst, 'reload schema';` has been executed after each migration
- [ ] TypeScript build is clean: `npm run build` exits 0
- [ ] `docs/database-audit.md` and `docs/conflict-report.md` are in place

### Agent Migration Deployment (in order)

For each agent migration applied:

- [ ] Migration file is **additive only** (no DROP TABLE, no DELETE, no column removal)
- [ ] Migration is **idempotent** (`IF NOT EXISTS`, `DROP ... IF EXISTS`, `ALTER ... IF EXISTS`)
- [ ] Migration ends with `NOTIFY pgrst, 'reload schema';`
- [ ] Post-migration verification script runs clean (see Part B below)

### Post-All-Migrations

- [ ] Run full `supabase/verify_schema.sql` — all checks pass
- [ ] Run `npm run build` — exits 0 with no TypeScript errors
- [ ] Manual functional testing complete (see Part C below)
- [ ] Git commit all new migration files with descriptive messages
- [ ] Push to `origin/main`

---

## Part B: Verification Queries

Run these in the Supabase SQL Editor after each migration step.

### B1: Table Inventory

```sql
SELECT table_name, table_type
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;
```

**Expected (15 tables):**
```
announcements
comments
connection_requests
conversations
conversation_participants
direct_conversation_pairs
event_rsvps
events
faculty_applications
likes
messages
notifications
posts
profiles
upvotes
```

### B2: Profiles Column Inventory

```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'profiles'
ORDER BY ordinal_position;
```

**Expected columns (19):**
```
id                uuid          NO     -
usn               text          YES    -
name              text          NO     'Member'::text
year              integer       YES    -
branch            text          NO     'CSE'::text
bio               text          YES    -
avatar_url        text          YES    -
skills            ARRAY         YES    '{}'::text[]
created_at        timetz        NO     timezone('UTC'::text, now())
email             text          YES    -
section           text          YES    -
interests         ARRAY         YES    '{}'::text[]
thumbhash         text          YES    -
role              text          NO     'student'::text
faculty_status    text          NO     'none'::text
designation       text          YES    -
employee_id       text          YES    -
expertise         ARRAY         YES    '{}'::text[]
updated_at        timetz        YES    timezone('UTC'::text, now())
```

### B3: Constraint Verification

```sql
SELECT
  tc.table_name,
  tc.constraint_name,
  tc.constraint_type
FROM information_schema.table_constraints tc
WHERE tc.table_schema = 'public'
  and tc.constraint_type in ('PRIMARY KEY', 'FOREIGN KEY', 'UNIQUE', 'CHECK')
ORDER BY tc.table_name, tc.constraint_type, tc.constraint_name;
```

**Key constraints to verify:**
- `profiles` PK on `id`
- `profiles` FK on `id` → `auth.users(id)` ON DELETE CASCADE
- `profiles` UNIQUE on `usn`
- `profiles` CHECK: `profiles_role_check`
- `profiles` CHECK: `profiles_year_check`
- `profiles` CHECK: `profiles_faculty_status_check`
- `connection_requests` CHECK: `connection_no_self`
- `connection_requests` partial unique index: `connection_pending_pair`
- `connection_requests` partial unique index: `connection_active_pair`
- `faculty_applications` partial unique index: `faculty_applications_one_pending`

### B4: Index Verification

```sql
SELECT indexname, tablename, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;
```

**Key indexes to verify:**
- `profiles_lower_name_idx`
- `profiles_usn_idx`
- `profiles_year_idx`
- `profiles_role_idx`
- `profiles_branch_idx`
- `profiles_skills_gin` (GIN)
- `profiles_interests_gin` (GIN)
- `profiles_student_usn_unique` (partial, students only)
- `connection_pending_pair` (partial)
- `connection_active_pair` (partial)
- `faculty_applications_one_pending` (partial)

### B5: Trigger Verification

```sql
SELECT
  tgname AS trigger_name,
  tgrelid::regclass AS table_name,
  tgenabled AS enabled,
  proname AS function_name
FROM pg_trigger t
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE NOT t.tgisinternal
  AND t.tgnamespace = 'public'::regnamespace
ORDER BY tgrelid::regclass::text, tgname;
```

**Expected triggers (12):**
```
on_auth_user_created          auth.users           I
trg_connection_change         connection_requests  U
trg_connection_transition     connection_requests  U
trg_enforce_participant_count conversation_participants I
trg_faculty_application_status faculty_applications U
trg_faculty_application_transition faculty_applications IU
trg_message_insert            messages             I
trg_protect_profile_privileges profiles           U
trg_update_announcements_updated_at announcements  U
trg_update_conversations_updated_at conversations  U
trg_update_faculty_app_updated_at faculty_applications U
trg_update_profiles_updated_at    profiles          U
```

### B6: RLS Policy Verification

```sql
SELECT
  tablename,
  policyname,
  cmd AS command,
  qual IS NOT NULL AS has_using,
  with_check IS NOT NULL AS has_with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
```

**Expected: 14 tables with RLS enabled, ~30+ policies total.**

### B7: Function Signature Verification

```sql
SELECT
  routine_name,
  routine_type,
  character_maximum_length
FROM information_schema.routines
WHERE routine_schema = 'public'
ORDER BY routine_name;
```

**Key functions to verify exist:**
- `handle_new_user()`
- `protect_profile_privileges()`
- `update_updated_at_column()`
- `is_admin(uuid)`
- `is_verified_faculty(uuid)`
- `are_connected(uuid, uuid)`
- `is_conversation_participant(uuid)`
- `emit_notification(uuid, text, text, text, text)`
- `on_faculty_application_status()`
- `enforce_faculty_application_transition()`
- `on_connection_change()`
- `enforce_connection_transition()`
- `on_message_insert()`
- `get_or_create_direct_conversation(uuid)`
- `enforce_conversation_participant_count()`

### B8: Auth User / Profile Orphan Check

```sql
-- Auth users missing profiles
SELECT u.id, u.email, u.created_at
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.id IS NULL
ORDER BY u.created_at;

-- Profiles missing auth users
SELECT p.id, p.name, p.email, p.created_at
FROM public.profiles p
LEFT JOIN auth.users u ON u.id = p.id
WHERE u.id IS NULL
ORDER BY p.created_at;
```

### B9: Duplicate USN Diagnostic (Students Only)

```sql
SELECT
  upper(btrim(usn)) AS normalized_usn,
  count(*) AS profile_count,
  array_agg(id::text) AS profile_ids
FROM public.profiles
WHERE role = 'student' AND usn IS NOT NULL AND btrim(usn) <> ''
GROUP BY upper(btrim(usn))
HAVING count(*) > 1;
```

### B10: Faculty Application Status Distribution

```sql
SELECT status, count(*) AS application_count
FROM public.faculty_applications
GROUP BY status
ORDER BY status;
```

### B11: Realtime Publication Check

```sql
SELECT
  relname AS table_name,
  relreplicaidentity AS replica_identity
FROM pg_class
WHERE relnamespace = 'public'::regnamespace
  AND relkind = 'r'
  AND relname IN ('messages', 'notifications', 'conversation_participants')
ORDER BY relname;
```

**Expected:** All three tables show `f` (full replica identity).

---

## Part C: Manual Functional Testing

### C1: New User Signup (Student)

1. Navigate to `/signup`
2. Fill in: Name, USN, Email, Year, Section, Skills
3. Submit
4. **Verify:**
   - [ ] Redirected to `/`
   - [ ] Profile row exists in `profiles` with `role='student'`, `faculty_status='none'`
   - [ ] USN is normalized (uppercased, trimmed)
   - [ ] `created_at` is set correctly

### C2: New User Signup (Faculty)

1. Navigate to `/signup/faculty`
2. Fill in: Full Name, Official Email, Department, Designation, Employee ID (optional), Password
3. Submit
4. **Verify:**
   - [ ] Auth user created
   - [ ] Profile row exists with `role='student'`, `faculty_status='pending'`
   - [ ] `faculty_applications` row created with `status='pending'`
   - [ ] Application shows in `/admin` for admin review

### C3: Faculty Approval (Admin)

1. Sign in as admin
2. Navigate to `/admin`
3. Find a pending application
4. Click "Approve"
5. **Verify:**
   - [ ] Profile `role` updated to `'faculty'`
   - [ ] Profile `faculty_status` updated to `'verified'`
   - [ ] Profile `designation` updated from application
   - [ ] Notification emitted to the user
   - [ ] Application status changed to `'approved'`

### C4: Connection Request Flow

1. Sign in as User A
2. Browse `/people`, find User B
3. Click "Connect"
4. **Verify:**
   - [ ] `connection_requests` row created with `status='pending'`
   - [ ] Notification emitted to User B
5. Sign in as User B
6. Navigate to `/connections` → "Received" tab
7. Click "Accept"
8. **Verify:**
   - [ ] Connection status changed to `'accepted'`
   - [ ] Notification emitted to User A
   - [ ] User A appears in User B's connections
   - [ ] User B appears in User A's connections

### C5: Connection Immutability Test

1. Sign in as User A
2. Send connection request to User B
3. Attempt to update `requester_id` or `addressee_id` via Supabase REST API
4. **Verify:** Request is rejected with "Cannot change connection participants"

### C6: Faculty Privilege Protection Test

1. Sign in as a faculty user (not admin)
2. Attempt to PATCH own profile setting `role = 'admin'`
3. **Verify:** Update is rejected by `protect_profile_privileges` trigger

### C7: Comment FK Integrity

1. Sign in as a user
2. Create a post
3. Add a comment to the post
4. **Verify:** No foreign key violation; comment is created successfully

### C8: Event RSVP FK Integrity

1. Sign in as a user
2. Browse events
3. RSVP to an event
4. **Verify:** No foreign key violation; RSVP is created successfully

### C9: Messaging Access Control

1. Sign in as User A
2. Connect with User B (accept the request)
3. Navigate to `/messages` — should see User B
4. Click to start conversation
5. **Verify:**
   - [ ] `get_or_create_direct_conversation` RPC succeeds
   - [ ] Conversation created with both participants
   - [ ] Message can be sent and received in real-time

### C10: Admin Route Protection

1. Sign in as a non-admin user
2. Navigate to `/admin`
3. **Verify:** Redirected to `/`

### C11: Faculty Dashboard Protection

1. Sign in as a student (not faculty)
2. Navigate to `/faculty/dashboard`
3. **Verify:** Redirected to `/faculty`

### C12: TypeScript Build

```bash
npm run build
```

**Verify:** Exits 0 with no TypeScript errors.
