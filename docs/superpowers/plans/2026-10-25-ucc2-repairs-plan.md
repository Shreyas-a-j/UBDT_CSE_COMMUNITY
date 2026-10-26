# UCC 2.0 Repairs and Missing Flows — Implementation Plan

**Date:** 2026-10-25
**Design:** [`docs/superpowers/specs/2026-10-25-ucc2-repairs-design.md`](../specs/2026-10-25-ucc2-repairs-design.md)
**Status:** ready to execute. No product code, migration SQL, or tests have been written yet.
**Branch:** `main`, HEAD `0b232c7` at planning time.

---

## 0. Execution guardrails

These apply to every task.

- **Preserve the working tree.** It contains pre-existing uncommitted and untracked work. Before and after each task run `git status --porcelain` and `git diff --stat`; review the diff and confirm only the files named in that task changed.
- **No broad refactors, formatting sweeps, dependency installs, or environment changes.** If a task appears to need one, stop and report instead.
- **Never read `.env`, `.env.local`, `.ssh`, `.aws`, or key files.** R2 credentials stay server-side only.
- **No commit, push, deploy, or production SQL.** The migration is written and rehearsed locally only.
- **No client-side authorization claims.** Every privileged action stays enforced by RLS or a `SECURITY DEFINER` RPC. UI visibility is only an affordance.
- **No secrets or identifiers in logs.** Never log admission numbers, USNs, passwords, tokens, or full request bodies.
- **Next.js 16.3.8 is not the Next.js in training data.** Before route-handler work, read `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`. Dynamic route `params` are a `Promise` and must be awaited.
- **Expo 58 is not the Expo in training data.** For any new Expo/React Native API, read the versioned docs under `https://docs.expo.dev/versions/v58.0.0/` first.
- **Tests first where a pure helper exists.** Write the failing test, run it, then implement.
- **One writer per worktree.** Do not run parallel implementation sessions in this tree.

### Baseline commands

Run these once before Task 1 and record the output in the implementation report:

```bash
git status --porcelain
git diff --stat
git rev-parse --short HEAD
npm test -- --reporter=dot
cd apps/mobile && npm test -- --reporter=dot
```

Expected baseline: web **41 files / 484 tests passed**; mobile **11 files / 81 tests passed**. A different count means the tree changed since planning; stop and report before editing.

Also record tool availability for the final verification:

```bash
test -x apps/mobile/android/gradlew && echo "gradlew present"
docker info >/dev/null 2>&1 && echo "docker available" || echo "docker unavailable"
supabase --version 2>/dev/null || echo "supabase CLI unavailable"
```

---

## 1. Task order

| Order | Task | Depends on | Why this order |
|---|---|---|---|
| 1 | Pins: mapping, countdown, cap feedback | none | Smallest fix; unblocks the existing pin UI |
| 2 | Announcement deletion + R2 route | none | New route is reused by web and mobile |
| 3 | Web event deletion | none | Independent; small UI change |
| 4 | Admin handover | none | RPCs already exist; UI-only work |
| 5 | Academic-year editing | none | Small, isolated profile change |
| 6 | Admission numbers + USN linking | none | Largest task; migration prepared last before verification |
| 7 | Notification popup | none | Pure helpers + platform components |
| 8 | Full verification and report | 1–7 | Evidence collection |

Tasks 1, 2, 3, 5, and 7 are independent and could be reordered. Task 6 must finish before the final verification because it adds the only migration.

---

## 2. Task 1 — Pins: correct mapping, live countdown, cap feedback

### Goal

The web feed must load active pins from the canonical `discussion_pins.post_id` column, both platforms must show a live server-derived expiry countdown, and authorized users must see clear three-pin-cap feedback. The database remains authoritative for creation, the cap, and expiry.

### Files

| File | Change |
|---|---|
| `lib/logic/discussionPins.ts` | Read `post_id` in `mapDiscussionPin`; add `formatPinCountdown` |
| `lib/logic/discussionPins.test.ts` | Mapping and countdown tests |
| `contexts/CommunityContext.tsx` | Select `post_id`; add focused `refreshPins()`; expose it |
| `components/PostCard.tsx` | Countdown, expiry refresh, cap feedback |
| `components/PostCard.test.tsx` | Countdown/cap/expiry tests |
| `apps/mobile/src/lib/feed-logic.ts` | Port `formatPinCountdown` |
| `apps/mobile/src/lib/feed-logic.test.ts` | Countdown tests |
| `apps/mobile/src/components/post-card.tsx` | Countdown and cap feedback |
| `apps/mobile/src/lib/use-community-feed.ts` | Focused `refreshPins()` |
| `apps/mobile/src/app/(tabs)/index.tsx` | Pass cap state and expiry callback |

### Step 1.1 — Write the failing pure tests

In `lib/logic/discussionPins.test.ts` add:

1. `mapDiscussionPin` maps a row with `post_id: 'post-1'` to `discussion_id: 'post-1'`.
2. A row with neither `post_id` nor `discussion_id` returns `null`.
3. `formatPinCountdown` returns:
   - `Expires in 6d 23h` for 6 days 23 hours ahead,
   - `Expires in 59m 12s` for 59 minutes 12 seconds ahead,
   - `Expires in 42s` for 42 seconds ahead,
   - `Expired` at the exact expiry instant and for an invalid date.
4. `isPinActive` remains false at the exact expiry instant (existing behavior, regression guard).

In `apps/mobile/src/lib/feed-logic.test.ts` add the same countdown cases.

Run and confirm they fail:

```bash
npm test -- lib/logic/discussionPins.test.ts --reporter=dot
cd apps/mobile && npm test -- src/lib/feed-logic.test.ts --reporter=dot
```

### Step 1.2 — Implement the helper and mapper

In `lib/logic/discussionPins.ts`:

- Change `mapDiscussionPin` to read `row.post_id` first, with `row.discussion_id` as a legacy fallback, and expose the value as `discussion_id` in the returned `DiscussionPin`. The rest of the type and helpers stay unchanged.
- Add:

```ts
export function formatPinCountdown(
  expiresAt: string,
  now: Date = new Date()
): string {
  const expires = Date.parse(expiresAt)
  const nowMs = now.getTime()
  if (!Number.isFinite(expires) || expires <= nowMs) return 'Expired'

  const totalSeconds = Math.floor((expires - nowMs) / 1000)
  const days = Math.floor(totalSeconds / 86_400)
  const hours = Math.floor((totalSeconds % 86_400) / 3_600)
  const minutes = Math.floor((totalSeconds % 3_600) / 60)
  const seconds = totalSeconds % 60

  if (days > 0) return `Expires in ${days}d ${hours}h`
  if (hours > 0) return `Expires in ${hours}h ${minutes}m`
  if (minutes > 0) return `Expires in ${minutes}m ${seconds}s`
  return `Expires in ${seconds}s`
}
```

- Port the exact same function to `apps/mobile/src/lib/feed-logic.ts` (no React Native imports).

### Step 1.3 — Fix the web query and add `refreshPins()`

In `contexts/CommunityContext.tsx`:

- Change the pins query select to:

```ts
.select('id, post_id, pinned_by, pinned_at, pin_expires_at, unpinned_at')
```

- Extract the pin-loading portion of `fetchData` into a callback that:
  1. fetches active pins with the query above,
  2. maps and filters them with `mapDiscussionPin` / `selectActivePins`,
  3. fetches the pinned posts by id using `POST_SELECT` (with the existing `select('*')` fallback),
  4. returns `{ activePins, pinnedPosts, error }`.
- `fetchData` uses that callback and keeps its current behavior, including applying pin fields to the regular feed and setting `rawPinnedPosts`.
- Add `refreshPins: () => Promise<void>` to `CommunityContextType` and the provider value.
- `refreshPins()` calls the pin-loading callback, sets `rawPinnedPosts`, and applies the active pin fields to the current `posts` with `applyActivePinsToPosts`. It must not set `feedLoading` or refetch posts, events, comments, or announcements.
- After successful or failed `pinDiscussion` / `unpinDiscussion`, call `await refreshPins()` instead of `await fetchData()` so the focused path is used. Keep the existing toast and error mapping.
- Keep `setPostsRevision(v => v + 1)` after a successful pin/unpin.

### Step 1.4 — Web `PostCard`

In `components/PostCard.tsx`:

- Destructure `refreshPins` from `useCommunity()`.
- Add a `now` state and an effect that ticks once per second **only while `post.pin_expires_at` is set and the pin is active**. Use a ref (`expiryRefreshedRef`) so the expiry refresh happens once per pin id.
- When `formatPinCountdown(post.pin_expires_at, now) === 'Expired'`:
  - hide the banner,
  - call `refreshPins()` once for that post id.
- Replace the static `Expires {formatDate(...)}` banner text with `formatPinCountdown(...)`. Keep `Pinned by faculty`.
- Keep the pin button available to `canManageDiscussionPins`.
- If `pinnedPostIds.size >= MAX_ACTIVE_DISCUSSION_PINS && !isPinned`, disable the pin button and use `aria-label`/`title` “Maximum 3 active pins”. The RPC error remains the final authority.
- If `isPinned`, the button remains Unpin for authorized users.
- Use `PIN_SLOTS_FULL_MESSAGE` for the title text if it fits; otherwise use the short label above.

### Step 1.5 — Mobile `PostCard` and feed hook

In `apps/mobile/src/components/post-card.tsx`:

- Add an optional `pinExpiresAt?: string | null` prop, defaulting to `post.pin_expires_at`, so tests can drive the countdown without constructing a whole post.
- Add an optional `pinLimitReached?: boolean` prop and an optional `onPinExpired?: () => void`.
- Tick once per second only while the pin is active. Render `formatPinCountdown(...)` in the existing pin banner instead of the static `7-day pin` text.
- When it expires, hide the banner and call `onPinExpired` once (guard with a ref).
- If `pinLimitReached` is true and the post is not pinned, disable the pin button and set the accessibility label to “Maximum 3 active pins”.

In `apps/mobile/src/lib/use-community-feed.ts`:

- Extract the pin-loading portion of `load` into a focused `refreshPins()` that updates `pinnedPosts` and applies pin fields to the current `posts` without setting the full-screen loading state.
- Export `refreshPins` from the hook.
- Keep `togglePin` behavior and error mapping. After success or failure, call `refreshPins()` instead of the full `load('refresh')` where practical; if the existing `load` also refreshes unrelated state that the screen needs, leave it and add the focused path only for expiry.

In `apps/mobile/src/app/(tabs)/index.tsx`:

- Pass `pinLimitReached={pinnedPosts.length >= MAX_ACTIVE_DISCUSSION_PINS}` and `onPinExpired={() => void refreshPins()}` to both `PostCard` call sites.
- Keep the existing “All 3 pin slots are in use” notice.

### Step 1.6 — Tests and acceptance

Add web `PostCard` tests:

- An authorized faculty member sees the countdown text for an active pin.
- A non-authorized member never sees the pin control.
- When three pins are active and this post is not pinned, the pin button is disabled with the cap label.
- An active pin always shows Unpin to an authorized user.

Add or extend mobile tests for the pure helper. UI coverage on mobile is optional if the existing mobile test setup does not render React Native components; typecheck and lint must still pass.

Commands:

```bash
npm test -- lib/logic/discussionPins.test.ts --reporter=dot
npm test -- components/PostCard.test.tsx --reporter=dot
cd apps/mobile && npm test -- src/lib/feed-logic.test.ts --reporter=dot
```

Acceptance:

- The web pin query selects `post_id`; `mapDiscussionPin` reads `post_id` first and keeps `discussion_id` only as a legacy fallback. No web pin query selects `discussion_id`.
- Countdown reaches `Expired` and the banner disappears without a full feed refetch.
- The cap label appears only to authorized users and only when all three slots are occupied.
- Existing pin RPCs and database rules are untouched.

---

## 3. Task 2 — Announcement deletion and R2 cleanup

### Goal

Authors and admins can delete an announcement from the web channel and the mobile channel, with confirmation, duplicate-submit protection, feedback, immediate list refresh, and best-effort R2 image cleanup. The database row is always deleted through the user-scoped client so RLS remains a second layer.

### Files

| File | Change |
|---|---|
| `lib/r2.ts` | New shared R2 config/key/delete helpers |
| `app/api/announcements/upload/route.ts` | Use the shared helpers; no behavior change |
| `app/api/announcements/[id]/route.ts` | New authenticated DELETE route |
| `app/api/announcements/[id]/route.test.ts` | Route contract tests |
| `lib/logic/announcements.ts` | `canDeleteAnnouncement` pure helper |
| `lib/logic/announcements.test.ts` | Helper tests |
| `contexts/CommunityContext.tsx` | `deleteAnnouncement` method and state removal |
| `components/AnnouncementCard.tsx` | Author/admin delete control |
| `components/AnnouncementCard.test.tsx` | Visibility/confirm/duplicate tests |
| `app/faculty/dashboard/page.tsx` | Use the server route instead of direct delete |
| `apps/mobile/src/lib/feed-logic.ts` | Port `canDeleteAnnouncement` |
| `apps/mobile/src/lib/feed-logic.test.ts` | Helper tests |
| `apps/mobile/src/components/announcement-card.tsx` | Optional delete control |
| `apps/mobile/src/app/announcements/index.tsx` | Delete flow for author/admin |
| `apps/mobile/src/app/faculty/dashboard.tsx` | Use the server route instead of direct delete |

### Step 2.1 — Pure permission helper (test first)

In `lib/logic/announcements.ts` add:

```ts
export function canDeleteAnnouncement(
  viewer: { id?: string | null; role?: string | null } | null | undefined,
  authorId: string
): boolean {
  if (!viewer?.id) return false
  return viewer.id === authorId || viewer.role === 'admin'
}
```

Port the same function to `apps/mobile/src/lib/feed-logic.ts`.

Tests:

- Author sees the control.
- Admin sees the control.
- Another student/faculty member does not.
- Signed-out viewer does not.

Run and confirm failure before implementing.

### Step 2.2 — Extract R2 helpers

Create `lib/r2.ts` with:

- `r2Config()` — the exact env parsing currently in `app/api/announcements/upload/route.ts` (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID`, `R2_BUCKET_NAME`, `NEXT_PUBLIC_R2_PUBLIC_DOMAIN`), returning `null` when incomplete.
- `r2ObjectEndpoint(config, key)` — the existing endpoint shape.
- `announcementKeyFromPublicUrl(url, publicDomain)`:
  - accepts only `https://<publicDomain>/announcements/<key>`,
  - rejects `..`, backslashes, query strings, and fragments,
  - returns the `announcements/<key>` key or `null`.
- `deleteR2Object(config, key)` — `AwsClient` with `service: 's3'`, `region: 'auto'`, `method: 'DELETE'`; returns `{ ok: true }` or `{ ok: false, error: string }` without logging credentials.

Update `app/api/announcements/upload/route.ts` to import `r2Config` and `r2ObjectEndpoint`. The upload request, validation, response shape, and `Content-Length` behavior must remain exactly as they are. Re-run `app/api/announcements/upload/route.test.ts` after the extraction.

### Step 2.3 — New DELETE route

Create `app/api/announcements/[id]/route.ts`:

```ts
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) { ... }
```

Contract:

1. `await params`; validate `id` is a non-empty UUID-like string. Return 400 for an empty id.
2. `createClient()` from `@/lib/supabase/server`; `auth.getUser()`. Return 401 when unauthenticated.
3. Select `id, author_id, image_urls` from `announcements` by id with `.maybeSingle()`.
   - Query error: 500 with a generic message.
   - No row: 404 `{ error: 'This announcement is already gone.' }`.
4. Re-read the caller's profile `role` with `.select('role').eq('id', user.id).maybeSingle()`. Return 500 if the profile cannot be read.
5. Authorize: `user.id === row.author_id || profile?.role === 'admin'`. Return 403 otherwise.
6. Delete with the user-scoped client:

```ts
const { data, error } = await supabase
  .from('announcements')
  .delete()
  .eq('id', id)
  .select('id')
```

   - Error: 500 with a generic message.
   - Empty `data`: 404 `{ error: 'This announcement is already gone.' }` (RLS filtered it or another request won the race).
7. Parse `image_urls` defensively. For each URL:
   - non-matching domain/prefix or unsafe key → `imagesSkipped += 1`;
   - matching key → call `deleteR2Object`; success increments `imagesDeleted`, failure increments `imagesFailed` and records a short reason.
8. If `r2Config()` is null, do not block the deletion. Count every candidate announcement key as failed and include `imageCleanupError: 'Server storage configuration is missing.'`.
9. Return:

```json
{
  "deleted": true,
  "imagesDeleted": 0,
  "imagesFailed": 0,
  "imagesSkipped": 0,
  "imageCleanupError": null
}
```

Do not return R2 credentials, full URLs, or stack traces. The row is deleted before object cleanup (DB-first), so an R2 outage cannot leave an undeletable row.

### Step 2.4 — Route tests

Create `app/api/announcements/[id]/route.test.ts`, following the proxy/mock style in `app/api/announcements/route.test.ts`:

- 401 for signed-out callers; no delete.
- 403 for a different student and a different faculty member.
- 404 when the row does not exist.
- 404 when the delete returns zero rows.
- 200 for the author; assert one delete call with the id.
- 200 for an admin who is not the author.
- Non-R2 URL is `imagesSkipped`, not failed.
- R2 `DELETE` failure returns 200 with `deleted: true` and `imagesFailed: 1`.
- Missing R2 config still deletes the row and reports the cleanup failure.
- Path-traversal URL (`/announcements/../secret`) is skipped and never passed to R2.

### Step 2.5 — Web context and card

In `contexts/CommunityContext.tsx`:

- Add to the interface:

```ts
deleteAnnouncement: (id: string) => Promise<{
  ok: boolean
  alreadyGone?: boolean
  error?: string
}>
```

- Implement it with `fetch(`/api/announcements/${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'same-origin' })`.
- Parse the JSON defensively. On `response.ok`, remove the row from `announcements` and return `{ ok: true }`.
- On 404, remove the row too and return `{ ok: true, alreadyGone: true }`.
- On any other status, return `{ ok: false, error }` and show a toast in the caller, not in the context. Do not optimistically remove on failure.
- Expose it in the provider value.

In `components/AnnouncementCard.tsx`:

- Use `useCommunity()` for `currentUser`, `deleteAnnouncement`, and `setIsAuthModalOpen`.
- Compute `canDelete = canDeleteAnnouncement(currentUser, announcement.author_id)`.
- Add a trash button in the card header, visible only when `canDelete`, with `aria-label="Delete announcement"`.
- On click: `window.confirm('Delete this announcement? This cannot be undone.')`.
- Use a `useRef<Set<string>>` guard plus a `deleting` state. If the id is already in the ref, return.
- On success: toast `Announcement deleted`; if `alreadyGone`, toast `The announcement was already gone.` The context state removal makes the page update.
- On failure: toast the server message.
- Do not change reactions, images, or the article id.

Update `components/AnnouncementCard.test.tsx`:

- Author sees delete; admin sees delete; other member does not.
- Confirmation is required.
- A second click while in flight does not call `deleteAnnouncement` twice.
- Failure keeps the card and shows feedback.

### Step 2.6 — Faculty dashboard (web)

In `app/faculty/dashboard/page.tsx`:

- Replace the direct `supabase.from('announcements').delete()` call with `deleteAnnouncement` from `useCommunity()`.
- Keep the confirmation and toast behavior.
- Add a ref-based duplicate guard; the current handler has none.
- On success, call `fetchMyContent()` to refresh the dashboard list. The channel page updates through context state.

### Step 2.7 — Mobile

In `apps/mobile/src/components/announcement-card.tsx`:

- Add optional props `onDelete?: () => void` and `deleting?: boolean`.
- When `onDelete` is provided, render a trash `Pressable` in the header with `accessibilityRole="button"`, `accessibilityLabel="Delete announcement"`, and disabled state while `deleting`.

In `apps/mobile/src/app/announcements/index.tsx`:

- Compute `canDelete` with `canDeleteAnnouncement(profile, announcement.author_id)`.
- Add a `deletingIds` ref/set and `actionError` usage.
- On delete: `Alert.alert('Delete announcement', 'Delete “<title>”? This cannot be undone.', [Cancel, Delete])`.
- On confirm, call:

```ts
await websiteJson<{ deleted?: boolean }>(
  `/api/announcements/${encodeURIComponent(announcement.id)}`,
  { method: 'DELETE', headers: { Accept: 'application/json' } }
)
```

- On success, remove the row from local `announcements` state. On 404, remove it and show “already gone”. On failure, show the server message in the existing `StatusBanner`.
- Pass `onDelete` only when `canDelete`.

In `apps/mobile/src/app/faculty/dashboard.tsx`:

- Replace the direct Supabase delete in `deleteAnnouncement` with the same website route.
- Keep `Alert.alert`, the busy id, and the local removal.
- On 404, treat as already gone and remove the row.

### Step 2.8 — Acceptance

```bash
npm test -- app/api/announcements/[id]/route.test.ts --reporter=dot
npm test -- components/AnnouncementCard.test.tsx --reporter=dot
npm test -- lib/logic/announcements.test.ts --reporter=dot
npm test -- app/api/announcements/upload/route.test.ts --reporter=dot
cd apps/mobile && npm test -- src/lib/feed-logic.test.ts --reporter=dot
```

- The author and admin see delete; everyone else does not.
- The database row is removed even if R2 is unavailable.
- Non-R2 URLs are skipped, not reported as failures.
- The announcements channel and faculty dashboard both use the server route.
- No direct client delete remains in either mobile announcement path.

---

## 4. Task 3 — Web event deletion and mobile parity check

### Goal

The host can delete an event from the web event card with confirmation, duplicate protection, feedback, and list refresh. Mobile already has deletion; verify and align its guard/copy without changing event expiry, IST handling, or the 60-minute rule.

### Files

| File | Change |
|---|---|
| `components/EventCard.tsx` | Host-only delete control |
| `components/EventCard.test.tsx` | New component tests |
| `apps/mobile/src/app/event/[id].tsx` | Verify confirmation/duplicate guard |
| `apps/mobile/src/app/faculty/dashboard.tsx` | Verify existing guard/copy |

### Step 3.1 — Web implementation

In `components/EventCard.tsx`:

- Destructure `deleteEvent` from `useCommunity()`.
- Add `isDeleting` state and a `deletingRef` guard.
- Next to the host's edit button, add a trash button visible only to `isHost`:
  - `aria-label="Delete event"`,
  - disabled while deleting,
  - `window.confirm('Delete this event? This cannot be undone.')`.
- On confirm, call `await deleteEvent(event.id)`.
- On success: toast `Event deleted`. The context already removes the event from `rawEvents`.
- On failure: toast the message from `deleteEvent` (the context already distinguishes “already gone” from RLS denial).
- Do not change the edit form, date/time handling, countdown, or RSVP behavior.

### Step 3.2 — Tests

Create `components/EventCard.test.tsx` (there is no existing one) with the same mocking style as `PostCard.test.tsx`:

- Host sees Edit and Delete; a non-host sees neither delete nor a false success.
- Confirmation is required; declining does not call `deleteEvent`.
- A second click while in flight does not call twice.
- `deleteEvent` returning `false` leaves the card and shows the failure path.
- Existing event fields still render.

### Step 3.3 — Mobile verification

Read `apps/mobile/src/app/event/[id].tsx` and `apps/mobile/src/app/faculty/dashboard.tsx`:

- Confirm both use `Alert.alert` with Cancel/Delete and a destructive style.
- Confirm a busy/ref guard prevents duplicate deletes. If the event detail screen has no guard, add one local `deleting` ref/state; do not change the Supabase call.
- Align copy to “Delete this event? This cannot be undone.” where it differs.
- Do not add expiry-based auto-deletion.

### Step 3.4 — Acceptance

```bash
npm test -- components/EventCard.test.tsx --reporter=dot
npm run typecheck
cd apps/mobile && npm run typecheck
```

- Only the host sees the web delete control.
- RLS remains the authority; the UI does not attempt to authorize.
- No event rule (IST, 60 minutes, upcoming/expired) changes.

---

## 5. Task 4 — Administrator handover

### Goal

Add a clear nomination/transfer card on `/admin` and the mobile admin screen, plus a nominee accept/decline banner visible anywhere. The existing succession RPCs remain the only write path. The UI must handle pending, accepted, declined, cancelled, self, ineligible, and already-pending states without inventing a new recovery mechanism.

### Files

| File | Change |
|---|---|
| `components/AdminHandover.tsx` | New web handover card |
| `components/AdminNominationBanner.tsx` | New web nominee banner |
| `components/AdminHandover.test.tsx` | New tests |
| `components/AdminNominationBanner.test.tsx` | New tests |
| `app/admin/page.tsx` | Mount the handover card |
| `components/AppShell.tsx` | Mount the nominee banner |
| `apps/mobile/src/lib/admin.ts` | Pure eligibility/summary helpers |
| `apps/mobile/src/lib/admin.test.ts` | Helper tests |
| `apps/mobile/src/components/admin-handover.tsx` | New mobile handover card |
| `apps/mobile/src/components/admin-nomination-banner.tsx` | New mobile nominee banner |
| `apps/mobile/src/app/admin/index.tsx` | Mount the handover card |
| `apps/mobile/src/app/_layout.tsx` | Mount the nominee banner at the signed-in root |

### Step 4.1 — Data contracts

The migration `2026102208_single_admin_succession.sql` already provides:

- `admin_nominations` (`id`, `nominated_by`, `nominee_id`, `status`, `note`, `created_at`, `responded_at`).
- `admin_audit_log` (`action`, `actor_id`, `actor_name`, `target_id`, `target_name`, `nomination_id`, `outcome`, `detail`, `created_at`).
- RPCs:
  - `nominate_admin(p_nominee uuid, p_note text default null) returns uuid`
  - `accept_admin_nomination(p_id uuid) returns void`
  - `decline_admin_nomination(p_id uuid) returns void`
  - `cancel_admin_nomination(p_id uuid) returns void`
  - `resign_admin(p_reason text default null)` — not exposed in this scope
  - `recover_admin(...)` — service-role/operator only, never called by a browser or app
- Eligibility: `role = 'faculty'`, `faculty_status in ('approved','verified')`, `member_type = 'faculty'`.
- One pending nomination at a time, enforced by a partial unique index.
- RLS: admins see all nominations/audit; a nominee sees their own nomination; audit is admin-only.

Do not write to these tables directly. Do not add a “make admin” button. Do not expose resignation or recovery.

### Step 4.2 — Web handover card

Create `components/AdminHandover.tsx`:

- `'use client'`.
- Use `createClient()` from `@/lib/supabase/client` and `useAuth()` for `profile` and `refreshProfile`.
- State: `loading`, `error`, `actionError`, `nominees`, `pending`, `audit`, `selectedId`, `note`, `busy`.
- Load on mount and when the tab regains focus:
  1. Eligible nominees:
     ```ts
     .from('profiles')
     .select('id, name, usn, designation, avatar_url')
     .eq('role', 'faculty')
     .in('faculty_status', ['approved', 'verified'])
     .eq('member_type', 'faculty')
     .neq('id', profile.id)
     .order('name')
     ```
  2. Pending nomination:
     ```ts
     .from('admin_nominations')
     .select('*, nominee:profiles!nominee_id (id, name, usn), nominator:profiles!nominated_by (id, name)')
     .eq('status', 'pending')
     .maybeSingle()
     ```
  3. Audit:
     ```ts
     .from('admin_audit_log')
     .select('*')
     .order('created_at', { ascending: false })
     .limit(10)
     ```
- UI:
  - Card title “Administrator handover”.
  - Copy: “The nominee must accept before the role transfers. If no administrator remains, operator recovery is required.”
  - With no pending nomination: a native `<select>` of eligible nominees, an optional note `<textarea maxLength={500}>`, and a “Nominate successor” button.
  - With a pending nomination: nominee name, nominated-by name, creation time, status, note, and a “Cancel nomination” button.
  - Confirmation:
    - Nominate: `Nominate <name> as administrator? They must accept before the role transfers.`
    - Cancel: `Cancel the pending nomination for <name>?`
  - Use a ref-based busy guard; disable controls while busy.
  - Call `supabase.rpc('nominate_admin', { p_nominee: selectedId, p_note: note.trim() || null })` or `supabase.rpc('cancel_admin_nomination', { p_id: pending.id })`.
  - Show RPC errors verbatim in an alert/status area. Do not replace them with a generic message.
  - After success, toast, clear the form, reload all three reads, and call `refreshProfile()` if the current user’s role could have changed (nomination does not change it; acceptance does).
  - Audit rows: action, actor name, target name, outcome, time. Read-only.
- Empty states:
  - No eligible nominees: “No approved faculty are eligible yet.”
  - No audit entries: “No succession activity yet.”

Mount `<AdminHandover />` in `app/admin/page.tsx` after `<CommunityActivityExport />` and before the stats grid. The page is already admin-gated.

### Step 4.3 — Web nominee banner

Create `components/AdminNominationBanner.tsx`:

- `'use client'`.
- Use `useAuth()` for `profile` and `refreshProfile`, and `createClient()`.
- On mount and on window focus, query:
  ```ts
  .from('admin_nominations')
  .select('*, nominator:profiles!nominated_by (name)')
  .eq('nominee_id', profile.id)
  .eq('status', 'pending')
  .maybeSingle()
  ```
- If none, render `null`.
- If present, render a non-blocking banner: “**<nominator>** nominated you as administrator.” with Accept and Decline.
- Confirm both actions:
  - Accept: `Accept the administrator nomination? You will become the only administrator.`
  - Decline: `Decline this nomination? The current administrator stays in place.`
- Call `supabase.rpc('accept_admin_nomination', { p_id: nomination.id })` or `decline_admin_nomination`.
- On success: toast, clear the banner, and `await refreshProfile()`. Acceptance changes `role`; the admin page will re-render with admin access.
- On failure: show the RPC message; keep the banner.
- Guard against duplicate calls with a ref.
- Mount `<AdminNominationBanner />` in `components/AppShell.tsx` near the other global modals, so it appears on signed-in app pages and not on auth pages.

### Step 4.4 — Mobile pure helpers

Create `apps/mobile/src/lib/admin.ts`:

```ts
export interface AdminNominee {
  id: string
  name: string
  usn: string | null
  designation: string | null
}

export function isEligibleAdminNominee(
  profile: { id?: string | null; role?: unknown; faculty_status?: unknown; member_type?: unknown } | null | undefined,
  currentAdminId: string | null | undefined
): boolean {
  if (!profile?.id || profile.id === currentAdminId) return false
  return (
    profile.role === 'faculty' &&
    (profile.faculty_status === 'approved' || profile.faculty_status === 'verified') &&
    profile.member_type === 'faculty'
  )
}

export function nominationStatusLabel(status: string): string {
  switch (status) {
    case 'pending': return 'Awaiting nominee response'
    case 'accepted': return 'Accepted'
    case 'declined': return 'Declined'
    case 'cancelled': return 'Cancelled'
    default: return 'Unknown'
  }
}
```

Tests in `apps/mobile/src/lib/admin.test.ts` cover self, wrong role, pending/rejected faculty, wrong member type, and status labels.

### Step 4.5 — Mobile handover card

Create `apps/mobile/src/components/admin-handover.tsx`:

- Use `supabase` from `@/lib/supabase`, `useAuth()` for `profile` and `refreshProfile`.
- Load the same three datasets on mount and on `useFocusEffect`.
- Render inside a card/section:
  - `SectionLabel` “Administrator handover”.
  - A note explaining nominee acceptance and operator recovery.
  - If pending: nominee name, status, note, “Cancel nomination” `GhostButton`.
  - If none: a list of eligible nominees as selectable rows/chips (no new picker dependency), a `TextField` for the note (`maxLength={500}`), and a `PrimaryButton` “Nominate successor”.
  - Audit list with action, actor, target, outcome, and date.
- Confirm with `Alert.alert` using the same copy as web.
- Call the same RPCs. Use a busy ref. Show errors in a `StatusBanner`.
- Mount `<AdminHandover />` in `apps/mobile/src/app/admin/index.tsx` after `<CommunityActivityExport />` and before `<View style={styles.stats}>`.

### Step 4.6 — Mobile nominee banner

Create `apps/mobile/src/components/admin-nomination-banner.tsx`:

- Use `useAuth()` and `supabase`.
- Query the pending nomination for the current nominee on mount and when the app returns to `active` (`AppState`).
- Render a compact banner at the top of the signed-in root, above the navigator, with Accept/Decline.
- Confirm with `Alert.alert`; call the same RPCs; `await refreshProfile()` on success.
- Guard duplicates with a ref.
- Mount it in `apps/mobile/src/app/_layout.tsx` inside the signed-in branch:

```tsx
<>
  <Stack ...>...</Stack>
  {session ? <AdminNominationBanner /> : null}
</>
```

Do not put it only on the admin screen: a nominee is not an admin yet.

### Step 4.7 — Tests and acceptance

Web tests mock the Supabase client and assert:

- The card loads eligible nominees and excludes the current admin.
- `nominate_admin` is called with the selected id and trimmed note.
- RPC errors are displayed verbatim.
- `cancel_admin_nomination` is called with the pending id.
- The banner calls `accept_admin_nomination` / `decline_admin_nomination` only after confirmation.
- Acceptance calls `refreshProfile`; declining does not change the role.
- No direct `.update({ role: 'admin' })` exists anywhere.

Commands:

```bash
npm test -- components/AdminHandover.test.tsx --reporter=dot
npm test -- components/AdminNominationBanner.test.tsx --reporter=dot
cd apps/mobile && npm test -- src/lib/admin.test.ts --reporter=dot
npm run typecheck
cd apps/mobile && npm run typecheck
```

Acceptance:

- No hardcoded admin email or user id.
- Self-nomination is not offered and is rejected by the RPC if forced.
- A second pending nomination is not offered; the RPC is the final guard.
- The audit list is read-only.
- Recovery is described as operator-only and is not callable from either client.

---

## 6. Task 5 — Academic-year editing

### Goal

Students can edit their academic year (1–4) on web and mobile. Alumni keep `graduation_year`; faculty/admin do not see a student-year control. This is **UI-only enforcement** by decision; no database restriction is added for non-students.

### Files

| File | Change |
|---|---|
| `lib/validation.ts` | `validateAcademicYear` |
| `lib/validation.test.ts` | Validation tests |
| `components/ProfileModal.tsx` | Student year select |
| `components/ProfileModal.test.tsx` | Visibility/save tests |
| `apps/mobile/src/lib/validation.ts` | `validateAcademicYear` |
| `apps/mobile/src/app/profile/edit.tsx` | Student year chips |

### Step 5.1 — Pure validation (test first)

Add to both validation modules:

```ts
export function validateAcademicYear(year: unknown): string | null {
  return typeof year === 'number' && Number.isInteger(year) && year >= 1 && year <= 4
    ? null
    : 'Select a valid academic year.'
}
```

Tests: 1–4 pass; 0, 5, `1.5`, `'2'`, `null`, `NaN` fail with the message.

### Step 5.2 — Web profile modal

In `components/ProfileModal.tsx`:

- Add `const [year, setYear] = useState<number | null>(profile?.year ?? null)`.
- Reset it in the existing `useEffect` when `profile` changes.
- Show a select only when `profile.member_type === 'student'`:
  - label “Academic year”,
  - options 1st–4th year,
  - `value={year ?? ''}`,
  - required.
- For alumni: keep the existing `Class of <graduation_year>` read-only chip and do not show the student select.
- For faculty/admin: do not show the student select.
- On save:
  - if the profile is a student, validate `validateAcademicYear(year)` and show the message if invalid;
  - include `year` in the existing `updateProfile({ ... })` payload only for students.
- Do not add a `graduation_year` edit control. Alumni graduation year remains separate and unchanged.

### Step 5.3 — Mobile profile edit

In `apps/mobile/src/app/profile/edit.tsx`:

- Add `year` state initialized from `profile.year`.
- For `profile.member_type === 'student'`, render a four-option chip group (1st–4th year) using the existing `Pressable`/chip styles. No new dependency.
- For alumni/faculty/admin, do not render the group.
- On save, validate and include `year` in `updateProfile` only for students.
- Keep the existing USN/branch identity text and avatar note.
- Do not add alumni graduation-year editing.

### Step 5.4 — Tests and acceptance

```bash
npm test -- lib/validation.test.ts --reporter=dot
npm test -- components/ProfileModal.test.tsx --reporter=dot
cd apps/mobile && npm test -- src/lib/validation.test.ts --reporter=dot
npm run typecheck
cd apps/mobile && npm run typecheck
```

Acceptance:

- A student sees and can save 1–4.
- Alumni see `Class of …` and no student select.
- Faculty/admin see no student select.
- Direct API writes to `profiles.year` remain possible; this limitation is recorded in the final report. No migration is added for year.

---

## 7. Task 6 — First-year admission numbers and one-time USN linking

### Goal

A first-year student can register without a USN by providing a distinct admission number. The admission number is profile/signup data only; sign-in remains email + password. Years 2–4 still require a USN. A student who registered without a USN can link one later, once, through a narrow server RPC. No enumeration endpoint, no credential logging, no service-role client.

### Files

| File | Change |
|---|---|
| `supabase/migrations/2026102502_admission_numbers_and_usn_linking.sql` | New additive migration (not applied) |
| `supabase/test-admission-numbers.sql` | Local SQL tests |
| `lib/validation.ts` | Admission-number helpers and student-signup rules |
| `lib/validation.test.ts` | Web validation tests |
| `components/auth/StudentSignUpForm.tsx` | Admission-number field, year lock, metadata |
| `contexts/CommunityContext.tsx` | `linkStudentUsn` method |
| `components/ProfileModal.tsx` | Add-USN field and admission-number-on-file display |
| `components/ProfileModal.test.tsx` | Linking visibility tests |
| `apps/mobile/src/lib/validation.ts` | Mirrored helpers and rules |
| `apps/mobile/src/lib/validation.test.ts` | Mobile validation tests |
| `apps/mobile/src/app/sign-up.tsx` | Admission-number field, year lock, metadata |
| `apps/mobile/src/app/profile/edit.tsx` | Add-USN field and admission-number-on-file display |
| `apps/mobile/src/lib/auth-context.tsx` | Only if a `linkStudentUsn` helper is added; otherwise use `refreshProfile` |

### Step 6.1 — Migration design

Create `supabase/migrations/2026102502_admission_numbers_and_usn_linking.sql` with `begin; ... commit;` and `notify pgrst, 'reload schema';`.

**A. Table**

```sql
create table if not exists public.student_admission_numbers (
  profile_id uuid primary key
    references public.profiles(id) on delete cascade,
  admission_number text not null,
  created_at timestamptz not null default timezone('utc'::text, now()),
  constraint student_admission_numbers_format
    check (admission_number ~ '^[A-Z0-9][A-Z0-9/-]{2,22}[A-Z0-9]$')
);

create unique index if not exists student_admission_numbers_admission_number_key
  on public.student_admission_numbers (upper(btrim(admission_number)));

alter table public.student_admission_numbers enable row level security;

drop policy if exists "Owners and admins read admission numbers"
  on public.student_admission_numbers;
create policy "Owners and admins read admission numbers"
  on public.student_admission_numbers
  for select
  using (auth.uid() = profile_id or public.is_admin(auth.uid()));

revoke all on table public.student_admission_numbers from anon, authenticated;
grant select on table public.student_admission_numbers to authenticated;
```

No client INSERT/UPDATE/DELETE policy. The signup trigger writes as the table owner. `profiles` is deliberately not extended, because public profile reads use `select('*')`.

**B. Replacement `handle_new_user()`**

Copy the latest canonical body from `2026102212_faculty_visibility_and_email_verification.sql` (lines 93–222) verbatim, then add:

1. A local `admission_val text;` and `v_constraint text;`.
2. After `usn_val` normalization:

```sql
admission_val := nullif(upper(btrim(meta->>'admission_number')), '');
if admission_val is not null
   and admission_val !~ '^[A-Z0-9][A-Z0-9/-]{2,22}[A-Z0-9]$' then
  raise exception using
    errcode = '23514',
    message = 'Enter a valid admission number.',
    detail = 'Use 4-24 letters, digits, hyphens or slashes.';
end if;
```

3. Before the profile insert, apply the student-intent rules. Use `intent = 'student'`, not `role`:

```sql
if intent = 'student' then
  if admission_val is not null and yr is distinct from 1 then
    raise exception using
      errcode = '23514',
      message = 'Admission numbers are only accepted for first-year students.';
  end if;
  if yr = 1 then
    if usn_val is null and admission_val is null then
      raise exception using
        errcode = '23514',
        message = 'First-year students need either a USN or an admission number.';
    end if;
  elsif usn_val is null then
    raise exception using
      errcode = '23514',
      message = 'A USN is required for students in years 2-4.';
  end if;
end if;
```

A null `year` preserves the legacy signup behavior: no identifier is required, because existing fixtures and older clients create student rows without one. Years 1–4 are validated. Admission numbers supplied for years 2–4 (or a null year), including direct Auth API calls that also send a valid USN, are rejected. Faculty and alumni intent are unaffected. The existing faculty designation check and pending `faculty_applications` insert remain.

4. After the profile insert, insert the admission row for first-year student intent when present:

```sql
if intent = 'student' and yr = 1 and admission_val is not null then
  insert into public.student_admission_numbers (profile_id, admission_number)
  values (new.id, admission_val)
  on conflict (profile_id) do nothing;
end if;
```

5. Replace the outer `exception when unique_violation` handler so it distinguishes the admission-number index from the USN index:

```sql
exception when unique_violation then
  get stacked diagnostics v_constraint = constraint_name;
  if v_constraint = 'student_admission_numbers_admission_number_key' then
    raise exception using
      errcode = '23505',
      message = 'This admission number is already registered. Sign in or contact the department.',
      detail = 'Signup was rolled back; no auth user or profile was created.';
  end if;
  raise exception using
    errcode = '23505',
    message = 'USN is already registered to another account.',
    detail = 'Signup was rolled back; no auth user or profile was created.',
    hint = 'Sign in with the existing account or ask an administrator to review the USN collision.';
```

The admission message must not echo the identifier. Both paths abort the `auth.users` insert.

**C. `link_student_usn(p_usn text)`**

```sql
create or replace function public.link_student_usn(p_usn text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_usn text;
  v_profile public.profiles%rowtype;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'Sign in required.';
  end if;

  v_usn := upper(btrim(coalesce(p_usn, '')));
  if v_usn !~ '^4UB[0-9]{2}CS[0-9]{1,3}$' then
    raise exception using
      errcode = '22023',
      message = 'Enter a valid USN. Expected format: 4UB24CS045';
  end if;

  select * into v_profile
  from public.profiles
  where id = v_actor
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Profile not found.';
  end if;
  if v_profile.member_type is distinct from 'student' then
    raise exception using
      errcode = '42501',
      message = 'Only students can link a USN.';
  end if;
  if v_profile.usn is not null then
    raise exception using
      errcode = '22023',
      message = 'A USN is already linked to this account.';
  end if;

  perform set_config('ucc.usn_link', 'on', true);
  begin
    update public.profiles
    set usn = v_usn,
        updated_at = timezone('utc'::text, now())
    where id = v_actor;
  exception when unique_violation then
    perform set_config('ucc.usn_link', '', true);
    raise exception using
      errcode = '23505',
      message = 'This USN is already registered. Sign in or contact the administrator.';
  end;
  perform set_config('ucc.usn_link', '', true);
end;
$$;

revoke all on function public.link_student_usn(text) from public;
revoke all on function public.link_student_usn(text) from anon;
grant execute on function public.link_student_usn(text) to authenticated;
```

It updates only `usn`; it does not re-derive `year`.

**D. Replacement `protect_profile_privileges()`**

Copy the canonical body from `2026102208_single_admin_succession.sql` (lines 159–203). Keep the `ucc.admin_transition` branch and the admin early return. Add a narrow branch after the admin return and before the pending-faculty branch:

```sql
if coalesce(current_setting('ucc.usn_link', true), '') = 'on'
   and old.member_type = 'student'
   and old.usn is null
   and new.usn is not null then
  new.role := old.role;
  new.faculty_status := old.faculty_status;
  new.employee_id := old.employee_id;
  new.designation := old.designation;
  new.member_type := old.member_type;
  new.graduation_year := old.graduation_year;
  return new;
end if;
```

Only a null → non-null USN for a student is allowed. Every other protected field is restored. The GUC is set only inside `link_student_usn`; a browser session cannot set it, so direct client updates to `profiles.usn` remain reverted.

**E. Comments**

Add `comment on table`, `comment on function public.link_student_usn`, and a comment on the replacement trigger function. End with `notify pgrst, 'reload schema';`.

**Do not apply this migration to the linked production project.** It is written and rehearsed locally only.

### Step 6.2 — SQL tests

Create `supabase/test-admission-numbers.sql` in a transaction that rolls back, following the auth-user fixture style in `supabase/test-faculty-onboarding.sql`. Cover:

1. Student intent, year 1, admission number only → profile created, no USN, one admission row.
2. The same admission number with different case/whitespace → 23505 with the admission message.
3. Invalid format (`AB`, `A B`, 25 chars, leading `-`) → 23514.
4. Student intent, year 2, no USN → 23514.
5. Student intent, year 1, neither USN nor admission → 23514.
6. Student intent, year 3, valid USN → succeeds.
7. `link_student_usn` on a student with null USN → sets the normalized USN once.
8. A second `link_student_usn` call → error; USN unchanged.
9. `link_student_usn` with a USN already held by another student → generic duplicate error.
10. `link_student_usn` as alumni → 42501.
11. Direct `update public.profiles set usn = ...` as an authenticated student → reverted by the trigger.
12. RLS: owner selects their admission row; another student selects zero; admin selects the row.

If Docker and the Supabase CLI are available, run the existing rehearsal first:

```bash
bash supabase/local-rehearsal/run-rehearsal.sh
```

Then run the new test file against the same disposable database. If the harness tears the database down before the test can run, add the test invocation to the harness only if `supabase/local-rehearsal/run-rehearsal.sh` has no pre-existing uncommitted changes; otherwise run a separate disposable PostgreSQL/Supabase container and document the exact command. Never point it at production.

### Step 6.3 — Web/mobile validation (test first)

In `lib/validation.ts` and `apps/mobile/src/lib/validation.ts` add:

```ts
export const ADMISSION_NUMBER_PATTERN = /^[A-Z0-9][A-Z0-9/-]{2,22}[A-Z0-9]$/

export function normalizeAdmissionNumber(value: string): string {
  return value.trim().toUpperCase()
}

export function validateAdmissionNumber(value: string): boolean {
  return ADMISSION_NUMBER_PATTERN.test(normalizeAdmissionNumber(value))
}
```

Change `validateStudentSignup` input to:

```ts
{
  name: string
  email: string
  password: string
  confirmPassword: string
  usn: string
  admissionNumber?: string
  year: number
  section?: string
}
```

Rules, in order:

1. Name, email, password, confirm password as today.
2. If `usn` is non-empty and invalid → `Invalid USN. Expected format: 4UB24CS045`.
3. If `admissionNumber` is non-empty and invalid → `Enter a valid admission number. Use 4-24 letters, digits, hyphens or slashes.`
4. If `year` is not 1–4 → `Select a valid academic year.`
5. If `year === 1` and both `usn` and `admissionNumber` are empty → `First-year students need either a USN or an admission number.`
6. If `year !== 1` and `usn` is empty → `A USN is required for students in years 2-4.`
7. Years 2–4 ignore `admissionNumber` for validity, but a non-empty invalid value still fails rule 3 so a tampered field is not silently accepted.

Add tests for every branch, including:
- year 1 admission only passes;
- year 1 neither fails;
- year 2 without USN fails even with an admission number;
- invalid USN with a valid admission number fails;
- invalid admission number fails;
- normalization trims and uppercases;
- 4 and 24 characters pass; 3 and 25 fail; leading/trailing `-` fail.

Run and confirm the new tests fail before changing the implementation.

### Step 6.4 — Web student signup

In `components/auth/StudentSignUpForm.tsx`:

- Add `const [admissionNumber, setAdmissionNumber] = useState('')`.
- Update `handleUsnChange`:
  - normalize as today;
  - if the USN becomes empty, force `year = 1` and clear the admission field;
  - if a valid USN is detected, keep the detected year and clear the admission field.
- Render the year select with `disabled={!usn.trim()}` while the USN is empty. Show a hint: “Add a USN to change your year.” The only selectable value while empty is 1st year.
- Render the admission-number field only when `year === 1 && !usn.trim()`:
  - label “Admission number”;
  - placeholder “e.g. ADM-2026-001”;
  - hint “For first-year students who do not have a USN yet. 4-24 letters, digits, hyphens or slashes.”;
  - `maxLength={24}`, `autoCapitalize="characters"`.
- Pass `admissionNumber` to `validateStudentSignup`.
- In the `signUp` metadata, include `admission_number` only when `!formattedUsn && year === 1 && admissionNumber.trim()`.
- Keep the existing USN availability probe. Do not add an admission-number lookup.
- Map server errors:
  - message containing `admission number` → `This admission number is already registered. Sign in or contact the department.`
  - existing USN/duplicate mapping stays.
- Do not log the admission number or USN. Remove any `console.error` that could include them; the existing USN probe error log is generic and must not print the value.

### Step 6.5 — Mobile student signup

In `apps/mobile/src/app/sign-up.tsx`:

- Add `admissionNumber` state.
- In `updateUsn`, mirror the web behavior: empty USN forces year 1 and clears admission; valid USN clears admission and keeps the detected year.
- Render the admission field only for `role === 'student' && year === 1 && !usn.trim()`.
- Lock the year control to 1st year while the USN is empty. If the current UI uses a chip/select, disable the other options and show the hint.
- Pass `admissionNumber` to `validateStudentSignup`.
- Include `admission_number` in metadata only when applicable.
- Extend `friendlySignupError` to map the admission duplicate message. Keep the USN messages.
- Do not log the admission number.

### Step 6.6 — Web USN linking and admission display

In `contexts/CommunityContext.tsx`:

- Add to the interface:

```ts
linkStudentUsn: (usn: string) => Promise<{ ok: boolean; error?: string }>
```

- Implement:
  - reject empty/invalid input locally with the same USN message;
  - call `supabase.rpc('link_student_usn', { p_usn: usn.trim().toUpperCase() })`;
  - on error, map duplicate/format/member-type messages without echoing the USN;
  - on success, toast `USN linked`, `await refreshProfile()`, and return `{ ok: true }`.
- Expose it in the provider value.

In `components/ProfileModal.tsx`:

- For self-editing (`isEditingSelf`) and `profile.member_type === 'student'`:
  - if `profile.usn` is null, show an “Add your USN” field and button;
  - if `profile.usn` exists, show it read-only.
- On link success, clear the field; the refreshed profile hides the control.
- For the owner only, query `student_admission_numbers.select('admission_number').eq('profile_id', currentUser.id).maybeSingle()` and show “Admission number on file” read-only when present. If the query errors because the migration is not applied (`42P01` / “does not exist”), hide the row; do not log the value.
- Never show another member’s admission number.

### Step 6.7 — Mobile USN linking and admission display

In `apps/mobile/src/app/profile/edit.tsx`:

- For `profile.member_type === 'student'` and `profile.usn == null`, show an “Add your USN” `TextField` and button.
- Call `supabase.rpc('link_student_usn', { p_usn: normalized })`, then `await refreshProfile()`.
- Show errors in the existing `StatusBanner`/error text. Do not echo the USN.
- For the owner, query `student_admission_numbers` and show “Admission number on file” read-only. Hide on a missing-table error.
- Keep the existing identity text and avatar note.

### Step 6.8 — Component tests

Web `ProfileModal.test.tsx`:

- A student with `usn: null` sees “Add your USN”; a student with a USN does not.
- An alumni/faculty profile does not see the control.
- A successful RPC call refreshes the profile and clears the field.
- The admission-number-on-file row appears only for the owner and only when the query returns a row.

Mobile tests: pure validation and helper tests are required; UI tests are optional if the existing setup cannot render the screen.

### Step 6.9 — Acceptance

```bash
npm test -- lib/validation.test.ts --reporter=dot
npm test -- components/ProfileModal.test.tsx --reporter=dot
cd apps/mobile && npm test -- src/lib/validation.test.ts --reporter=dot
npm run typecheck
cd apps/mobile && npm run typecheck
```

- First-year signup with admission number only succeeds **after** the migration is applied locally.
- Years 2–4 without a USN fail in the client and in the trigger.
- Duplicate admission numbers and duplicate USNs produce distinct generic messages and roll back the auth user.
- USN linking is one-time and does not change `year`.
- Direct client USN updates remain reverted.
- No admission number appears in logs, public profile queries, or another member’s UI.

**Deployment-order note:** the migration must be applied before the updated client is deployed. Until then, first-year signup without a USN will fail at the trigger. This plan does not apply it.

---

## 8. Task 7 — Notification popup on web and Android

### Goal

Show one dismissible notification popup at launch and when the app/tab returns to the foreground, with View and Dismiss actions. Reuse the existing `notifications` table and 24-hour retention. Do not add OneSignal, email, web-push, or iOS behavior.

### Files

| File | Change |
|---|---|
| `lib/logic/notifications.ts` | New shared visibility/safe-link/candidate helpers |
| `lib/logic/notifications.test.ts` | Pure tests |
| `contexts/CommunityContext.tsx` | Use the shared visibility helper in list/realtime |
| `components/NotificationPopup.tsx` | New web popup |
| `components/NotificationPopup.test.tsx` | Web behavior tests |
| `components/AppShell.tsx` | Mount the popup |
| `apps/mobile/src/lib/notification-popup.ts` | New mobile selection/safe-href helpers |
| `apps/mobile/src/lib/notification-popup.test.ts` | Pure tests |
| `apps/mobile/src/lib/notification-route.ts` | `isSafeInternalPath` helper |
| `apps/mobile/src/lib/notification-route.test.ts` | Safe-link tests |
| `apps/mobile/src/components/notification-popup.tsx` | New mobile modal |
| `apps/mobile/src/app/_layout.tsx` | Mount popup; move unread provider to root |
| `apps/mobile/src/app/(tabs)/_layout.tsx` | Remove the provider (moved to root) |

### Step 7.1 — Web pure helpers (test first)

Create `lib/logic/notifications.ts`:

```ts
export const HIDDEN_NOTIFICATION_TYPES = [
  'message',
  'connection_request',
  'connection_accepted',
] as const

export function isNotificationVisible(type: unknown): boolean {
  return typeof type === 'string' && type.length > 0
    && !(HIDDEN_NOTIFICATION_TYPES as readonly string[]).includes(type)
}

export function filterVisibleNotifications<T extends { type: string }>(rows: T[]): T[] {
  return rows.filter(row => isNotificationVisible(row.type))
}

export function safeNotificationLink(link: string | null | undefined): string {
  if (!link) return '/'
  if (!link.startsWith('/')) return '/'
  if (link.startsWith('//') || link.startsWith('/\\')) return '/'
  if (link.includes('\\')) return '/'
  return link
}

export function selectPopupNotification<
  T extends { id: string; type: string; read: boolean; created_at: string }
>(rows: T[], seenIds: ReadonlySet<string>): T | null {
  const eligible = rows
    .filter(row => !row.read && isNotificationVisible(row.type) && !seenIds.has(row.id))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
  return eligible[0] ?? null
}
```

Tests:

- `message`, `connection_request`, `connection_accepted` are hidden; `comment`, `announcement`, `event_published` are visible.
- Safe links: `/`, `/announcements`, `/post/abc` pass; `//evil`, `/\evil`, `https://evil`, `javascript:`, `/a\b`, empty, null fall back to `/`.
- Candidate selection picks the newest unread visible row not in the seen set; read rows and seen ids are skipped.
- Empty input returns `null`.

### Step 7.2 — Context alignment

In `contexts/CommunityContext.tsx`:

- Delete the local `filterVisibleNotifications` and import `filterVisibleNotifications` / `isNotificationVisible` from `@/lib/logic/notifications`.
- In the realtime INSERT handler, use `if (!isNotificationVisible(incoming.type)) return` instead of the message-only check.
- Keep the 40-row fetch and the bell behavior unchanged.
- Do not add a popup state to the context; the popup owns its session seen set.

### Step 7.3 — Web popup

Create `components/NotificationPopup.tsx`:

- `'use client'`.
- Use `useCommunity()` for `currentUser`, `notifications`, and `markNotificationAsRead`; use `useRouter()`.
- State: `candidate: Notification | null`.
- Refs: `seenRef = useRef(new Set<string>())`, `checkRequestedRef = useRef(false)`.
- On mount: set `checkRequestedRef.current = true` and bump a small `checkTick` state.
- On `document.visibilitychange` → visible: set `checkRequestedRef.current = true` and bump `checkTick`.
- In an effect keyed by `notifications`, `currentUser`, and `checkTick`:
  - return if there is no current user or no check was requested;
  - consume the flag once;
  - choose `selectPopupNotification(notifications, seenRef.current)`;
  - set the candidate if one exists.
- On sign-out (`currentUser` becomes null): clear `seenRef`, close the candidate, reset the flag.
- Render nothing when there is no candidate.
- Render a fixed, non-blocking card at the bottom-right:
  - `role="status"`, `aria-live="polite"`;
  - title, optional body, “View” and “Dismiss” buttons;
  - no backdrop and no focus trap.
- Dismiss: add the id to `seenRef`, close. Do **not** mark read.
- View: `markNotificationAsRead(id)`, add the id to `seenRef`, close, `router.push(safeNotificationLink(candidate.link))`.
- If the candidate is already read (for example, the bell marked it), close it without marking again.
- Keep the bell dropdown unchanged.

Mount `<NotificationPopup />` in `components/AppShell.tsx` next to the global modals.

### Step 7.4 — Mobile pure helpers

Create `apps/mobile/src/lib/notification-popup.ts`:

```ts
import { isNotificationVisible } from './notifications'
import { isSafeInternalPath, routeForNotification } from './notification-route'
import type { Notification } from './types'

export function selectPopupNotification(
  rows: Notification[],
  seenIds: ReadonlySet<string>
): Notification | null {
  const eligible = rows
    .filter(row => !row.read && isNotificationVisible(row.type) && !seenIds.has(row.id))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
  return eligible[0] ?? null
}

export function popupHref(notification: Notification) {
  const safeLink = isSafeInternalPath(notification.link) ? notification.link : null
  return routeForNotification({ ...notification, link: safeLink })
}
```

In `apps/mobile/src/lib/notification-route.ts` add:

```ts
export function isSafeInternalPath(link: string | null | undefined): boolean {
  if (!link) return false
  if (!link.startsWith('/')) return false
  if (link.startsWith('//') || link.startsWith('/\\')) return false
  if (link.includes('\\')) return false
  return true
}
```

Tests:

- Selection is newest-first, skips read/hidden/seen.
- `isSafeInternalPath` accepts `/`, `/announcements`, `/post/abc`; rejects `//evil`, `/\evil`, `https://evil`, `javascript:`, `/a\b`, null.
- `popupHref` returns an internal Expo route for a valid notification; an unsafe link is stripped and the fallback route is used.

### Step 7.5 — Mobile popup and provider placement

Move `UnreadNotificationsProvider` from `apps/mobile/src/app/(tabs)/_layout.tsx` to `apps/mobile/src/app/_layout.tsx` so the root popup and the tab badge share one counter:

- In `_layout.tsx`, wrap `<RootNavigator />` with `<UnreadNotificationsProvider>` inside `AuthProvider`.
- Remove the provider import/wrapper from `(tabs)/_layout.tsx`; keep `useUnreadNotifications` usage there.

Create `apps/mobile/src/components/notification-popup.tsx`:

- Use `useAuth()` for `session`/`profile`, `useUnreadNotifications()` for `refresh`, and `supabase`.
- Refs: `seenRef`, `checkRequestedRef`, `activeRef`.
- State: `candidate`, `checkTick`.
- On mount and on `AppState` → `active`: set `checkRequestedRef.current = true` and bump `checkTick`. Track `activeRef` so a background app never opens a modal.
- In an effect keyed by `session?.user.id` and `checkTick`:
  - return if there is no user or the app is not active;
  - consume the flag;
  - query:
    ```ts
    .from('notifications')
    .select('*')
    .eq('user_id', userId)
    .eq('read', false)
    .not('type', 'in', HIDDEN_NOTIFICATION_FILTER)
    .order('created_at', { ascending: false })
    .limit(20)
    ```
  - select with `selectPopupNotification(rows, seenRef.current)`;
  - set the candidate if one exists.
- On user change/sign-out: clear `seenRef`, close the candidate, reset the flag.
- Render a React Native `Modal` (`transparent`, `animationType="fade"`, `onRequestClose={dismiss}`):
  - backdrop `Pressable` that dismisses;
  - inner card with title, body, “View”, “Dismiss”;
  - the inner card must stop propagation so a tap inside does not dismiss.
- Dismiss: add id to `seenRef`, close. Do not update `read`.
- View:
  - if unread, `supabase.from('notifications').update({ read: true }).eq('id', id)`;
  - `await unread.refresh()`;
  - add id to `seenRef`, close;
  - `router.push(popupHref(notification))`.
- No realtime subscription in the popup; the Alerts tab keeps its existing INSERT/DELETE handling.

Mount in `apps/mobile/src/app/_layout.tsx` inside the signed-in branch, above the navigator:

```tsx
<>
  <Stack ...>...</Stack>
  {session ? <NotificationPopup /> : null}
</>
```

Do not add any OneSignal call, permission prompt, email, web-push, or iOS branch.

### Step 7.6 — Tests and acceptance

```bash
npm test -- lib/logic/notifications.test.ts --reporter=dot
npm test -- components/NotificationPopup.test.tsx --reporter=dot
cd apps/mobile && npm test -- src/lib/notification-popup.test.ts --reporter=dot
cd apps/mobile && npm test -- src/lib/notification-route.test.ts --reporter=dot
```

Web component tests:

- The popup shows the newest unread visible notification once.
- Dismiss closes it and does not call `markNotificationAsRead`.
- View calls `markNotificationAsRead` once and navigates to the safe link.
- An unsafe link navigates to `/`.
- A second foreground with the same notification does not show it again; a newer notification does.
- Signing out clears the popup.

Acceptance:

- Web popup is fixed and non-blocking; the bell still works.
- Mobile popup appears on cold launch and foreground, including detail screens.
- No popup loop: the check flag is consumed once per launch/foreground, and the seen set is keyed by id.
- The 24-hour retention job remains the only deletion mechanism.
- No OneSignal, email, web-push, or iOS behavior changes.

---

## 9. Task 8 — Verification and implementation report

### 8.1 — Automated checks

Run from the repository root unless noted:

```bash
npm test -- --reporter=dot
npm run typecheck
npm run lint
```

```bash
cd apps/mobile
npm test -- --reporter=dot
npm run typecheck
npm run lint
```

Android:

```bash
cd apps/mobile/android
./gradlew assembleDebug
```

If the Gradle build cannot run, record the exact blocker (missing SDK, network, JDK, etc.) and do not claim success. `apps/mobile/android/gradlew` is present.

SQL rehearsal, only if Docker and the Supabase CLI are available:

```bash
bash supabase/local-rehearsal/run-rehearsal.sh
```

Then run `supabase/test-admission-numbers.sql` against the disposable database. If the harness is unavailable, report that the migration was reviewed but not executed, and list the exact commands the operator can run later. Do not connect to production.

### 8.2 — Manual smoke checklist

Use a local or disposable environment only:

- **Pins:** web feed loads existing pins from `post_id`; countdown ticks; at expiry the banner hides and the pin list refreshes; a fourth pin shows the cap message; Unpin works for faculty/admin.
- **Announcement delete:** author deletes with confirmation; admin deletes another author’s announcement; a student sees no control; the row disappears; a non-R2 image URL is skipped; an R2 failure still removes the row.
- **Event delete:** host sees Delete next to Edit; non-host does not; cancel does nothing; delete removes the event and RSVPs cascade.
- **Admin handover:** nominate an eligible approved faculty member; self and ineligible nominees are unavailable; a second nomination is blocked; the nominee sees the banner on a non-admin page; Accept transfers the role and demotes the former admin atomically; Decline leaves the admin unchanged; Cancel clears the pending nomination; audit rows appear.
- **Academic year:** student edits 1–4 and the directory/event targeting reflects it; alumni/faculty see no control.
- **Admission number:** first-year signup with admission only succeeds after migration; duplicate and invalid fail with generic messages; years 2–4 without USN fail; USN linking succeeds once; direct update is reverted.
- **Notification popup:** web and Android show one unread notification at launch/foreground; Dismiss does not mark read; View marks read and navigates; the bell/Alerts tab remains correct; signing out closes it.

### 8.3 — Final report template

Write a short report (in the response, not a new file unless asked) with:

1. **Files changed** — grouped by feature.
2. **Verification evidence** — exact commands and result counts; include the Android build result and SQL rehearsal result or blocker.
3. **Behavior changed** — pins, deletion, handover, year, admission, popup.
4. **Limitations** — `profiles.year` is UI-only; migration not applied to production; R2 cleanup is best-effort; popup seen state is per session; no production end-to-end proof.
5. **Not done** — no commit, push, deploy, production SQL, dependency change, or unrelated refactor.
6. **Deployment order** — apply `2026102502` before deploying the updated web/mobile clients; then deploy web, then build/distribute Android.

---

## 10. File inventory

### New files

- `docs/superpowers/plans/2026-10-25-ucc2-repairs-plan.md` (this plan)
- `lib/r2.ts`
- `app/api/announcements/[id]/route.ts`
- `app/api/announcements/[id]/route.test.ts`
- `components/EventCard.test.tsx`
- `components/AdminHandover.tsx`
- `components/AdminHandover.test.tsx`
- `components/AdminNominationBanner.tsx`
- `components/AdminNominationBanner.test.tsx`
- `lib/logic/notifications.ts`
- `lib/logic/notifications.test.ts`
- `components/NotificationPopup.tsx`
- `components/NotificationPopup.test.tsx`
- `supabase/migrations/2026102502_admission_numbers_and_usn_linking.sql`
- `supabase/test-admission-numbers.sql`
- `apps/mobile/src/lib/admin.ts`
- `apps/mobile/src/lib/admin.test.ts`
- `apps/mobile/src/lib/notification-popup.ts`
- `apps/mobile/src/lib/notification-popup.test.ts`
- `apps/mobile/src/lib/validation.test.ts`
- `apps/mobile/src/components/admin-handover.tsx`
- `apps/mobile/src/components/admin-nomination-banner.tsx`
- `apps/mobile/src/components/notification-popup.tsx`

### Modified files

- `lib/logic/discussionPins.ts`
- `lib/logic/discussionPins.test.ts`
- `contexts/CommunityContext.tsx`
- `components/PostCard.tsx`
- `components/PostCard.test.tsx`
- `lib/logic/announcements.ts`
- `lib/logic/announcements.test.ts`
- `components/AnnouncementCard.tsx`
- `components/AnnouncementCard.test.tsx`
- `app/faculty/dashboard/page.tsx`
- `app/admin/page.tsx`
- `components/AppShell.tsx`
- `components/EventCard.tsx`
- `lib/validation.ts`
- `lib/validation.test.ts`
- `components/ProfileModal.tsx`
- `components/ProfileModal.test.tsx`
- `components/auth/StudentSignUpForm.tsx`
- `app/api/announcements/upload/route.ts`
- `apps/mobile/src/lib/feed-logic.ts`
- `apps/mobile/src/lib/feed-logic.test.ts`
- `apps/mobile/src/components/post-card.tsx`
- `apps/mobile/src/lib/use-community-feed.ts`
- `apps/mobile/src/app/(tabs)/index.tsx`
- `apps/mobile/src/components/announcement-card.tsx`
- `apps/mobile/src/app/announcements/index.tsx`
- `apps/mobile/src/app/faculty/dashboard.tsx`
- `apps/mobile/src/app/event/[id].tsx`
- `apps/mobile/src/app/admin/index.tsx`
- `apps/mobile/src/app/_layout.tsx`
- `apps/mobile/src/app/(tabs)/_layout.tsx`
- `apps/mobile/src/lib/validation.ts`
- `apps/mobile/src/app/sign-up.tsx`
- `apps/mobile/src/app/profile/edit.tsx`
- `apps/mobile/src/lib/notification-route.ts`
- `apps/mobile/src/lib/notification-route.test.ts`

If implementation discovers an additional file is required, add it to this inventory before editing and confirm it is not pre-existing user work.

---

## 11. Verification matrix

| Requirement | Evidence |
|---|---|
| Pin query uses `post_id` | `discussionPins.test.ts`, `PostCard.test.tsx`, diff |
| Live pin countdown / expiry | Web and mobile pure tests + component tests |
| Max 3 pins / 7-day expiry | Existing RPC untouched; cap UI test; no client expiry write |
| Announcement delete owner/admin | Route tests, card tests, RLS unchanged |
| Announcement image cleanup | Route tests for deleted/failed/skipped/missing config |
| Event delete host only | EventCard tests, RLS unchanged |
| Admin handover | RPC contract tests, no direct role writes |
| Academic year 1–4 | Validation tests, ProfileModal tests, mobile typecheck |
| Admission number signup | Validation tests, SQL tests (local), route/trigger review |
| USN linking one-time | SQL tests (local), ProfileModal tests |
| Notification popup | Pure tests + web component tests + mobile typecheck |
| RLS/server authorization | No policy weakened; route and RPC checks reviewed |
| Web checks | `npm test`, `npm run typecheck`, `npm run lint` |
| Mobile checks | `npm test`, `npm run typecheck`, `npm run lint` |
| Android build | `./gradlew assembleDebug` |
| Migration safety | Local rehearsal; not applied to production |

---

## 12. Stop conditions

Stop and report instead of guessing if any of these occur:

- A required change would touch a file outside the inventory and that file has pre-existing uncommitted changes.
- The pin query or mapper reveals a different schema than `post_id`.
- The migration would require a destructive statement, a backfill, or a change to USN uniqueness.
- An RLS policy would need to be weakened to make a client flow work.
- The admin RPC contract differs from `2026102208` (for example, a missing cancel/decline RPC).
- The notification table lacks the columns the popup needs (`read`, `link`, `type`, `created_at`).
- The Android build cannot run because of an environment blocker; report the exact error rather than claiming success.
- The SQL rehearsal would connect to the linked production project.

No implementation starts until the plan is accepted.
