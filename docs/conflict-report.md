# Conflict Report — Files and Migrations Requiring Cross-Agent Coordination

**Author:** Agent 1 — Database Audit and Migration Coordinator  
**Date:** 2026-10-14

---

## Critical Conflicts (Multiple Agents Touching Same Object)

### C1: `profiles` Table Structure
**Affected Agents:** 2, 3 (indirectly), 4 (indirectly), 5 (indirectly), 6, 7 (indirectly)

**Why it conflicts:** Every agent's queries reference `profiles` columns. Adding or removing columns affects all downstream TypeScript types, RLS policies, and query patterns.

**Rule:** Agent 1 owns all `ALTER TABLE public.profiles ADD COLUMN` decisions. Other agents must request new columns through Agent 1.

**Existing columns (do not redefine):**
```
id (PK, FK → auth.users), usn (unique), name, year, branch, section, bio,
avatar_url, skills, interests, role, faculty_status, designation, employee_id,
expertise, created_at, thumbhash, updated_at, email
```

---

### C2: `handle_new_user()` Function
**Affected Agents:** 2 (owns fix), 6 (faculty signup flow)

**Why it conflicts:** The function is called by the `on_auth_user_created` trigger on every auth signup. Changing its insert columns affects all new user profiles.

**Current correct implementation** (in `schema.sql` and all migrations):
```sql
insert into public.profiles (
  id, email, name, usn, year, branch, section, bio,
  skills, interests, role, faculty_status
) values (
  new.id, new.email,
  coalesce(nullif(meta->>'name', ''), split_part(new.email, '@', 1), 'Member'),
  nullif(upper(meta->>'usn'), ''),
  yr, coalesce(nullif(meta->>'department', ''), 'CSE'),
  nullif(meta->>'section', ''), nullif(meta->>'bio', ''),
  skills_array, interests_array,
  'student',
  case when meta->>'intent' = 'faculty' then 'pending' else 'none' end
) on conflict (id) do update set
  email = excluded.email,
  name = coalesce(nullif(public.profiles.name, ''), excluded.name);
```

**Rule:** Agent 2 owns this function. No other agent may modify it.

---

### C3: `protect_profile_privileges()` Trigger
**Affected Agents:** 2, 6

**Why it conflicts:** This trigger blocks non-admin users from changing `role`, `faculty_status`, `employee_id`, `designation`, and `usn`. Extending it to protect additional fields requires coordinated changes.

**Current protected fields:** `role`, `faculty_status`, `employee_id`, `designation`, `usn`

**Rule:** Agent 1 approves any additions to the protected fields list.

---

### C4: `lib/types.ts` — Profile Interface
**Affected Agents:** All (2–7)

**Why it conflicts:** Every agent's TypeScript code references the `Profile` interface. Adding a new DB column requires a matching TypeScript type change across all agents.

**Rule:** When a new profile column is added, Agent 1 coordinates with all agents to update:
1. `lib/types.ts` — `Profile` interface
2. `lib/profile.ts` — `normalizeProfile()`, `profileWritableFields()`, `fallbackProfileFromAuth()`
3. Any hardcoded column lists in `.tsx` files (e.g., `PEOPLE_COLUMNS` in `app/people/page.tsx`)

---

### C5: `lib/profile.ts` — Normalization & Writable Fields
**Affected Agents:** 2, 6

**Why it conflicts:** `normalizeProfile()` maps DB rows to TypeScript objects. `profileWritableFields()` strips unsafe fields from update payloads. Both must stay in sync with the database schema.

**Rule:** Any agent adding a profile column must update both functions. Coordinate with Agent 1 before editing.

---

### C6: RLS Policies on Shared Tables
**Affected Agents:** All

**Why it conflicts:** RLS policies control data access. A new policy from one agent can accidentally block another agent's queries.

**Rule:** All new RLS policies must be reviewed by Agent 1. Follow the existing pattern:
```sql
drop policy if exists "<name>" on public.<table>;
create policy "<name>" on public.<table> for <cmd> using (...) with check (...);
```

---

### C7: `app/api/admin/faculty/route.ts` and `[id]/route.ts`
**Affected Agents:** 6, 7

**Why it conflicts:** These API routes are the single entry point for admin faculty application management. Changing their request/response shape breaks the admin dashboard.

**Rule:** Agent 7 owns the admin UI. Agent 6 must not change these routes. Any API changes require Agent 1 approval.

---

### C8: `hooks/useConnections.ts`
**Affected Agents:** 3, 4, 5, 6

**Why it conflicts:** This hook is used by multiple pages. Adding new methods or changing existing signatures breaks dependent components.

**Rule:** Agent 1 approves any changes to this hook. New connection-related features must extend (not replace) existing methods.

---

### C9: `lib/supabase/middleware.ts`
**Affected Agents:** 5, 6, 7

**Why it conflicts:** Middleware controls route protection. Adding a new protected prefix blocks unauthenticated users; changing existing prefixes can break access.

**Current protected prefixes:**
```ts
const PROTECTED_PREFIXES = ['/connections', '/messages', '/faculty/dashboard', '/admin']
```

**Rule:** Agent 1 approves any middleware changes.

---

## High-Priority Conflict Zones (Single-Agent Ownership with Notification Requirement)

| Zone | Owner Agent | Must Notify Agent 1 When |
|---|---|---|
| `faculty_applications` table structure | 6, 7 | Adding columns |
| `connection_requests` table structure | 3, 4, 5, 6 | Adding columns |
| `conversations` / `messages` tables | 5 | Adding columns or RPC changes |
| `announcements` table | 6, 7 | Adding columns |
| `events` / `event_rsvps` tables | 4 | Adding columns |
| `posts` / `comments` tables | 3 | Adding columns |
| `direct_conversation_pairs` table | 5 | Any changes |

---

## Files That Must NOT Be Edited by Agents 3–7 (Agent 1 Exclusive)

| File | Reason |
|---|---|
| `supabase/migrations/20261013_network_and_faculty.sql` | Base migration — must not be altered |
| `supabase/migrations/20261013_network_fixes.sql` | Fix migration — must not be altered |
| `supabase/migrations/20261013_usn_unique_and_columns.sql` | USN migration — must not be altered |
| `supabase/schema.sql` | Canonical reference — only consolidated by Agent 1 |
| `supabase/verify_schema.sql` | Verification script — Agent 1 updates when schema changes |
| `lib/supabase/middleware.ts` | Route protection — Agent 1 approves all changes |
| `hooks/useConnections.ts` | Connection hook — Agent 1 approves all changes |
| `app/api/admin/faculty/route.ts` | Admin API — Agent 1 approves all changes |
| `app/api/admin/faculty/[id]/route.ts` | Admin API — Agent 1 approves all changes |

---

## Safe Zones (Agents Can Edit Freely Within Their Scope)

| Agent | Safe to Edit |
|---|---|
| 2 | New migration for `handle_new_user` fix; `contexts/AuthContext.tsx` profile fallback logic |
| 3 | New migration for comments/feed; `app/page.tsx`; `components/PostCard.tsx`; `components/EventCard.tsx` |
| 4 | New migration for events/R SVPs; `components/EventCard.tsx`; event-related pages |
| 5 | New migration for messaging; `app/messages/` pages; `hooks/useMessages.ts` |
| 6 | New migration for faculty directory; `app/faculty/` pages; `components/SidebarRight.tsx` |
| 7 | `app/admin/page.tsx`; admin-related API extensions (approved by Agent 1) |

---

## Migration File Conflicts

**These files must be created fresh by each agent — never edited in place:**

```
20261014_<agent-slug>.sql    ← Each agent creates their own migration
```

**Never overwrite or re-order existing migrations.** Each migration must be a standalone, additive, idempotent SQL file.

---

## Coordination Checklist for Each Agent

Before starting work, each agent must:

- [ ] Read `docs/database-audit.md`
- [ ] Read this conflict report
- [ ] Confirm which conflict zones apply to their scope
- [ ] Submit a brief scope statement to Agent 1 listing:
  - Tables they will touch
  - New columns they plan to add (if any)
  - TypeScript types they will update (if any)
  - API routes they will create or modify (if any)
- [ ] Wait for Agent 1 confirmation before writing any SQL
