# UCC 2.0 — Phase 1 Static Security Review

**Scope:** `supabase/migrations/2026102201..2026102204_*.sql` and the consolidated
`supabase/schema.sql`, reviewed statically against the privilege model
(`role` / `faculty_status` authorisation + `member_type` identity) and
Supabase runtime assumptions (PostgREST as `anon`/`authenticated`, JWT-scoped
`auth.uid()`).
**Result: PASS — no forward fixes required.** Findings below are observations
or accepted residual risks, each with rationale and cost-if-wrong.

---

## 1. What was verified clean

**Function hardening.** Every Phase 1 function — `protect_profile_privileges`,
`handle_new_user` (m1 body superseded by m4), `emit_notification`,
`on_faculty_application_status`, `is_admin` — is `security definer` with
`set search_path = public` and qualifies every object with `public.`. No
search-path-hijack surface. This was verified in the m4-file body because the
functions in schema.sql and migrations match textually (checked).

**Privilege bootstrap.** `handle_new_user` hard-codes `role = 'student'`; only
`intent = 'faculty'` metadata leads to `faculty_status = 'pending'` (unverified)
— metadata can never mint a faculty or admin role. The profiles INSERT policy
additionally constrains client INSERTs to `role = 'student' and
faculty_status in ('none','pending')` with `auth.uid() = id`.

**Privilege protection.** `trg_protect_profile_privileges` reverts `role`,
`faculty_status`, `employee_id`, `designation`, `usn`, `member_type`,
`graduation_year` for a non-admin caller (`is_admin(auth.uid())` is false for a
no-claims session — including the SQL Editor). Behaviourally re-verified by
smoke test 3. Admin approval flows (which carry a real JWT) pass through.

**RLS posture on the two new tables.** Both `profile_contacts` and
`content_visits` have RLS enabled and owner policies with `with check
(auth.uid() = <owner>)` covering INSERT/UPDATE/DELETE. `profile_contacts` adds
visibility-gated SELECT policies (`public` / `members`+non-null-uid / admin via
`is_admin`), and `is_admin` reads `profiles`, not `profile_contacts`, so the
policies cannot recurse. Smoke test 6 verified the deny direction (anon sees
only `public` rows; writes to others' rows denied).

**Notifications.** No INSERT/DELETE policy exists on `notifications`; only the
definer `emit_notification` can create rows. Its EXECUTE is revoked from
`public`, `anon`, `authenticated` (m2 §2 / schema.sql §15) — this closes the
pre-existing vector where any signed-in user could mint notifications for
others. The `on conflict (user_id, dedupe_key) where dedupe_key is not null`
target correctly matches the partial unique index.

**Data validation.** All CHECKs in the four migrations enforce URL hosts
(github/linkedin anchored at the start of a https? URL — `github.com.evil.com`
and `evil.com/github.com` both fail), phone/email formats, `graduation_year`
1950–2200, `member_type`/`content_type` enumerations, `dedupe_key` length 1–200,
notification content pairing, and visit time ordering. All behaviourally
re-verified by smoke tests 1–5.

**USN invariant.** m3 pre-flights collision counts without emitting any USN,
builds the global index before dropping the legacy student-only index (no
unprotected window), and reverts atomically on failure. m4's guard aborts the
signup (SQLSTATE 23505) without echoing the USN into logs; its blanket
`unique_violation` → "USN is already registered" mapping is accurate because
the profiles primary key is pre-handled by `on conflict (id)` and the only
remaining unique keys on the INSERT are USN keys (post-m3).

**m1 backfill trigger window.** The `trg_protect_profile_privileges` disable/
re-enable around the member_type backfill happens inside the migration
transaction; any failure (or CLI rollback) restores the trigger enabled.

**Grants for policy execution.** `is_admin`/`is_verified_faculty`/
`are_connected`/`is_conversation_participant` keep explicit EXECUTE grants to
`anon, authenticated` — required because RLS policy expressions run with the
querying user's privileges.

---

## 2. Findings (no code change; each re-checked against app code)

1. **Signup copies `designation`/`employee_id` from unverified metadata for
   `intent = 'faculty'`** — publicly readable before any review. Accepted:
   `lib/profile.ts fallbackProfileFromAuth` deliberately mirrors the trigger
   (pinned by tests), the mobile twin mirrors the web lib, and approval
   re-populates both fields from the reviewed application
   (`on_faculty_application_status`). Changing one side now would create a
   web/mobile divergence, which Phase 1 forbids. Cost if wrong: a spoofed
   designation is visible until Phase 2 harmonises the web/mobile flow.
   Candidate fix belongs in Phase 2 alongside the UI work.

2. **`public.profiles.email` remains publicly selectable** — known residual
   risk carried in the runbook (§9). It predates Phase 1 (public SELECT policy
   on profiles) and app reads depend on it. Phase 2 decision: remove email
   from the public profile surface, then the contact-visibility design already
   covers the sensitive alternatives.

3. **`AuthContext` direct profile INSERT edge** — when the signup trigger
   didn't fire, the app inserts a profile without `member_type`; the DB
   default ('student') covers it, so alumni intent via that path lands as
   student until the app flow is updated (Phase 2; mobile twin untouched).

4. **Faculty approval/rejection executed from a no-claims session (SQL
   Editor) silently reverts** the role/faculty_status changes via the
   protection trigger. This is the intended invariant ("the SQL editor cannot
   modify privileges"), not a bug: approvals must run through an admin JWT
   flow, as they do in the admin dashboard.

5. **`content_id` on notifications/`content_visits` is polymorphic without a
   FK** — deliberate (posts/events are separate storage models); dangling
   visit rows possible after content deletion; a later phase may add cleanup.

6. **`content_visits` lets the owner backdate `first_visited_at`** — personal
   analytics only; no privilege or shared surface affected.

---

## 3. Verification basis and limits

This is a static review plus the behavioural evidence already banked on a
disposable PostgreSQL 16 (verifier exit 0; smoke tests PASS 1–7; negative
controls). It does **not** validate the hosted Supabase runtime (real GoTrue
signup pipe, live-JWT `auth.uid()`/`is_admin` behaviour, PostgREST cache
reactions) — the runbook §8 lists exactly what to confirm at the first
production apply.
