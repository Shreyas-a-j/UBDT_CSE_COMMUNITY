# UCC 2.0 Mobile — Website Parity

Date: 2026-10-24
Repository baseline: `main` at `0b232c7355cbf6d5fff102ed1c21bda78186280e` (unchanged)
Mobile app: `apps/mobile` (Expo SDK 58, React Native 0.88, Expo Router)
Backend: the existing shared Supabase project used by the website

## Scope

This phase brings the Android app to parity with the website for **signed-in
student, alumni, approved-faculty and admin tasks**, while removing the
obsolete Network / direct-message / connection product that the website does
not have. It reuses the existing tables, auth users, RLS policies, RPCs, website
API routes and notification fan-out. No website source, route, API route,
config, migration, table or policy was changed.

Status values:

- **Parity** — same task and the same backend effect as the website.
- **Parity with UI difference** — the task is complete; layout/navigation differs.
- **Deferred** — intentionally not implemented, with a reason.

## Security model

- Mobile uses only the public Supabase anon key and the signed-in user's JWT.
  No service-role key exists in `apps/mobile`.
- Faculty/admin work is authorised by the server on every request:
  - announcement image upload: `/api/announcements/upload` re-reads the caller's
    profile and requires approved faculty;
  - CSV export: `/api/export/community-activity` re-reads `role` and
    `faculty_status` from the database;
  - admin review: `/api/admin/faculty` and `/api/admin/faculty/[id]` re-read the
    caller's admin role, and the database review RPC checks `auth.uid()` again.
- Hiding a button is never the authorisation boundary. Direct Supabase writes
  (announcements, events, RSVPs, announcements edit/delete) remain governed by
  the existing RLS policies.
- The mobile session is presented to the website's own server APIs in the
  `@supabase/ssr` cookie format:
  - cookie name `sb-<project-ref>-auth-token`;
  - value `base64-` + base64url(JSON session);
  - chunking at 3180 characters when needed;
  - refresh 120 seconds before expiry, ahead of the website's 90-second margin;
  - the cookie is built from the real `supabase.auth.getSession()` result, kept
    only in memory for one request, and sent only to
    `https://ubdt-cse-community.vercel.app` (absolute and protocol-relative
    paths are rejected);
  - no fabricated session is used for authentication. The website validates the
    access token with `auth.getUser()` on every request.
- A runtime probe (earlier in this task) confirmed the website server parsed a
  3-chunk cookie, `getUser()` validated the bearer token, and a tampered token
  was rejected with 403. The replayable negative checks are in
  `scripts/e2e-website-parity.mjs`.

## Parity matrix

### Authentication and account

| Capability | Website | Android | Status | Notes |
| --- | --- | --- | --- | --- |
| Email/password sign-in | Yes | Yes | Parity | Same Supabase credentials and error mapping. Session persisted in SecureStore. |
| Student registration | Yes | Yes | Parity | Same metadata (`intent`, USN, year, section, skills), validation and USN probe. |
| Alumni registration | Yes | Yes | Parity | Same `graduation_year` metadata. |
| Faculty access request | Yes | Yes | Parity | Same pending application and trigger/fallback behavior. |
| Email-confirmation state | Yes | Yes | Parity | Shown when Supabase returns no session. |
| Forgot password | Yes | Yes | Parity with UI difference | Same `resetPasswordForEmail`; the link opens the website's reset form. |
| Sign out | Yes | Yes | Parity | Clears the device session only. |
| Session restore | Cookies | SecureStore | Parity with UI difference | Same profile provisioning and fallback behavior. |

### Feed and posts

| Capability | Website | Android | Status | Notes |
| --- | --- | --- | --- | --- |
| Feed filters: All / Discussions / Showcases / Events / Announcements | Yes | Yes | Parity | Counts shown on mobile. |
| Batch filter (1st–4th / all) | Yes | Yes | Parity | Same attribution rules. |
| Feed search | Yes | Yes | Parity | Posts, showcases and events. |
| Pinned discussions | Yes | Yes | Parity | 7-day pins on All/Discussions with no active search. |
| Popular showcases | Yes | Yes | Parity | Maximum two upvoted showcases. |
| Announcements section | Yes | Yes | Parity | Grouped by day. |
| Latest posts | Yes | Yes | Parity | 40-post window. |
| Upcoming/live events | Yes | Yes | Parity | Ended events are now excluded from the feed. |
| Create discussion / showcase | Yes | Yes | Parity | Same RLS insert; no post-image upload on the website either. |
| Like / upvote | Yes | Yes | Parity | Optimistic update with rollback. |
| Comments | Yes | Yes | Parity | Latest 200 comments, threaded replies. |
| Edit / delete own post | Yes | Yes | Parity | RLS-filtered failures are surfaced. |
| Share post | Copy link | Native share sheet | Parity with UI difference | Uses the platform share sheet. |
| Faculty pin / unpin | Yes | Yes | Parity | Calls `pin_discussion` / `unpin_discussion`. |
| Linkified text | Yes | Yes | Parity | Safe http(s) tokens only. |

### Announcements

| Capability | Website | Android | Status | Notes |
| --- | --- | --- | --- | --- |
| Announcement channel | Yes | Yes | Parity | Dedicated stack screen; feed links to it. |
| Author filter | Yes | Yes | Parity | Author list with counts. |
| Day grouping | Yes | Yes | Parity | Today / Yesterday / date labels. |
| Reactions (👍 ❤️ 🎉 👏) | Yes | Yes | Parity | One reaction per member; optimistic toggle. |
| Display announcement images | Yes | Yes | Parity | Read-only image grid. |
| Approved-faculty composer | Yes | Yes | Parity | Create and edit; title/body limits match the website. |
| Announcement images | Yes | Yes | Parity | Picker + faculty-gated upload; PNG/JPEG/WebP/GIF, 5 MB, max 4. |
| Edit own announcement | Yes (RLS) | Yes | Parity | Author/admin only; the website dashboard exposes delete, while the RLS policy already permits author/admin updates. |
| Delete own announcement | Yes | Yes | Parity | RLS-filtered failure if not permitted. |

### Events

| Capability | Website | Android | Status | Notes |
| --- | --- | --- | --- | --- |
| Browse active events | Yes | Yes | Parity | Feed + Events tab. Ended events are hidden from both. |
| Event detail | Card/modal | Dedicated screen | Parity with UI difference | Same data; RSVP is disabled at the computed end. |
| RSVP / cancel RSVP | Yes | Yes | Parity | `event_rsvps`, optimistic counts; blocked after the end instant. |
| Host create event | Yes | Yes | Parity | Same RLS insert and validation. |
| Host edit / delete event | Yes | Yes | Parity | Database re-checks; ended events stay manageable. |
| Event reminders | Database fan-out | Deep-linked | Parity | Routed via `content_id` or legacy link. |

### Events — end-time rule

- `event_date` and `event_time` are interpreted as IST (`+05:30`), matching the
  website's `lib/logic/events.ts`; the device timezone is irrelevant.
- End = start + `duration` minutes. A missing, zero or invalid duration
  defaults to **60 minutes**.
- Phase boundaries are exact: before start = `upcoming`; at start through
  `end - 1 ms` = `live`; at end = `ended`.
- `filterActiveEvents` hides ended events from the feed, the Events tab and the
  feed hook. It never hides a future event because of registration state.
- Ended events remain in the database and in the faculty dashboard, where hosts
  can still edit or delete them and see RSVP totals.

### People (replaces Network)

| Capability | Website | Android | Status | Notes |
| --- | --- | --- | --- | --- |
| People directory | Yes | Yes | Parity | Same public profile projection, with the pre-`member_type` fallback. |
| Directory search | Yes | Yes | Parity | Name, USN and bio only. |
| Skill/interest filter | Yes | Yes | Parity | Separate control; matches skills or interests. |
| Directory filters | All / Faculty / Alumni / 1–4 year | Same | Parity | Faculty is approval-gated; alumni never leak into year buckets. |
| Public member profile | Yes | Yes | Parity | About, links, skills, interests, details, showcases. |
| Exclude self | Yes | Yes | Parity | Applied client-side on the loaded page. |
| Server order and cap | `created_at desc`, 500 | Same | Parity | No local re-sorting beyond filtering. |
| Connection requests | N/A | Removed | Parity | No connection surface on the website. |
| Direct messages | N/A | Removed | Parity | No messaging routes, screens, counters or deep links. |

### Notifications

| Capability | Website | Android | Status | Notes |
| --- | --- | --- | --- | --- |
| Notification list | Yes | Yes | Parity | Realtime insert subscription; mark one/all read. |
| Unread badge | Yes | Yes | Parity | Same server-side hidden-type filter. |
| Deep links | Website routes | Mobile routes | Parity with UI difference | Announcements, events, posts, faculty decisions. |
| Legacy messaging/connection rows | N/A | Hidden | Parity | Excluded from list, badge and realtime by `HIDDEN_NOTIFICATION_FILTER`. Database rows/triggers are untouched. |

### Profile

| Capability | Website | Android | Status | Notes |
| --- | --- | --- | --- | --- |
| View own profile | Yes | Yes | Parity | Same row plus live counts. |
| Edit name, bio, skills | Yes | Yes | Parity | Same allowlisted update payload. |
| Edit portfolio / GitHub / LinkedIn | Yes | Yes | Parity | Same URL normalization and errors. |
| Avatar upload | Yes | No | Deferred | Not implemented in this phase; the current avatar is preserved. |
| Email-verification badge | Yes | No | Deferred | The RPC is deployment-dependent; the profile renders without it. |
| Theme toggle | Yes | No | Deferred | No task impact; mobile remains dark-first. |

### Faculty workspace and administration

| Capability | Website | Android | Status | Notes |
| --- | --- | --- | --- | --- |
| Faculty dashboard | Yes | Yes | Parity | Own announcements and events, including ended events. |
| Announcement create / edit / delete | Yes | Yes | Parity | Images included; author/admin enforced by RLS. |
| Event edit / delete | Yes | Yes | Parity | Host/admin enforced by RLS. |
| RSVP totals | Yes | Yes | Parity | Shown for ended and active events. |
| Community activity CSV | Yes | Yes | Parity | Real server download + Android share sheet. |
| Admin review queue | Yes | Yes | Parity | Pending/reviewed, stats, applicant display data. |
| Email verification display | Yes | Yes | Parity (deployment-dependent) | Uses the website's `get_email_verification_status` result; the queue still loads if it is unavailable. |
| Approve / reject | Yes | Yes | Parity | Confirmation dialogs, duplicate-submit guard, server re-check. |
| Admin CSV export | Yes | Yes | Parity | Same stricter approved-status gate. |

## Removed features and data

Removed from mobile:

- the **Network** tab and its directory/connection actions;
- `messages/[id]`, the root `people` screen and all routing to them;
- connection/message types, counters, buttons, hooks, services, deep links and
  notification deep links;
- legacy messaging/connection notification rows from the mobile list and badge.

Retained intentionally:

- all shared tables, rows, triggers, RPCs, policies and notification data;
- the existing website APIs and routes;
- discussions, comments, likes, upvotes, announcements, events and RSVPs;
- the People directory and public profiles (directory-only, no social actions).

No migration, schema, policy, auth user or production row was changed by this
work.

## Deferred features and reasons

1. **Avatar upload** — not implemented in this phase. The existing avatar is
   preserved; the website remains the place to change it.
2. **Native password-reset deep link (`ucc://reset-password`)** — would require
   a shared Supabase redirect-allowlist change. Mobile sends the same recovery
   email and uses the website's secure reset form.
3. **Email-verification badge on the profile** — the RPC is deployment-dependent;
   the admin queue already displays it when available.
4. **Theme toggle** — no task impact.
5. **Natural access-token expiry wait (≈1 hour)** — the mobile refresh boundary
   is unit-tested, logout/tampered-cookie denial is verified, and the website
   re-validates every request. A live wait is not part of the automated run.
6. **On-device faculty/admin workflow run** — requires test accounts and a
   running emulator/device (see below). The APK compiles successfully.

## Verification evidence

Run in `apps/mobile` on 2026-10-24:

| Command | Result |
| --- | --- |
| `npx tsc --noEmit` | Passed; no output. |
| `npx expo lint` | Passed; no errors or warnings. |
| `npm test -- --reporter=dot` | **6 test files, 48 tests passed** (Vitest 5.0.4). |
| `npx expo export --platform android` | Passed; 1458 modules, 51 assets, 4 MB Hermes bundle. |
| `JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64 ./gradlew assembleDebug` | **BUILD SUCCESSFUL in 3m 37s**; 488 tasks; APK `android/app/build/outputs/apk/debug/app-debug.apk` (244,914,926 bytes, debug/universal). |
| `npm run e2e:website` | **7 passed, 0 failed, 4 skipped** (no credentials supplied). |
| `npx expo-doctor` | 9 patch version mismatches reported (pre-existing Expo package pins). No upgrade was performed because dependency changes require approval. |

E2E denial/static checks that ran against the deployed website:

- anonymous CSV export → HTTP 403 with the approved-faculty message;
- anonymous admin queue → HTTP 401;
- anonymous admin review → HTTP 401 before any write;
- anonymous announcement image upload → HTTP 401;
- no Network/messages routes, connection APIs or obsolete deep links in mobile
  source;
- People tab registered;
- ended-event filtering present in the Events tab, feed and feed hook.

Unit coverage added for the new helpers:

- CSV Content-Disposition parsing, filename sanitization, six-month window and
  month-end clamping;
- announcement image types/size/URL normalization/MIME fallback/upload names;
- hidden notification types and the export authorization matrix;
- cookie encoding/chunking/freshness and the IST event phases (existing tests).

## Opt-in authenticated E2E

The harness is `apps/mobile/scripts/e2e-website-parity.mjs`. It never prints
cookies, passwords, tokens or keys and never writes unless explicitly enabled.

Read-only run:

```bash
cd apps/mobile
E2E_SUPABASE_URL=... E2E_SUPABASE_ANON_KEY=... \
E2E_FACULTY_EMAIL=... E2E_FACULTY_PASSWORD=... \
E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=... \
E2E_STUDENT_EMAIL=... E2E_STUDENT_PASSWORD=... \
npm run e2e:website
```

It verifies, against the live deployment:

- approved-faculty CSV download: status, content type, filename, fixed header,
  manifest rows, window/header agreement, rectangular rows, a saved artifact,
  and the six-month client label;
- People projection/exclusion/order and private-column absence;
- faculty → admin queue denial;
- live event IST start/end and phase filtering;
- admin queue load, invalid-decision 400, and logout/session clearing;
- student → CSV/admin/upload denial;
- tampered-cookie rejection (when the Supabase URL is available).

Explicit, destructive opt-ins:

```bash
E2E_ALLOW_IMAGE_UPLOAD=1          # writes one 1x1 PNG to R2 announcements/
E2E_ALLOW_ANNOUNCEMENT_WRITES=1   # create/edit/delete a marked announcement
E2E_ALLOW_ADMIN_REVIEW_WRITES=1 \
E2E_ADMIN_REVIEW_APPLICATION_ID=<uuid> \
E2E_ADMIN_REVIEW_DECISION=approve|reject
```

The admin review write is permanent (there is no undo endpoint) and must only
be used with a disposable test application. Image objects remain in R2 and need
manual cleanup.

**Not executed here:** authenticated faculty/admin/student checks, the image
upload, the announcement round-trip and the admin review write, because no test
accounts were available in this environment. The harness is ready; the results
above are limited to denial and static checks.

## Proof the website was not changed

- `git rev-parse HEAD` is still
  `0b232c7355cbf6d5fff102ed1c21bda78186280e`.
- Writes in this task are under `apps/mobile/**` plus this documentation file.
- No file under the website's `app/`, `components/`, `contexts/`, `lib/`,
  `public/`, `supabase/` or config was written during this task.
- The modified website files shown by `git status` are pre-existing work that
  was recorded before this task and was only read. A byte-for-byte baseline of
  that WIP was not available, so the evidence is the recorded write set.
- No migrations, tables, columns, policies, auth users or production rows were
  created, altered or deleted.
- No commit, push or deployment was performed.

## Changed files (mobile + docs)

Modified:

- `apps/mobile/app.json`
- `apps/mobile/package.json`
- `apps/mobile/package-lock.json`
- `apps/mobile/src/app/(tabs)/_layout.tsx`
- `apps/mobile/src/app/(tabs)/events.tsx`
- `apps/mobile/src/app/(tabs)/index.tsx`
- `apps/mobile/src/app/(tabs)/notifications.tsx`
- `apps/mobile/src/app/(tabs)/profile.tsx`
- `apps/mobile/src/app/_layout.tsx`
- `apps/mobile/src/app/post/[id].tsx`
- `apps/mobile/src/app/sign-in.tsx`
- `apps/mobile/src/components/post-card.tsx`
- `apps/mobile/src/components/segmented.tsx`
- `apps/mobile/src/lib/auth-context.tsx`
- `apps/mobile/src/lib/community.ts`
- `apps/mobile/src/lib/profile.ts`
- `apps/mobile/src/lib/supabase.ts`
- `apps/mobile/src/lib/types.ts`
- `apps/mobile/src/lib/unread-notifications.tsx`
- `apps/mobile/src/lib/validation.ts`
- `docs/mobile/FEATURE_PARITY.md` (this file)

Deleted:

- `apps/mobile/src/app/(tabs)/network.tsx`
- `apps/mobile/src/app/messages/[id].tsx`
- `apps/mobile/src/app/people.tsx`

Added:

- `apps/mobile/scripts/e2e-website-parity.mjs`
- `apps/mobile/src/app/(tabs)/people.tsx`
- `apps/mobile/src/app/admin/index.tsx`
- `apps/mobile/src/app/announcements/create.tsx`
- `apps/mobile/src/app/announcements/edit.tsx`
- `apps/mobile/src/app/announcements/index.tsx`
- `apps/mobile/src/app/create-event.tsx`
- `apps/mobile/src/app/event/[id].tsx`
- `apps/mobile/src/app/faculty/dashboard.tsx`
- `apps/mobile/src/app/forgot-password.tsx`
- `apps/mobile/src/app/people/[id].tsx`
- `apps/mobile/src/app/profile/edit.tsx`
- `apps/mobile/src/app/sign-up.tsx`
- `apps/mobile/src/components/announcement-card.tsx`
- `apps/mobile/src/components/announcement-composer.tsx`
- `apps/mobile/src/components/community-activity-export.tsx`
- `apps/mobile/src/components/event-card.tsx`
- `apps/mobile/src/components/linkified-text.tsx`
- `apps/mobile/src/components/profile-links.tsx`
- `apps/mobile/src/components/section-header.tsx`
- `apps/mobile/src/lib/announcement-image-rules.ts`
- `apps/mobile/src/lib/announcement-image-rules.test.ts`
- `apps/mobile/src/lib/announcement-images.ts`
- `apps/mobile/src/lib/community-export-format.ts`
- `apps/mobile/src/lib/community-export-format.test.ts`
- `apps/mobile/src/lib/community-export.ts`
- `apps/mobile/src/lib/directory.ts`
- `apps/mobile/src/lib/directory.test.ts`
- `apps/mobile/src/lib/faculty.ts`
- `apps/mobile/src/lib/feed-logic.ts`
- `apps/mobile/src/lib/feed-logic.test.ts`
- `apps/mobile/src/lib/notifications.ts`
- `apps/mobile/src/lib/notifications.test.ts`
- `apps/mobile/src/lib/use-community-feed.ts`
- `apps/mobile/src/lib/website-api.ts`
- `apps/mobile/src/lib/website-auth.ts`
- `apps/mobile/src/lib/website-auth.test.ts`
- `apps/mobile/tsconfig.vitest.json`
- `apps/mobile/vitest.config.ts`

## Android build

The debug APK was built from the current source with Java 17 and the installed
Android SDK:

```bash
cd apps/mobile/android
JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64 ./gradlew assembleDebug
```

Application id `com.ucc.community`, URL scheme `ucc`. `android/` is generated
by Expo Continuous Native Generation and is git-ignored; it is not part of the
change set. A release/EAS build and on-device install were not performed.

## Remaining limitations

- Authenticated faculty/admin/student E2E was not executed; no test accounts
  were available. The opt-in harness covers the workflows when credentials are
  supplied.
- The app was compiled, not installed on an emulator or device. Cookie-header
  transport, the image picker, the system share sheet and the admin review UI
  were not exercised end to end on Android in this environment.
- A natural access-token expiry (≈1 hour) was not waited out. The 120-second
  refresh boundary is unit-tested; logout, tampered-cookie rejection and
  server-side re-validation are covered.
- Avatar editing, the native password-recovery deep link, the profile
  verification badge and the theme toggle remain website-only / deferred.
- The debug APK is a universal debug build (≈245 MB), not a signed release.
- `expo-doctor` reports 9 pre-existing patch-level Expo package mismatches.
  Upgrading them was intentionally deferred because dependency changes require
  explicit approval.
