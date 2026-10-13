# Implementation Plan — UBDT CSE Community Upgrade

> **Source of truth:** The FEAT artifacts under `.agents/tasks/task-ubdt-cse-upgrade/` are the canonical detailed plan.
> This document is a human-readable summary. The FEAT coder steps read the JSON files directly.

## Project Snapshot

- **Stack:** Next.js 16.4.0 · React 19 · TypeScript · Supabase (Auth + PostgREST + Realtime) · Tailwind CSS 4
- **Build command:** `npm run build` (must exit 0 — no test framework)
- **Database:** Schema already applied. Single canonical table: `public.profiles`. No new migrations.
- **Supabase clients:** `createClient()` from `@/lib/supabase/client` for client components; `createClient()` from `@/lib/supabase/server` (async, must `await`) for server components and route handlers.

---

## Key Constraints

- **Single profile table:** `public.profiles` — columns: `id, email, usn, name, year, branch, section, bio, avatar_url, thumbhash, skills[], interests[], role, faculty_status, designation, employee_id, expertise[], created_at, updated_at`
- **Role protection:** The `trg_protect_profile_privileges` DB trigger prevents clients from writing `role` or `faculty_status` via UPDATE. `profileWritableFields()` in `lib/profile.ts` enforces this on the app side.
- **Faculty security:** A user gets `role='faculty'` only when an admin approves their `faculty_applications` row via the `on_faculty_application_status` trigger. Never self-assignable.
- **RPC for DMs:** `get_or_create_direct_conversation(other_user: uuid)` — only works if both users are connected (`are_connected(a, b)` returns true).
- **Auth helpers:** `is_admin(uid)`, `is_verified_faculty(uid)`, `are_connected(a, b)` — defined as SECURITY DEFINER functions.
- **No service-role keys in client code.**
- **CSS:** All utility classes defined in `app/globals.css`. Use inline styles for pixel-specific values; Tailwind for layout. `border-radius: 0` everywhere.
- **AGENTS.md block:** Must not be removed from AGENTS.md.

---

## Phase 1 — Bug Fixes (FEAT-001)

- [ ] 1. **PostCard.tsx author click** → change `handleAuthorClick` to `router.push('/people/' + post.author_id)` instead of opening modal with a stub Profile.
      Files: `components/PostCard.tsx`
      Verify: `npm run build` — 0 errors.

- [ ] 2. **EventCard.tsx host click** → change `handleHostClick` to `router.push('/people/' + event.host_id)`.
      Files: `components/EventCard.tsx`
      Verify: `npm run build` — 0 errors.

- [ ] 3. **Navbar active route + mobile menu** → add `usePathname()` for active highlight; add hamburger `showMobileMenu` state for `lg:hidden` mobile menu dropdown.
      Files: `components/Navbar.tsx`
      Verify: `npm run build` — 0 errors.

- [ ] 4. **AuthModal TypeScript warnings** → fix unused `data` variables in sign-up and sign-in branches to suppress build warnings.
      Files: `components/AuthModal.tsx`
      Verify: `npm run build` — 0 errors.

- [ ] 5. **ProfileModal thumbhash sync** → change `updateProfile({ avatar_url: publicUrl })` to `updateProfile({ avatar_url: publicUrl, thumbhash: thumbHash })` in the avatar upload success path.
      Files: `components/ProfileModal.tsx`
      Verify: `npm run build` — 0 errors.

---

## Phase 2 — Auth Pages (FEAT-002)

- [ ] 6. Create `app/signin/page.tsx` — email + password sign-in, error handling, redirect to `next` param.
      Supabase calls: `supabase.auth.signInWithPassword({ email, password })`

- [ ] 7. Create `app/signup/page.tsx` — student registration with USN validation; DB trigger creates profile.
      Supabase calls: `supabase.auth.signUp({ email, password, options: { data: { name, usn, year, department, section, skills, intent: 'student' } } })`

- [ ] 8. Create `app/signup/faculty/page.tsx` — faculty application: creates auth user + inserts `faculty_applications` row.
      Supabase calls: `supabase.auth.signUp(...)` + `supabase.from('faculty_applications').insert(...)`

- [ ] 9. Create `app/forgot-password/page.tsx` — single email field, calls `supabase.auth.resetPasswordForEmail`.

- [ ] 10. Create `app/reset-password/page.tsx` — new password form, calls `supabase.auth.updateUser({ password })`.
       Files: `app/signin/page.tsx`, `app/signup/page.tsx`, `app/signup/faculty/page.tsx`, `app/forgot-password/page.tsx`, `app/reset-password/page.tsx`
       Verify: `npm run build` — 0 errors.

---

## Phase 3 — People Directory & Connections (FEAT-003)

- [ ] 11. Create `app/people/page.tsx` — searchable/filterable grid using ProfileCard; year + role filters; client-side filter from profiles query.

- [ ] 12. Create `app/people/[id]/page.tsx` — full profile view: avatar, USN, year, bio, skills, connection count, ConnectButton, Message button (connected only), recent posts list.

- [ ] 13. Create `app/connections/page.tsx` — tabs: Connections (accepted), Pending (incoming + outgoing), Find People link; uses `useConnections()` hook.

- [ ] 14. Update `components/SidebarLeft.tsx` — add CONNECTIONS and MESSAGES link buttons below EDIT PROFILE.
       Files: `app/people/page.tsx`, `app/people/[id]/page.tsx`, `app/connections/page.tsx`, `components/SidebarLeft.tsx`
       Verify: `npm run build` — 0 errors.

---

## Phase 4 — Messaging (FEAT-004)

- [ ] 15. Create `app/messages/page.tsx` — two-panel layout (inbox list + conversation view); conversation selected via `?conv=UUID` search param; uses `useInbox()` and `useConversation()` from `hooks/useMessages.ts`; Realtime updates already handled by hooks.

- [ ] 16. Create `app/messages/[id]/route.ts` — GET handler: `NextResponse.redirect(new URL(`/messages?conv=${params.id}`, request.url))` so notification links (`/messages/UUID`) redirect correctly.
       Files: `app/messages/page.tsx`, `app/messages/[id]/route.ts`
       Verify: `npm run build` — 0 errors.

---

## Phase 5 — Faculty Portal (FEAT-005)

- [ ] 17. Create `app/faculty/page.tsx` — faculty directory, filters for role=faculty/admin, search by name/designation.

- [ ] 18. Create `app/faculty/[id]/page.tsx` — faculty profile with recent announcements and upcoming events.

- [ ] 19. Create `app/faculty/dashboard/page.tsx` — protected; announcements CRUD + events summary; uses `useAuth()`.

- [ ] 20. Create `app/admin/page.tsx` — protected; faculty applications table with approve/reject; calls `/api/admin/faculty/[id]`.

- [ ] 21. Update `components/SidebarRight.tsx` — add RECENT ANNOUNCEMENTS section using `announcements` from `useCommunity()`.

- [ ] 22. Update `app/page.tsx` — add ANNOUNCEMENTS filter tab to filterTabs array; render announcements list when `feedFilter === 'announcements'`.
       Files: `app/faculty/page.tsx`, `app/faculty/[id]/page.tsx`, `app/faculty/dashboard/page.tsx`, `app/admin/page.tsx`, `components/SidebarRight.tsx`, `app/page.tsx`
       Verify: `npm run build` — 0 errors.

---

## Admin Provisioning (manual step, no code)

To create the first admin user, run this SQL in the Supabase dashboard SQL editor:
```sql
UPDATE public.profiles SET role = 'admin' WHERE email = 'your-admin-email@domain.com';
```
This bypasses the `trg_protect_profile_privileges` trigger because it runs as a superuser. Document this in `/app/admin/page.tsx` as an inline instruction.

---

## Schema Cache

If PostgREST returns 404 for new relationships (e.g., after schema changes), run:
```sql
NOTIFY pgrst, 'reload schema';
```
in the Supabase SQL editor. No code change needed.
