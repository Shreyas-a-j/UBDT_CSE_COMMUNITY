# Android Push Notifications — Architecture & Change Record

**Date:** 2026-10-24 · **Scope:** Android-only OneSignal push for newly
published announcements, newly published events, and a showcase entering the
top two; 24-hour in-app notification retention · **Status:** push is implemented
and verified end to end against the hosted development project and a physical
Android device on 2026-10-24. **Retention migration, worker version 5, and the
15-minute `pg_cron` cleanup are deployed and verified on the hosted development
project as of 2026-10-25, including a real scheduled deletion.** Production
rollout and the periodic retry sweep also remain pending.

Related documents:

- **Deployment, OneSignal/FCM setup, email shutdown and device checklist:**
  `docs/android-push-notifications-deployment.md`
- Historical email design (now disabled):
  `docs/notifications-publish-fanout-design.md`
- Migration order: `docs/migration-dependency-order.md`

---

## 1. Intent and boundaries

Members who have installed the Android app and opted in receive one push when:

1. a faculty announcement is published;
2. an event is published;
3. their own showcase newly enters the top two.

Binding boundaries:

- **Android only.** No web push, iOS push, or email delivery.
- **Server-side only.** The app never calls OneSignal's send API and never
  contains the REST API key or the webhook secret.
- **Exactly one push per publication per recipient.** Edits are UPDATEs and
  never publish.
- **Showcase:** notify the owner only, once per distinct top-two tenure.
  Refreshes, ranking recalculation, and continuing membership are silent; a
  genuine leave and later re-entry produces exactly one new notification.
- **In-app notifications are unchanged for 24 hours.** The bell, mobile
  notifications tab, realtime subscription, website routes, and unread state
  keep working. A scheduled cleanup deletes rows older than 24 hours; the
  Android push is delivered from the outbox and is not affected.
- **Deleting an in-app row never re-sends a push.** A durable dedupe ledger
  outlives the notification, and terminal outbox logs are detached instead of
  cascaded away.
- **Email is disabled for new work.** Historical email rows are retained.

## 2. End-to-end architecture

```
announcement INSERT ─┐
event INSERT ────────┤ AFTER INSERT trigger (same transaction as publish)
                     ▼
          public.on_publish_notification()
                     │
                     ├─ publish_recipient_ids(publisher)
                     │    confirmed email, not banned, not deleted, not publisher
                     │
                     ├─ public.notifications            (one per recipient,
                     │    dedupe_key = publish:<kind>:<id>)
                     │
                     └─ public.notification_push_outbox (one per notification,
                          notification_id UNIQUE, only when push_enabled)

showcase post/upvote INSERT/UPDATE/DELETE
                     ▼
          public.on_showcase_ranking_change()
                     ▼
          public.recompute_showcase_top2()   (advisory-lock serialized)
                     │  ranking: type='showcase', >=1 upvote,
                     │           upvotes desc, created_at desc, id asc, limit 2
                     ├─ close active tenures that left the top two
                     ├─ open showcase_top_entries(entry_seq = max + 1)
                     ├─ notifications row for the owner
                     │    dedupe_key = showcase_top2:<post>:<entry_seq>
                     └─ notification_push_outbox row (when push_enabled)

notification_push_outbox
                     │  INSERT webhook (x-internal-secret) and/or scheduled POST
                     ▼
        send-push-notifications Edge Function (Deno)
                     ├─ fail closed unless PUSH_HOOK_SECRET matches
                     ├─ claim pending/failed/stale-sending rows via CAS
                     ├─ re-check recipient account + push_enabled
                     ├─ OneSignal POST /notifications
                     │    include_aliases.external_id = Supabase user UUID
                     │    target_channel = "push"
                     │    idempotency_key = push-outbox row UUID
                     └─ settle: sent | skipped | failed (retry/terminal)
```

### 2.1 Publish fan-out

`public.on_publish_notification()` is a `SECURITY DEFINER` trigger function on
`announcements` and `events`. It:

- derives recipients only from trusted database state
  (`publish_recipient_ids`), never from client input;
- writes the in-app notification first, so a notification failure rejects the
  publication loudly rather than creating a half-fanned-out publish;
- looks up the inserted notification and writes one
  `notification_push_outbox` row with `ON CONFLICT (notification_id) DO
  NOTHING`;
- writes no email-outbox row and does not reference the email table.

The in-app row and push work item are committed in the same transaction as the
publish. A rollback leaves neither.

### 2.2 Showcase top-two state

`public.showcase_top_entries` is the durable source of truth for "has this
project ever been announced in this tenure?":

| Column | Meaning |
|---|---|
| `post_id`, `entry_seq` | Per-post tenure sequence; unique together |
| `entered_at`, `left_at` | Tenure window; at most one open row per post |
| `notified_at`, `notification_id` | Evidence that this tenure was announced |

Rules:

- Top two = showcases with **at least one upvote**, ordered by
  `count(upvotes) DESC, created_at DESC, id ASC`, limit 2.
- A post already holding an open tenure is not re-announced.
- A post that leaves the top two gets `left_at` set.
- A later re-entry starts `entry_seq + 1`, producing a new dedupe key and
  exactly one new push.
- The whole diff runs under a transaction-scoped advisory lock so concurrent
  post/upvote writes cannot compute two different rankings.
- The migration seeds the **already-current** top two with `notified_at` and no
  `notification_id`, so deploying does not blast historical entries.

### 2.3 Push outbox and worker

`public.notification_push_outbox` has one row per in-app notification
(`notification_id UNIQUE`). The column is nullable and `ON DELETE SET NULL` so
the 24-hour retention job can delete the in-app row while leaving the terminal
delivery log intact. The row UUID is the OneSignal idempotency key, which is
valid for 30 days at OneSignal.

Worker state machine:

```
pending ──claim──► sending ──► sent
   ▲                  │
   │                  ├──► skipped   (opt-out, deleted/banned, no subscribers)
   │                  └──► failed    (retryable, then terminal after 5 attempts)
   └──── retry schedule / stale claim reclaim (< 5 min old)
```

- Claims are atomic compare-and-set updates fenced on the previous status and
  time; two concurrent workers cannot settle the same row.
- A `sending` row older than five minutes is reclaimable after a crash.
- Retryable statuses (429, 5xx, network) use exponential backoff. Five failed
  attempts or a permanent 4xx parks the row `failed` roughly one year out for
  inspection.
- `401`/`403` aborts the sweep because every remaining send would fail the same
  way; rows return to `pending` with a 15-minute cooldown.
- OneSignal `200` with an empty message `id` means **zero subscribed devices**;
  the row becomes `skipped`, not retried forever.
- Opt-out, missing account, banned/deleted recipient, or a notification that no
  longer exists also ends `skipped`.

### 2.4 Mobile identity and permission

- The app initializes OneSignal **only on Android and only when
  `EXPO_PUBLIC_ONESIGNAL_APP_ID` is non-empty**.
- Identity is always the Supabase user UUID:
  `OneSignal.login(<uuid>)` after session restore/sign-in and
  `OneSignal.logout()` on sign-out. Account switching replaces the alias.
  No email address is ever registered with OneSignal.
- The SDK is initialized **before** any other native call, then the click
  listener is attached. OneSignal's native Android SDK queues cold-start opens
  and flushes them when a click listener subscribes, so this order preserves
  cold-start routing without calling `addNotificationClickListener()` before
  `initWithContext()`. The listener still buffers a cold-start click until
  Expo Router's root navigator is ready.
- Permission is requested only from a deliberate control in the mobile
  notifications tab (`requestPermission(false)`), never at startup.
- Denial is shown in-app with an **Open settings** action. A foreground
  re-check updates the card after the user changes the OS setting.

### 2.5 24-hour in-app retention

`public.notifications.created_at` is a `timestamptz`; the cutoff is
`now() - interval '24 hours'`, so session or server timezone settings cannot
move it. `public.cleanup_expired_notifications()` runs on `pg_cron` every 15
minutes and:

1. stamps `finished_at` on terminal `sent`/`skipped` rows and on `failed` rows
   parked beyond one day (including rows settled by the pre-retention worker);
2. deletes up to 1,000 expired notifications per batch, at most 10 batches per
   run, skipping any notification with non-terminal push work
   (`pending`, `sending`, or a retryable `failed`);
3. releases the matching dedupe-ledger keys, then separately releases orphaned
   ledger rows;
4. prunes terminal `sent`/`skipped` logs after 7 days, terminal `failed` logs
   after 30 days, and released dedupe keys after 30 days.

`notification_dedupe_ledger` is keyed by `(user_id, dedupe_key)` and is
server-only. A `BEFORE INSERT` guard on `notifications` writes the key before
the existing unique index sees it, so a duplicate is suppressed even after the
original row is gone. The ledger row survives deletion (`released_at` is set)
for 30 days, so a delayed trigger, a retry, or a recompute cannot create a
second push for the same publication.

The schedule is created by
`public.ensure_notification_retention_schedule()`. It checks for `pg_cron`,
then creates or updates the `ucc2-cleanup-expired-notifications` job. On a
Supabase project the extension must be enabled by the operator first; the
`postgres` role is not a superuser. Without the extension the helper returns
`false` and no automatic deletion occurs.

Realtime `DELETE` events are handled by the mobile Alerts tab and the web
`CommunityContext`, so an open client drops the expired row instead of keeping
a stale card.

## 3. Data-model and security invariants

- `notification_push_outbox` and `showcase_top_entries` have RLS enabled with
  **zero policies** and all privileges revoked from `anon` and
  `authenticated`. Only the service role and database functions touch them.
- `recompute_showcase_top2()`, `on_showcase_ranking_change()`, and
  `on_publish_notification()` are `SECURITY DEFINER` with
  `search_path = public`; EXECUTE is revoked from clients.
- `block_new_email_enqueue()` is likewise database-only.
- The OneSignal **App ID** is public and ships in the app. The **REST API key**
  and `PUSH_HOOK_SECRET` exist only as Supabase Edge Function secrets.
  `SUPABASE_SERVICE_ROLE_KEY` is injected by Supabase and is never bundled.
- The webhook fails closed when `PUSH_HOOK_SECRET` is unset or the header does
  not match.
- Existing `notifications` RLS is unchanged: a user can read/update only their
  own rows. The bell and mobile tab therefore keep their previous behavior.
- `notification_dedupe_ledger` is server-only: RLS enabled, zero policies, and
  all privileges revoked from `anon` and `authenticated`.
  `cleanup_expired_notifications()` and
  `ensure_notification_retention_schedule()` are `SECURITY DEFINER` with
  `search_path = public, pg_temp`; EXECUTE is revoked from clients.
- Retention touches only `public.notifications`, `notification_push_outbox`
  logs, and `notification_dedupe_ledger`. It never deletes events,
  announcements, posts, showcases, profiles, auth users, faculty applications,
  audit rows, or Storage objects.
- A notification with `pending`, `sending`, or retryable `failed` push work is
  never deleted. A deleted notification can never authorize another push
  because its dedupe key remains in the ledger for 30 days after release.

## 4. Email shutdown

Three layers make new email delivery impossible without deleting history:

1. **Enqueue stopped.** `2026102402` replaces the publish function with one
   that writes push, not email.
2. **Queue blocked.** `2026102403` installs a BEFORE INSERT trigger that raises
   `0A000` (`Email delivery is disabled for this deployment.`) for every new
   `notification_email_outbox` row.
3. **Worker tombstoned.** `send-notification-emails/index.ts` returns HTTP 410
   for every request, including correctly authenticated ones, and contains no
   provider client or secret.

`2026102403` also drops Database Webhook triggers pointing into
`supabase_functions`. Historical `notification_email_outbox` rows and the table
are retained; the migration adds a `HISTORICAL ONLY` table comment.

## 5. Changed files and migrations

### Migrations (apply in this order)

| Order | File | Purpose |
|---|---|---|
| 1 | `supabase/migrations/2026102401_android_push_schema.sql` | `showcase_top2` type, `push_enabled`, push outbox, showcase tenures, RLS/privilege lockout |
| 2 | `supabase/migrations/2026102402_android_push_triggers.sql` | publish fan-out writes push / never email; showcase ranking and tenure triggers; baseline top two seeded silent |
| 3 | `supabase/migrations/2026102403_disable_publish_email.sql` | drop email webhook triggers, hard-block new email enqueue, mark history, retain rows |
| 4 | `supabase/migrations/2026102501_notification_retention.sql` | 24-hour notification deletion, dedupe ledger, detachable outbox logs, `finished_at`, batched cleanup, `pg_cron` schedule helper |

The canonical consolidated `supabase/schema.sql` mirrors all four.

### Server

| File | Role |
|---|---|
| `supabase/functions/send-push-notifications/index.ts` | Worker: auth, claim, preference/account checks, settle, retries; nullable detached notification; `finished_at` terminal settlement |
| `.../policy.ts` | Pure classification: should-send, response/network outcome, retry schedule, terminal rules |
| `.../onesignal.ts` | OneSignal HTTP adapter and request body |
| `.../policy.test.ts`, `.../onesignal.test.ts` | Unit tests (15 total) |
| `supabase/functions/send-notification-emails/index.ts` | HTTP 410 tombstone; no provider path |
| `supabase/verify_schema.sql` | Sections 22.15–22.18 |
| `supabase/test-notification-fanout.sql` | 10 SQL scenarios, including showcase tenures |
| `supabase/test-notification-retention.sql` | 13 SQL scenarios: 24-hour boundary, batching, push-state safety, dedupe ledger, showcase tenure, timezone, RLS, schedule helper |
| `supabase/local-rehearsal/run-rehearsal.sh` | Canonical 28-migration list, fan-out and retention steps, residue counts |

### Mobile

| File | Role |
|---|---|
| `apps/mobile/app.json` | `onesignal-expo-plugin` (production mode, no NSE/location, icon/color) |
| `apps/mobile/src/lib/onesignal.ts` | Lazy Android SDK load, UUID login/logout, permission APIs, click buffering |
| `apps/mobile/src/lib/push-identity.ts` | Pure identity reconciliation state machine |
| `apps/mobile/src/lib/push-permission.ts` | Pure permission-state copy/state mapping |
| `apps/mobile/src/lib/notification-route.ts` | Shared in-app/push route mapper |
| `apps/mobile/src/app/_layout.tsx` | Init, session identity sync, sign-out, deferred click navigation |
| `apps/mobile/src/app/(tabs)/notifications.tsx` | Permission card, denial/settings flow, shared route mapper, Realtime INSERT and DELETE handling |
| `contexts/CommunityContext.tsx` | Web Realtime INSERT and DELETE handling for the bell |
| `apps/mobile/src/lib/types.ts` | `showcase_top2` notification type |
| Tests | `onesignal`-adjacent pure modules: 63 mobile tests total |

## 6. Verification results (2026-10-24)

| Check | Command | Result |
|---|---|---|
| SQL rehearsal | `bash supabase/local-rehearsal/run-rehearsal.sh` | **passed** — 27/27 migrations, ledger, verifier, Phase 1/faculty/pins/fan-out suites, negative controls, residue gate: 0 notifications, 0 push outbox rows, 0 showcase tenures; 11 seeded profiles/auth users and 27 ledger rows. The 27th file is the `update_updated_at_column()` backfill required by hand-managed deployments. |
| Fan-out SQL suite | inside rehearsal | **TEST 1–10 passed**, including showcase opt-out and re-entry |
| Push worker tests | Deno/Vitest command in §7 | **15/15 passed** |
| Mobile tests | `npm test` in `apps/mobile` | **63/63 passed** |
| Mobile typecheck | `npm run typecheck` | passed |
| Mobile lint | `npm run lint` | passed |
| Root/web tests | `npx vitest run` at repo root | **483/483 passed** (41 files) |
| Expo prebuild | `npx expo prebuild --platform android` | passed; OneSignal icon/color resources generated |
| Android build | `cd android && ./gradlew :app:assembleDebug` | **BUILD SUCCESSFUL** in 4m 37s; APK at `android/app/build/outputs/apk/debug/app-debug.apk` (237 MB, debug) |
| Native merge | `aapt2 dump permissions` / merged manifest | OneSignal permissions merged, including `POST_NOTIFICATIONS`, `C2D_MESSAGE`, `WAKE_LOCK`, FCM receive |
| Expo Doctor | `npx expo-doctor` | 19/20; 9 pre-existing Expo patch-version mismatches (no upgrade without approval) |
| Physical Android launch | `adb install`, launch, `adb logcat` | **passed** — `moto g64 5G`, Android 15; no redbox or `FATAL EXCEPTION` after the initialize-before-listener fix. The pre-fix build reproduced `Must call 'initWithContext' before use` at `OneSignalImp.kt:590`. |
| Android notification permission | package dump / OneSignal prefs | **granted** after a deliberate user tap on the app prompt; `PROMPTED_PERMISSION_POST_NOTIFICATIONS=true`, `USER_RESOLVED_PERMISSION=true` |
| OneSignal identity and subscription | on-device `OneSignal.xml` model store | `external_id = 1453fb81-995e-40c1-a210-c3425e0418a6`, exactly the signed-in Supabase UUID; subscription `type=PUSH`, `optedIn=true`, `status=SUBSCRIBED`, FCM address present (not printed) |
| Hosted schema preflight (before) | PostgREST probes against `brfxqnkafqunxauhtmar` | **failed** — `notifications.dedupe_key` missing, `notification_preferences`, `notification_email_outbox`, `notification_push_outbox`, and `showcase_top_entries` all absent; both Edge Functions returned `404 NOT_FOUND`. The publish fan-out did not exist on the hosted project, so the test publication created no in-app row and no outbox row. |
| Hosted schema remediation | `supabase db push --linked --include-all` | **applied** — the remote ledger was empty (hand-managed database). The 20 pre-existing migrations were marked applied, then `2026102202`, `2026102302`, `20261023025000`, `2026102303`, `2026102304`, `2026102401`, `2026102402`, and `2026102403` were applied. PostgREST now resolves the new columns and tables; the three privileged tables return `42501` to clients. |
| Hosted functions | `supabase functions deploy` | **deployed and configured** — `ONESIGNAL_APP_ID`, `ONESIGNAL_REST_API_KEY`, and `PUSH_HOOK_SECRET` set; `send-push-notifications` returns `401` without the hook secret and a clean `200` sweep with it; `send-notification-emails` returns `410` “Email delivery is disabled”. |
| Hosted webhook | `push-outbox-insert` trigger on `notification_push_outbox` | **created** — INSERT-only `supabase_functions.http_request` to `send-push-notifications`. A showcase insert invoked it and the worker sent 2.5 s later. The trigger was recreated during secret rotation and re-verified by a real send. |
| Real announcement push | physical publish from a second account | **passed** — “Push delivery test #2 — please ignore.” arrived in the Android tray; tapping opened the Announcements screen at the post. |
| Real event push | physical publish from a second account | **passed** — the event push arrived and tapping opened the event detail. |
| In-app fan-out and outbox | hosted queries | **passed** — Alerts showed exactly **2 unread · 2 total**; outbox had 24 rows = **2 sent** (Shreyas, `attempts=1`, provider message ID set) + **22 skipped** (“no subscribed Android devices matched this user”). |
| Edit silence | hosted `UPDATE` of the published event and announcement titles | **passed** — both titles changed, then reverted; notifications, outbox, and tenures stayed **24/24/2**. The mobile composer edits via `UPDATE`; the web app has no edit UI. |
| Showcase top-two entry | hosted ranking change on `chess_game` | **passed** — `chess_game` entered #2 at 4 votes, CareerHub’s active tenure closed at the same timestamp, and one `showcase_top2` notification was created for the owner (Shreyas). |
| Showcase push and tap | physical delivery | **passed** — “Your showcase is in the top two / chess_game” arrived; tapping opened the `chess_game` showcase detail; Alerts showed **3 unread · 3 total** after refresh. |
| Showcase outbox | hosted query | **passed** — `status='sent'`, `attempts=1`, provider message ID set, sent 2.5 s after insert; this also re-verified the rotated webhook secret. |
| Showcase idempotence | `recompute_showcase_top2()` + pull-to-refresh | **passed** — notification/outbox/tenure counts stayed **25/25/3**; no duplicate row or push. |
| Showcase restore | hosted transaction | **passed** — CareerHub back to 4 votes, `chess_game` back to 3; original tenures restored; **0** showcase notifications for the displaced owner; 0 pending outbox rows. |

Before the hosted remediation, a publish from a second faculty account appeared
in the web feed while the Android notifications query returned zero rows and
OneSignal's local table stayed empty. That was consistent with the missing
fan-out trigger, not a device or transport fault; the remediation above fixed it.

**Mocked vs real:** SQL, worker, and mobile tests are **mocked/local**; they
prove queue, state, routing, and provider-request shape. Device installation,
launch, permission, identity mapping, subscription, real event/announcement
delivery, tap routing, and showcase delivery are verified on the physical
Android device. Still unverified: a second recipient device, account switching
on the device, multi-device fan-out to one External ID, and a live UI edit. The
showcase entry and the edit were driven at the database layer (the exact
`upvotes` insert and `UPDATE` the app performs); the trigger, outbox, webhook,
worker, provider, and device path were real. The periodic retry sweep is not
configured — only the INSERT webhook invokes the worker.

### 6.1 Retention verification (2026-10-25, local-only)

| Check | Command | Result |
|---|---|---|
| Full SQL rehearsal | `bash supabase/local-rehearsal/run-rehearsal.sh` | **REHEARSAL PASSED** — 28/28 migrations, ledger check, verifier through 22.18, Phase 1/faculty/pins/fan-out/retention suites, negative controls, residue gate: 0 notifications, 0 push outbox, 0 dedupe-ledger, 0 showcase tenures; 11 profiles/auth users and 28 migration rows. Step 14 also loads `supabase/schema.sql` into a fresh database: core tables, dedupe trigger, retention functions, scan index, and detachable outbox FK all present. |
| Retention SQL suite | inside rehearsal | **TEST 1–13 passed**: 24-hour boundary and repeat safety, batching, pending/retryable push protection, terminal log windows, dedupe after deletion, showcase tenure, timezone invariance, unrelated content, RLS/client lockout, detached logs, terminal predicate, schedule-helper states |
| Push worker tests | `npx vitest run supabase/functions/send-push-notifications` | **15/15 passed** |
| Root/web tests | `npm test` at repo root | **484/484 passed** (41 files) |
| Root typecheck | `npm run typecheck` | passed |
| Mobile tests | `npm test` in `apps/mobile` | **63/63 passed** |
| Mobile typecheck | `npx tsc --noEmit` | passed |
| Mobile lint | `npm run lint` | passed |
| Root lint | `npm run lint` | 14 errors, all pre-existing `apps/mobile` `react-hooks/set-state-in-effect` findings plus two `require()` imports in `apps/mobile/eslint.config.js`; no new retention finding. The mobile-scoped lint run is clean. |

**Verified hosted (2026-10-25):** migration `2026102501` applied, remote
migration ledger matches local, `send-push-notifications` version 5 deployed
and returns `401` without the hook secret, and the post-apply structural check
passed (ledger, outbox FK/`finished_at`, trigger, RLS, functions, indexes).
`pg_cron` 1.6.4 is installed in `pg_catalog`; the
`ucc2-cleanup-expired-notifications` job is active on `*/15 * * * *`; runids 1
(12:15 UTC), 2 (12:30 UTC), and 3 (12:45 UTC) succeeded. Runid 1 deleted a
synthetic 25-hour-old notification; runid 2 deleted another expired row while a
23-hour-old row and an expired row with pending outbox work survived.

**Storage measurement:** `notifications` held 28 rows at 81,920 bytes total
(8,192 heap + 65,536 indexes) before the 12:15 run and 26 rows at the same
81,920 bytes after it. After the second fixture and cleanup, 25 real rows
occupied 114,688 bytes (16,384 heap + 65,536 indexes): the relation had grown
for the fixture inserts and did not shrink when rows were deleted. Deleting
rows does not return relation pages without `VACUUM`/repack, so **no storage
reclamation is claimed**. Local SQL tests prove the retention behavior against
a disposable PostgreSQL 16 instance; the hosted run proof above covers the
scheduler path.

**Secret handling:** during hosted verification a diagnostic query printed the
webhook header value. `PUSH_HOOK_SECRET` was rotated, the function secret
updated, and the `push-outbox-insert` trigger recreated with the new value. A
real showcase push sent afterward proves the new secret is active; the old
value is invalid.

## 7. Running the automated checks

```bash
# database (disposable Docker; never touches a hosted project)
bash supabase/local-rehearsal/run-rehearsal.sh

# push worker (run from the repository root)
npx vitest run supabase/functions/send-push-notifications

# mobile
cd apps/mobile
npm test
npm run typecheck
npm run lint

# native compile
npx expo prebuild --platform android --no-install
cd android && ./gradlew :app:assembleDebug
```

## 8. Known limits and non-goals

- No iOS or web push.
- No push preferences UI beyond the OS permission card; the database
  `push_enabled` flag is default-on and can be changed via the user's own row.
- No digest, marketing, or batch notifications.
- No push for comments, likes, messages, or other existing in-app types.
- OneSignal Free is limited to **fewer than 1,000 mobile MAU per
  organization** (new customers from 2026-09-01, existing from 2026-10-01).
  Above the limit, mobile push and in-app sending pause after a 24-hour grace
  period until the organization upgrades. See deployment doc §6.
- Hosted OneSignal/FCM setup and migrations were applied to the development
  project on 2026-10-24. Production rollout (release build, app distribution,
  second recipient device) remains deployment-gated. The retention migration,
  worker version 5, and 15-minute cleanup schedule were applied and verified on
  2026-10-25.
- The INSERT webhook is the only automatic push invocation. A failed or
  reclaimed row needs a manual or scheduled sweep; no push-retry scheduler is
  configured yet. The retention schedule is a separate active `pg_cron` job.
- `pg_cron` 1.6.4 is installed on the hosted development project and
  `ucc2-cleanup-expired-notifications` has completed three verified scheduled
  runs (`runid 1` at 12:15 UTC, `runid 2` at 12:30 UTC, and `runid 3` at
  12:45 UTC; all `succeeded`).
- If a push remains non-terminal beyond 24 hours (pending, sending, or a
  near-term retry), retention deliberately keeps the in-app row. The row is
  deleted once the push becomes terminal. This protects delivery at the cost of
  a possible >24-hour in-app lifetime.
- Retention deletes rows, not Storage objects. The hosted before/after
  measurement was **28 rows / 81,920 bytes → 26 rows / 81,920 bytes**: deleted
  rows free space inside pages but the relation did not shrink. Do not claim
  disk savings without a fresh measurement after `VACUUM` or a table rewrite.
- The Alerts list refetches on tab focus and app resume, and the unread badge
  re-reads its count on resume. It also handles Realtime `INSERT` and `DELETE`,
  so an expired row disappears from an open list; a missed event while the app
  was backgrounded is picked up when the tab is next focused or the app returns
  to the foreground.
