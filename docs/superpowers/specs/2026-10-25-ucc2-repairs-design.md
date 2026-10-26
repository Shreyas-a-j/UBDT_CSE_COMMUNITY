# UCC 2.0 Repairs and Missing Flows — Design

**Date:** 2026-10-25
**Status:** proposed; implementation requires approval
**Scope:** web (Next.js) and Android (Expo) parity repairs for pins, deletion,
admin handover, academic year, admission numbers, and notification popups

---

## 1. Intent

Close the eight gaps found in the audit without changing the working
architecture, production data, or existing authorization boundaries. Every
repair should be small enough to review independently, and every privileged
action must remain server-authoritative.

The website and the Android app should expose the same capabilities. Where the
platforms legitimately differ (cookie session vs. Expo session), they should use
the same database rules and the same pure helpers.

## 2. Goals

- Repair web pin rendering and add a live, server-derived expiry countdown on
  both platforms.
- Add announcement and event deletion where the UI is missing, with
  confirmation, duplicate-submit guards, feedback, and list refresh.
- Add a clear administrator nomination/transfer UI on both platforms, using the
  existing succession RPCs and audit log.
- Make academic year editable for students on both platforms, while keeping
  alumni and faculty identity read-only.
- Let first-year students register with an admission number instead of a USN,
  store it privately, and link a USN later through a controlled RPC.
- Show a dismissible notification popup on app launch/foreground on both
  platforms, preserving the existing bell and Alerts tab.
- Prove the work with focused unit tests, typecheck, lint, existing test suites,
  and an Android debug build.

## 3. Non-goals

- No identifier-based login. Sign-in remains email + password. An admission
  number is profile data, not a credential.
- No student → alumni self-transition. `member_type` and `graduation_year`
  remain trigger-protected.
- No new dependencies, auth providers, service-role browser clients, or Edge
  Functions.
- No production SQL application. The migration is prepared and reviewed only.
- No email, web push, or iOS push. OneSignal behavior is unchanged.
- No automatic deletion of expired events. IST and the 60-minute event rules
  are unchanged.
- No redesign of the notification bell, Alerts tab, directory, or feed.

## 4. Decisions already made

| Decision | Choice |
|---|---|
| Admission-number login | Profile field only; login stays email/USN |
| Academic year and Alumni | Editable 1–4 for students; alumni read-only |
| Migration handling | Prepare SQL; do not apply to production |
| Announcement image cleanup | Authenticated server route deletes the R2 object |
| Academic-year enforcement | UI-only; no database restriction for non-students |
| Admission-number format | 4–24 uppercase `A–Z`, `0–9`, `-`, or `/` |

Additional calls made in this design (flagged for review):

- Admission-number format is confirmed as 4–24 uppercase alphanumerics with
  optional `-` or `/`. The exact college format can be tightened later without
  changing the flow.
- Administrator handover uses the existing nominee-acceptance model. “Transfer”
  means: current admin nominates → nominee accepts → the database transfers the
  role atomically. The UI does not bypass acceptance.
- Announcement deletion is shown to the author and to administrators, matching
  the existing DELETE RLS policy. Event deletion is shown to the host only,
  matching the brief; the existing admin policy remains in the database.
- Dismissing a notification popup hides it for the current session but does not
  mark it read. Opening it marks it read, exactly like the bell/Alerts list.

## 5. Current state and root causes

- `contexts/CommunityContext.tsx` selects `discussion_pins.discussion_id`, but
  the canonical column is `post_id`. Web pins therefore never map to posts.
  Mobile already uses `post_id`.
- `pin_discussion` / `unpin_discussion` already enforce faculty/admin
  authorization, a three-pin cap, seven-day expiry, and an advisory lock.
- Announcement DELETE RLS (author or admin, reactions cascade) and event DELETE
  RLS (host or admin) already exist. The web announcements page and web event
  card have no delete affordance. Mobile has event deletion; its announcement
  channel has no delete affordance.
- The succession migration already provides nomination, acceptance, decline,
  cancellation, resignation, audit, and a single-admin index. Neither client has
  a handover UI.
- `profiles.year` is already writable through the profile allowlist, but neither
  edit screen exposes it.
- No admission-number column or table exists. Student signup requires a USN.
- The bell and Alerts tab exist and subscribe to `notifications`. No popup
  exists on either platform.

## 6. Feature design

### 6.1 Discussion pins

**Data flow**

- Fix the web query to select `post_id` and update `mapDiscussionPin` to read
  `post_id` and expose it as `discussion_id` (the rest of the pin helpers and
  the `DiscussionPin` type stay unchanged). This second change is required:
  the mapper currently rejects rows without `discussion_id`, so fixing only the
  select would still drop every pin.
- Add a focused `refreshPins()` method to `CommunityContext` rather than
  reusing `fetchData()`; one expiry should not refetch the entire feed.
- Keep the RPC parameter name `p_discussion_id`; only the table column changes.
- The server remains the only authority for pin creation, the three-pin cap,
  and the seven-day expiry. The client never writes `pin_expires_at`.

**Countdown**

- Add a pure helper on each platform:
  - `formatPinCountdown(expiresAt: string, now: Date): string`
  - Returns `Expires in 6d 23h`, `Expires in 59m 12s`, `Expires in 42s`, or
    `Expired`.
  - `isPinActive(expiresAt, now)` returns `false` at or after expiry.
- Web `PostCard` renders the helper in the existing pin banner and updates once
  per second while the pin is active. When it expires, the banner hides and the
  card asks the context to refresh pins once (deduplicated by a ref).
- Mobile `PostCard` receives `pinExpiresAt` and renders the same countdown text.
  It updates once per second using the same helper.
- The query already filters expired pins server-side; the countdown is display
  only. If the clock drifts, the next server fetch wins.

**Cap and unpin affordance**

- The existing pin button remains visible only to `canManageDiscussionPins`.
- When three pins are active and the current post is not pinned, the button is
  disabled with the label “Maximum 3 active pins”. The RPC error remains the
  final authority.
- An active pin always offers Unpin to an authorized user; the button calls the
  existing `unpinDiscussion`.

### 6.2 Announcement deletion

**Web**

- Add `deleteAnnouncement(id)` to `CommunityContext`. It calls a new
  authenticated route, removes the row from local state on success, and returns
  a structured result.
- Add a delete control to `AnnouncementCard` when
  `currentUser.id === announcement.author_id || isAdmin(currentUser)`.
- Confirmation uses the existing `window.confirm` pattern. A `useRef` set guards
  against a second click while the request is in flight. Success shows a toast;
  failure shows the server message.
- The announcements page re-renders from context state, so the deleted row
  disappears immediately. A background refetch is not required.

**Mobile**

- Add the same control to the announcements channel list for the author or an
  administrator.
- Confirmation uses `Alert.alert`. A ref-based guard prevents duplicates.
- The screen removes the row from local state on success and shows an inline
  status banner on failure.
- The existing faculty dashboard delete is changed to use the same server route
  so images are cleaned up there too.

**Authenticated delete route**

- Add `DELETE /api/announcements/[id]`.
- The route:
  1. Reads the cookie session and rejects unauthenticated callers.
  2. Selects `id, author_id, image_urls` for the announcement.
  3. Re-reads the caller's `role` and authorizes author or admin.
  4. Deletes the row through the user-scoped client, so RLS is a second layer.
  5. Parses `image_urls` and deletes only keys that:
     - use the configured public R2 domain,
     - live under `announcements/`, and
     - contain no path traversal.
  6. Returns `{ deleted: true, imagesDeleted, imagesFailed, imagesSkipped }`.
     URLs that do not match the configured R2 domain or the `announcements/`
     prefix are counted as skipped, not failed; only a matching key whose
     DeleteObject call fails counts as failed.
- If the row is already gone, return a 404 with a message the UI can treat as
  “already deleted”.
- Confirmed against the migrations: announcement DELETE RLS allows the author
  or an admin, `announcement_reactions` cascades, and event RSVPs cascade.
- If R2 configuration is missing, the row is still deleted and the response
  reports the image cleanup as failed. Blocking deletion on storage
  configuration would leave users unable to remove content.
- R2 helpers are extracted into a small shared module used by the upload and
  delete routes. No other upload behavior changes.

**Dependencies**

- `announcement_reactions` already cascades.
- Notifications are historical rows and are not deleted with the announcement.
- No other table references announcements.

### 6.3 Event deletion

**Web**

- Add a delete button next to the host’s edit control in `EventCard`.
- Visible only to the host (`currentUser.id === event.host_id`).
- `window.confirm`, a `deleting` state guard, `deleteEvent`, toast feedback, and
  local state removal. `deleteEvent` already distinguishes “already gone” from
  “denied by RLS”.
- No change to event expiry, IST handling, or the 60-minute rule.

**Mobile**

- Event deletion already exists in the event card and event detail screen.
  Verify the confirmation and duplicate guard; align copy and error handling
  with web if needed.

### 6.4 Administrator handover

**Web admin page**

- Add an “Administrator handover” card to `/admin`.
- The card loads:
  - the current pending nomination (admin can see all rows),
  - the ten most recent audit entries,
  - eligible nominees: `role = 'faculty'`,
    `faculty_status in ('approved','verified')`,
    `member_type = 'faculty'`, excluding the current admin.
- With no pending nomination: a select, an optional note (max 500 characters),
  and a “Nominate successor” button. Confirmation explains that the nominee
  must accept before the role transfers.
- With a pending nomination: show the nominee, creation time, and status, plus
  “Cancel nomination”.
- Errors from the RPC are shown verbatim (self-nominee, ineligible nominee,
  already pending, no current admin).
- The audit list shows action, actor, target, outcome, and time. It is
  read-only.
- Copy states that operator recovery is required if no administrator remains;
  the browser never offers recovery.

**Nominee acceptance**

- Add `AdminNominationBanner` to `AppShell`. It queries for a pending nomination
  where `nominee_id = currentUser.id`.
- The banner shows who nominated the member and offers Accept / Decline.
- Accept and Decline both confirm first, call the existing RPC, refresh the
  auth profile, and remove the banner.
- After acceptance the member becomes admin; after decline the current admin is
  unchanged.
- The banner is also the recovery-visible path for a nominee who is not an
  admin, so it must not live only on `/admin`.

**Mobile**

- Add the same handover card to `apps/mobile/src/app/admin/index.tsx`.
- Add the nominee banner at the signed-in root layout so it is visible on any
  screen.
- Use the same RPCs and the same confirmations. No direct table writes.
- The admin screen’s existing website API calls stay unchanged; succession uses
  the Supabase RPC because the RPC is already the server boundary.

**Authorization and races**

- No client-side check is trusted. The RPCs lock the current admin row, verify
  eligibility, reject self-nomination, and enforce one pending nomination.
- The partial unique index remains the final single-admin guard.
- The UI only hides impossible choices; it does not replace the RPC checks.
- Resignation is intentionally not exposed in this scope. The RPC remains
  available for a future explicit control; adding it now would expand the
  confirmation/copy surface beyond the requested handover flow.

### 6.5 Academic year

**Web profile edit**

- Add a `year` state initialized from `profile.year`.
- For `member_type === 'student'`, show a select with 1st–4th year.
- For alumni, show the existing `Class of <graduation_year>` read-only chip.
- For faculty/admin, do not show a student year control.
- Include `year` in the existing `updateProfile` call. The allowlist already
  permits it; validation restricts it to 1–4.

**Mobile profile edit**

- Add the same select or four-option chip group for students.
- Include `year` in `updateProfile`.
- Keep the existing identity text (USN, branch) and the note that avatar changes
  happen on the website.

**Enforcement decision: UI only**

- `profiles.year` is currently in the writable allowlist and is not protected
  by `protect_profile_privileges()`. Any authenticated member can therefore
  PATCH their own `year`, including faculty and alumni, and there is no
  database 1–4 check.
- This work hides the control for non-students and validates 1–4 in the edit
  screen. It does **not** add a database restriction. That limitation is
  accepted and must be stated in the implementation report.
- No migration change is made for `year`; existing rows are untouched.

**Display and filters**

- `getYearLabel` and the directory filters already use the canonical 1–4
  labels. No schema or label change.
- Changing year affects event targeting and directory filters as intended.

**Alumni**

- No transition is added. Alumni keep `graduation_year` and never receive a
  student year control.

### 6.6 First-year admission number

**Decision**

- The admission number is stored and displayed, but it is not a login
  identifier. Sign-in remains email + password; USN-based flows are unchanged.

**Storage**

- Add `public.student_admission_numbers`:
  - `profile_id uuid primary key references public.profiles(id) on delete cascade`
  - `admission_number text not null`
  - `created_at timestamptz not null default timezone('utc', now())`
- Unique index on `upper(btrim(admission_number))`.
- Check constraint: normalized value matches
  `^[A-Z0-9][A-Z0-9/-]{2,22}[A-Z0-9]$` (4–24 characters; the first and last
  character are alphanumeric).
- RLS: owner and admin may select; no client INSERT/UPDATE/DELETE. The signup
  trigger writes the row as the table owner.
- This table is deliberately separate from `profiles`. The public profile
  queries use `select('*')`, so a column on `profiles` would leak admission
  numbers to every directory visitor.

**Predicates and baseline**

- Signup rules key on `intent = 'student'`, not `role`, so faculty intent is
  not subjected to student USN rules. `link_student_usn` requires
  `member_type = 'student'`, so alumni (`role = 'student'`,
  `member_type = 'alumni'`) are excluded. Pending faculty applicants have
  `member_type = 'student'`; linking a USN is harmless for them, but they are
  not subject to the student signup rule because their intent is faculty.
- The replacement `handle_new_user()` is based on the latest canonical body
  (`2026102212`), preserving the faculty designation requirement and the
  pending `faculty_applications` insert.
- A student intent with a null year preserves the legacy behavior: no
  identifier is required. Existing fixtures and older clients create student
  rows without a year. Years 1–4 are still validated, and an admission number
  is always rejected unless the year is 1.
- Duplicate admission numbers raise a distinct 23505 message (“This admission
  number is already registered…”); duplicate USNs keep the existing message.
  Both roll back the auth user.
- `link_student_usn` validates the same canonical USN pattern as
  `lib/utils.validateUSN` (`^4UB\d{2}CS\d{1,3}$`, case-insensitive after
  normalization) and does not re-derive `year`.

**Signup rules**

- Student, year 1: a valid USN or a valid admission number is required.
- Student, years 2–4: a valid USN is required. The admission-number field is
  hidden, and an admission number supplied through a direct Auth API call is
  rejected even when a valid USN is present.
- Alumni and faculty: unchanged. No admission-number field.
- The client validates format, but the database trigger is authoritative.
- The client does not probe the admission-number table for duplicates; there is
  no public lookup. A duplicate aborts signup with a generic message that tells
  the user to sign in or contact the department.
- The signup metadata includes `admission_number` only when one was entered.
  Nothing logs the admission number, USN, or password.

**Database trigger**

- Replace `handle_new_user()` with a version that:
  1. Normalizes `usn` and `admission_number` with `upper(btrim(...))`.
  2. Rejects an invalid admission-number format with a generic 23514 error.
  3. Enforces the year-1 “USN or admission number” rule and the years 2–4
     “USN required” rule for student intent.
  4. Inserts the profile as today.
  5. Inserts the admission-number row only for first-year student intent.
  6. Converts an admission-number unique violation into a generic 23505 error
     and rolls back the auth user.
- The existing duplicate-USN guard remains.
- Existing profiles are not backfilled and are not modified.

**Linking a USN later**

- Add `link_student_usn(p_usn text)`:
  - Requires an authenticated student whose `usn` is currently null.
  - Normalizes and validates the USN.
  - Updates only `profiles.usn`.
  - Relies on the existing normalized unique index for duplicates and returns a
    generic duplicate message.
  - Is executable by `authenticated`; all other roles are revoked.
- The privilege-protection trigger gets one narrow exception, keyed by the
  transaction-local GUC `ucc.usn_link`:
  - Only a null → non-null USN is allowed.
  - Only for `member_type = 'student'`.
  - Every other protected field is restored from the old row.
  - The GUC is set only inside `link_student_usn`.
- Direct client updates to `profiles.usn` remain reverted by the trigger.

**UI**

- Web and mobile student signup:
  - USN remains the primary field.
  - A year-1 student with no USN sees an admission-number field and a short
    explanation. The year select is locked to 1st year while the USN is empty,
    so “no USN but year 3” cannot be submitted.
  - The submit button validates locally and surfaces the duplicate message from
    the server.
- Profile edit, for a student with `usn == null`:
  - Show an “Add your USN” field and button.
  - On success, refresh the profile and show the USN read-only.
  - Do not expose the admission number to other members.
- The owner’s edit screen may show “Admission number on file” read-only by
  selecting their own row from `student_admission_numbers`.

**Deployment order**

- The migration must be applied before the updated app is deployed. Until then,
  first-year signup without a USN will fail at the trigger. No production SQL is
  applied as part of this work.

### 6.7 Notification popup

**Shared behavior**

- Only unread, visible notification types are eligible. Use each platform’s
  existing list filter: mobile `HIDDEN_NOTIFICATION_FILTER` (message,
  connection_request, connection_accepted); web `filterVisibleNotifications`
  must be widened to the same three types so a popup cannot dead-end.
- A popup appears at launch and when the app/tab returns to the foreground.
  Realtime inserts update the bell/badge but do not open a popup while the user
  is already active.
- At most one popup is shown at a time.
- Seen notification IDs are kept in memory for the session. Dismissing does not
  mark the notification read; opening it does.
- Signing out clears the seen set and closes any open popup.
- The popup reads only existing `notifications` rows. The 24-hour retention job
  remains the only deletion mechanism.
- No OneSignal, email, web-push, or iOS behavior changes.

**Web**

- Add `NotificationPopup` to `AppShell`, so it appears only on signed-in app
  pages and never on auth pages.
- Use the `notifications` and `markNotificationAsRead` values already exposed by
  `CommunityContext`.
- On mount and on `visibilitychange` → visible, mark a “check requested” flag.
  When notifications are available and the flag is set, choose the newest
  eligible unread notification not in the seen set.
- Render a fixed, dismissible card with title, body, “View”, and “Dismiss”.
  It must not block the page.
- “View” marks the notification read, closes the card, and navigates to a safe
  internal `link`. The predicate is: starts with `/`, does not start with `//`
  or `/\`, and contains no backslash. Otherwise fall back to `/`. The same
  predicate is used on mobile before `router.push`.
- A full page reload is a cold launch on web, so the in-memory seen set is
  cleared and an unread notification may appear once after a reload. This is
  intentional.
- The bell dropdown remains unchanged.

**Mobile**

- Add `NotificationPopup` at the signed-in root, above the navigator, so it
  works on tabs and detail screens.
- On mount and on `AppState` → active, query the newest unread visible
  notification for the signed-in user. Skip if the app is not active.
- Render a React Native `Modal` with a backdrop, title, body, “View”, and
  “Dismiss”. `onRequestClose` behaves like Dismiss.
- “View” marks the row read, refreshes the unread badge, closes, and navigates
  with `routeForNotification`.
- The Alerts tab and its realtime INSERT/DELETE handling remain unchanged.

**Loop prevention**

- The seen set is keyed by notification id.
- The “check requested” flag is consumed once per launch/foreground.
- No effect depends on the popup’s own render output.
- A notification that is dismissed stays suppressed until the next cold launch;
  a newer notification can still appear on the next foreground.

### 6.8 Cross-platform parity

| Capability | Web | Android |
|---|---|---|
| Pin fetch uses `post_id` | Fix | Already correct |
| Live pin countdown | Add | Add |
| Unpin for faculty/admin | Already present | Already present |
| Three-pin cap feedback | Add | Add |
| Announcement delete | Add | Add |
| Announcement image cleanup | New route | Calls the same route |
| Event delete | Add | Already present |
| Admin handover card | Add | Add |
| Nominee accept/decline banner | Add | Add |
| Academic-year edit | Add | Add |
| Admission-number signup | Add | Add |
| USN linking | Add | Add |
| Notification popup | Add | Add |

## 7. Migration plan (prepared, not applied)

One additive migration: `2026102502_admission_numbers_and_usn_linking.sql`.

It contains:

1. `student_admission_numbers` table, unique index, check constraint, RLS, and
   grants.
2. A replacement `handle_new_user()` with admission-number validation and
   insertion.
3. `link_student_usn(text)` with execute grants.
4. A replacement `protect_profile_privileges()` with the narrow
   `ucc.usn_link` exception.
5. Comments and `notify pgrst, 'reload schema'`.

It does not:

- backfill or rewrite existing profiles,
- change USN uniqueness,
- change member identity,
- grant service-role access to clients,
- or delete data.

The migration is written and reviewed locally. It is not applied to the linked
production project.

## 8. Testing and verification

**Pure unit tests**

- Pin countdown formatting and expiry.
- Admission-number normalization/validation on web and mobile.
- Student signup validation for year 1 with admission number and years 2–4
  without a USN.
- Notification popup candidate selection, seen-set behavior, and safe-link
  filtering.
- Academic-year validation.

**Web component/context tests**

- Pin query maps `post_id` and renders the countdown.
- Announcement delete is visible only to author/admin, confirms once, and
  removes the row.
- Event delete is visible only to the host and handles RLS denial.
- Profile edit shows the year select for students and not for alumni/faculty.
- Notification popup shows once per foreground, marks read on View, and does not
  mark read on Dismiss.
- Admin handover calls the RPCs and displays RPC errors.

**Mobile tests**

- The same pure helpers.
- Existing tests for notifications, profile, and signup remain green.
- Typecheck and lint cover the new screens/components.

**SQL rehearsal**

- If the local rehearsal harness is available, add
  `supabase/test-admission-numbers.sql` covering:
  - year-1 signup with admission number only,
  - duplicate normalized admission number,
  - invalid format,
  - years 2–4 without a USN,
  - years 2–4 with a USN and an admission number (rejected),
  - one-time USN linking,
  - duplicate USN linking,
  - direct client USN update reverted,
  - owner/admin-only admission-number SELECT.
- Do not run anything against production.

**Commands**

- Web: `npm test -- --reporter=dot`, `npm run typecheck`, `npm run lint`.
- Mobile: `npm test -- --reporter=dot`, `npm run typecheck`, `npm run lint`.
- Android: `./gradlew assembleDebug` in `apps/mobile/android` (the native
  project exists). If the build cannot run, report the exact blocker instead of
  claiming success.

## 9. Risks and limits

- **Admission-number format:** the 4–24 character rule is a product decision and
  may still be tighter in practice. It is centralized in one validator and one
  SQL check so it can be adjusted without changing the flow.
- **Signup before migration:** the current trigger ignores
  `admission_number`, so a first-year signup without a USN would silently create
  a profile with no USN and no admission record. The migration must be applied
  before the updated client is deployed. This is a deployment-order
  requirement, not a runtime fallback.
- **Image cleanup is best-effort:** the database row is removed even if R2 is
  unreachable. The response reports failed image deletions; an operator can
  clean orphaned keys later.
- **Popup fatigue:** the session seen-set and foreground-only trigger limit
  interruptions. Dismiss does not mark read, so the bell remains truthful.
- **Admin handover UI cannot create a new admin from nothing:** operator
  recovery remains the only path when no admin exists. The UI says so.
- **Existing uncommitted work:** all edits must be additive and targeted. No
  formatting sweep or dependency update.

## 10. Left to the builder

- Exact component decomposition and class names, consistent with surrounding
  code.
- Exact SQL formatting and function body structure.
- Whether the admission-number read-only display belongs in the edit screen or
  only in the signup confirmation.
- Exact test fixtures and mocking approach.

## 11. Builder-check resolutions

A fresh review raised the following. These are settled here as builder calls:

1. **Student predicate.** Signup rules key on `intent = 'student'`;
   `link_student_usn` requires `member_type = 'student'`. Alumni are excluded
   from linking; pending faculty are not subjected to student signup rules.
2. **Null year.** A student intent with a null year keeps the legacy behavior
   (no identifier required), because existing fixtures and older clients rely
   on it. Years 1–4 are validated; admission numbers remain first-year-only.
3. **Trigger baseline.** The replacement `handle_new_user()` is based on the
   latest canonical body (`2026102212`), preserving the faculty designation
   requirement and pending `faculty_applications` insert.
4. **Duplicate error contract.** Admission-number and USN duplicates get
   distinct 23505 messages; both roll back the auth user. Clients map both
   without echoing the identifier.
5. **USN linking validation.** The RPC mirrors the client’s canonical
   `^4UB\d{2}CS\d{1,3}$` pattern and updates only `usn`; it does not re-derive
   `year`.
6. **Pin mapper.** Both the query and `mapDiscussionPin` must change; fixing
   only the select would still drop every pin. A focused `refreshPins()` is
   added to the context.
7. **R2 cleanup.** Non-matching URLs are counted as skipped, not failed. Only a
   matching key whose DeleteObject call fails is a failure.
8. **Resignation.** Not exposed in this scope; the RPC remains available.
9. **Notification filter and links.** Web and mobile use the same hidden-type
   set. The safe-link predicate rejects protocol-relative and backslash forms.
10. **Android build.** `apps/mobile/android/gradlew` is present, so
    `./gradlew assembleDebug` is a valid verification command.

Human decisions now recorded:

- `profiles.year` is enforced in the UI only; no database restriction is added.
- Admission numbers use the general 4–24 character format above.

## 12. Residual risks

- The working tree contains pre-existing uncommitted and untracked work. Every
  implementation edit must be targeted; no formatting sweep, dependency
  change, or file replacement outside the listed files.
- The admission-number format is a product decision, not something the
  repository can verify; it is centralized so a later correction is small.
- The prepared migration is not applied, so no end-to-end production proof of
  the admission-number flow is possible in this work.
