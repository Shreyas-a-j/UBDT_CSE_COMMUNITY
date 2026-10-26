# Android Push Notifications — Deployment, OneSignal/FCM Setup & Device Checklist

**Date:** 2026-10-24 (retention addendum 2026-10-25) · **Status:** hosted
configuration and one-device delivery **verified** on the development project;
production rollout and the scheduled retry sweep remain **pending**. The
24-hour retention migration, push worker version 5, and 15-minute `pg_cron`
cleanup are deployed and verified on the development project (2026-10-25),
including a real scheduled deletion. This document is the operator runbook.

Design and change record: `docs/android-push-notifications-design.md`.

> **Do not enable email.** Email delivery is intentionally disabled. The
> Android push path replaces it. Do not restore the old Resend webhook or
> secrets as part of this rollout.

---

## 0. What must be true before starting

| Prerequisite | Check |
|---|---|
| A OneSignal account and Android app | App created; **App ID** copied |
| A Firebase project with FCM | FCM Service Account JSON downloaded |
| Supabase project access | Ability to run migrations and deploy Edge Functions |
| Android device | Physical device with Google Play Services, Android 7+ |
| App build | Native build (not Expo Go), package `com.ucc.community` |
| Free-plan headroom | Expected mobile MAU **< 1,000** (see §6) |

You will create these values:

| Value | Where it lives | Secret? |
|---|---|---|
| `EXPO_PUBLIC_ONESIGNAL_APP_ID` | mobile build environment | No (public app ID) |
| `ONESIGNAL_APP_ID` | Supabase Edge Function secrets | No |
| `ONESIGNAL_REST_API_KEY` | Supabase Edge Function secrets | **Yes** |
| `PUSH_HOOK_SECRET` | Supabase secrets + webhook header | **Yes** |
| FCM Service Account JSON | OneSignal dashboard only | **Yes** |
| `SUPABASE_SERVICE_ROLE_KEY` | injected by Supabase | **Yes — never bundle** |

## 1. Apply the database migrations

Apply **in this exact order**. The push migration depends on the publish
fan-out schema and trigger from the previous phase — `2026102401` references
`notifications`, and `2026102402` replaces `public.on_publish_notification()`,
which `2026102304` creates. `2026102403` also resolves
`public.notification_email_outbox` by `regclass`, so `2026102303` must land
first. `2026102402` must land before `2026102403`, otherwise the old publish
trigger could try to write the email outbox after the block is installed and
reject publications. `2026102501` must land last: it backfills `finished_at`
for rows settled by the old worker and changes the outbox foreign key to
`ON DELETE SET NULL`.

Preflight — run this first. All five tables and the outbox columns must
already exist before you start; if any is missing, apply the whole chain from
`2026102303`:

```sql
select
  to_regclass('public.notification_preferences')      as preferences,
  to_regclass('public.notification_email_outbox')     as email_outbox,
  to_regclass('public.notification_push_outbox')      as push_outbox,
  to_regclass('public.showcase_top_entries')          as showcase,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'notifications'
      and column_name = 'dedupe_key'
  )                                                   as dedupe_key,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'notification_push_outbox'
      and column_name = 'finished_at'
  )                                                   as outbox_finished_at,
  (
    select is_nullable = 'YES'
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'notification_push_outbox'
      and column_name = 'notification_id'
  )                                                   as outbox_detachable;
```

A hosted project can legitimately be several phases behind. On 2026-10-24 the
`brfxqnkafqunxauhtmar` project had `discussion_pins` but none of the
notification objects, so it needed the full six-file chain below.

Files, in order:

1. `supabase/migrations/2026102303_notification_publish_schema.sql`
2. `supabase/migrations/2026102304_notification_publish_triggers.sql`
3. `supabase/migrations/2026102401_android_push_schema.sql`
4. `supabase/migrations/2026102402_android_push_triggers.sql`
5. `supabase/migrations/2026102403_disable_publish_email.sql`
6. `supabase/migrations/2026102501_notification_retention.sql`

```bash
supabase db push
```

If the project has no migration ledger (it was set up by hand in the SQL
editor), `db push` tries to replay everything and will fail on objects that
already exist. Check `supabase migration list` before pushing. For a
hand-managed database, run the six files above in the SQL editor, in order,
each in its own transaction. Do not run only part of the set.

Then run `supabase/verify_schema.sql` in the SQL editor. Expect
**`VERIFICATION PASSED`**, including sections 22.15–22.18.

**Before applying**, confirm no email rows are being actively processed:

```sql
select status, count(*)
from public.notification_email_outbox
group by status;
```

Historical rows stay. Nothing in this rollout deletes them.

### 1.1 Enable `pg_cron` and create the 24-hour retention schedule

The retention migration does **not** install the extension. `pg_cron` 1.6.4 is
installed in `pg_catalog` on the hosted development project. For a rebuild,
enable it through the Dashboard or an operator SQL connection:

1. Supabase Dashboard → **Database** → **Extensions**, or run the equivalent
   SQL through the Management API (`supabase db query --linked`). A direct
   connection as the non-superuser `postgres` role may be rejected.

   ```sql
   create extension if not exists pg_cron with schema pg_catalog;
   grant usage on schema cron to postgres;
   grant all privileges on all tables in schema cron to postgres;
   ```

2. Confirm it is installed in `pg_catalog`:

   ```sql
   select e.extversion, n.nspname
   from pg_extension e
   join pg_namespace n on n.oid = e.extnamespace
   where e.extname = 'pg_cron';
   ```

3. Deploy the updated worker **before** enabling the schedule (§4). The worker
   now writes `finished_at` for every terminal outcome; the migration/cleanup
   backfills old settled rows.
4. Create or update the job:

   ```sql
   select public.ensure_notification_retention_schedule();
   ```

   It returns `true` only when `pg_cron` is installed. It creates or updates
   the job `ucc2-cleanup-expired-notifications` with schedule
   `*/15 * * * *` and command
   `select public.cleanup_expired_notifications();`.

5. Verify the job exists and is active:

   ```sql
   select jobid, jobname, schedule, command, active
   from cron.job
   where jobname = 'ucc2-cleanup-expired-notifications';
   ```

6. Wait for at least one scheduled run and verify it succeeded. Do **not**
   claim automatic deletion until this shows a real run:

   ```sql
   select jobid, runid, status, return_message, start_time, end_time
   from cron.job_run_details
   where jobid = (
     select jobid from cron.job
     where jobname = 'ucc2-cleanup-expired-notifications'
   )
   order by start_time desc
   limit 5;
   ```

7. Prove a real deletion with a synthetic user/notification older than 24
   hours, then confirm the row is gone and its dedupe key has `released_at`
   set. Also confirm a notification with a pending outbox row survives. For
   this proof, set the pending job's `next_attempt_at` beyond the push worker's
   claim window; otherwise the worker settles it as terminal and retention is
   allowed to delete the row.

Hosted status (2026-10-25): extension 1.6.4 installed, helper returned `true`,
exactly one active job (jobid 1), runids 1 (12:15 UTC), 2 (12:30 UTC), and 3
(12:45 UTC) `succeeded`, and the synthetic deletion/protection proof passed.

The function is idempotent: re-running the helper updates the existing job
instead of creating a duplicate. To pause retention without dropping objects:

```sql
select cron.alter_job(jobid, active := false)
from cron.job
where jobname = 'ucc2-cleanup-expired-notifications';
```

**Rollback:** pause or unschedule the job first. The retention tables and
functions can remain installed; they do nothing unless invoked. Do not restore
`ON DELETE CASCADE` on `notification_push_outbox.notification_id` while
retention is disabled without first checking existing links.

## 2. Configure Firebase Cloud Messaging

1. In the [Firebase console](https://console.firebase.google.com/), create or
   select the project that will own FCM for `com.ucc.community`.
2. **Project settings → Service accounts → Generate new private key**.
   Download the JSON once; do not commit it or put it in the app bundle.
3. In OneSignal: **Settings → Push & In-App → Google Android (FCM)**.
4. Upload the Service Account JSON and save. OneSignal validates that the
   account can call `cloudmessaging.messages.create` and
   `firebase.projects.get`.
5. Do not enable web push or iOS. This change set is Android-only.

The Firebase private key is uploaded to OneSignal, **not** shipped in the
Android build. `react-native-onesignal` obtains FCM credentials through the
OneSignal app configuration; the app only needs the public OneSignal App ID.

## 3. Configure the mobile app ID

The app reads the public App ID at build time:

```bash
# apps/mobile/.env (never commit a real .env)
EXPO_PUBLIC_ONESIGNAL_APP_ID="<onesignal-app-id>"
```

Add the same variable to the EAS build profile/environment used for release.
It is public and may be embedded in the APK/AAB. No REST key or webhook secret
may ever be placed in `EXPO_PUBLIC_*` variables.

> **2026-10-26 fix — release builds no longer silently disable push.**
> The public app id is now committed in `app.json` under
> `extra.onesignalAppId`. The resolution order in `src/lib/push-config.ts` is
> `EXPO_PUBLIC_ONESIGNAL_APP_ID` → `app.json extra.onesignalAppId`. A release
> build produced without the EAS environment variable therefore still
> initializes OneSignal instead of reporting `unsupported` and leaving the
> worker to mark every row “no subscribed devices”.
>
> Rebuild the release app after pulling this change, then verify on the device
> that OneSignal shows a `SUBSCRIBED` subscription whose External ID equals the
> signed-in Supabase UUID. `EXPO_PUBLIC_ONESIGNAL_APP_ID` still wins, so a
> different OneSignal app can be selected through the EAS environment without
> editing `app.json`.

Then regenerate native code and build:

```bash
cd apps/mobile
npx expo prebuild --platform android --no-install
cd android
./gradlew :app:assembleDebug     # local compile check
# release: eas build --platform android
```

The OneSignal Expo plugin supplies the monochrome notification icon and accent
color. It does not add an app ID to `AndroidManifest.xml`; the SDK receives it
from `OneSignal.initialize(appId)` in `src/lib/onesignal.ts`.

## 4. Set Supabase secrets and deploy the worker

```bash
supabase secrets set \
  ONESIGNAL_APP_ID="<onesignal-app-id>" \
  ONESIGNAL_REST_API_KEY="<onesignal-rest-api-key>" \
  PUSH_HOOK_SECRET="$(openssl rand -hex 32)"

supabase functions deploy send-push-notifications --no-verify-jwt
```

- `--no-verify-jwt` is required: the caller is a Database Webhook or scheduler,
  not a user session.
- The function fails closed (`500`) when `PUSH_HOOK_SECRET` is unset, and
  rejects a mismatched `x-internal-secret` with `401`.
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.
  Do not pass the service-role key to the app or to a client environment.

Deploy the disabled email worker too, so any stale deployment is replaced by
the HTTP 410 tombstone:

```bash
supabase functions deploy send-notification-emails --no-verify-jwt
```

The retention change also modifies the push worker: `notification_id` is now
nullable, every terminal path writes `finished_at`, and a detached
notification settles as `skipped` without sending. **Redeploy
`send-push-notifications` after applying `2026102501`** even if the secrets did
not change. Confirm the deployed function contains the new version before
enabling the retention schedule.

## 5. Create the queue trigger and a scheduled sweep

### 5.1 INSERT webhook

Dashboard → **Integrations → Database Webhooks** → new webhook:

| Field | Value |
|---|---|
| Table | `notification_push_outbox` |
| Event | `INSERT` |
| Type | HTTP request / Edge Function |
| Function | `send-push-notifications` |
| Method | `POST` |
| Header | `x-internal-secret: <PUSH_HOOK_SECRET>` |

The webhook is only a nudge: every invocation sweeps all due rows, so a missed
or replayed webhook is harmless. The database is the queue.

### 5.2 Scheduled retries

The webhook fires on INSERT only. A row parked for retry or reclaimed after a
crash needs another invocation. Pick one:

- **External scheduler (recommended, no function change):** call the function
  every 5 minutes with the secret header.
- **Supabase cron trigger:** if you use
  `supabase functions schedule ... --cron "*/5 * * * *"`, the invocation uses
  `x-supabase-cron-secret`, which the function currently does **not** accept.
  Add support before relying on this route.
- **`pg_cron` + `pg_net`:** POST to the function with `x-internal-secret`.

**Current status (2026-10-24):** not configured. The INSERT webhook is the only
automatic invocation.

Manual sweep while deploying:

```bash
curl -sS -X POST \
  "https://<project-ref>.functions.supabase.co/send-push-notifications" \
  -H "x-internal-secret: $PUSH_HOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Response: `{ ok, candidates, sent, retried, terminal, skipped, lostRace }`.
`200` from OneSignal with an empty `id` is counted as `skipped` (no subscribed
devices), not as success.

## 6. OneSignal Free plan limits and overage behavior

Current as of **2026-10-24** (verify before rollout):

- Free mobile push and in-app messaging: **fewer than 1,000 monthly active
  users (MAU) per organization**.
- This applies to new customers from **2026-09-01** and existing customers from
  **2026-10-01**.
- MAU counts any mobile subscription active in the last 30 days, whether or not
  the user currently has notifications enabled. One person with two devices
  counts as two MAU.
- Warning notices are sent at **75%**, **90%**, and **100%**.
- On crossing the limit, mobile push and in-app sending **pause after a 24-hour
  grace period** until the organization upgrades. Web push/email Free limits
  are separate and irrelevant here.
- The paid tier starts at **$19/month plus $0.012 per mobile-push MAU** (Growth,
  checked 2026-10-24). Confirm current pricing before budgeting.
- Delivery pauses do **not** lose queued work: outbox rows remain `pending` /
  `failed` and can be swept after an upgrade. Provider calls that are already
  accepted are not retracted.

Check usage in the OneSignal dashboard **Organizations** page. Keep the app
under 1,000 mobile MAU or budget for Growth before launch.

## 7. Email shutdown and verification

The migration already stops new email at the database level. Complete the
operator side:

1. Apply `2026102403` (section 1).
2. Deploy the HTTP 410 email tombstone (section 4).
3. **Delete or disable the old Database Webhook** in the Supabase dashboard if
   it still appears under Integrations → Database Webhooks. The migration drops
   webhook triggers, but the dashboard can retain a stale entry.
4. Remove provider secrets that are no longer needed:
   ```bash
   supabase secrets unset RESEND_API_KEY
   # optional, after confirming no other consumer:
   supabase secrets unset EMAIL_HOOK_SECRET
   ```
   Do not remove `SITE_URL` or unrelated secrets without checking other code.
5. Confirm the hard block:
   ```sql
   -- must fail with 0A000: "Email delivery is disabled for this deployment."
   insert into public.notification_email_outbox (source_type, source_id, user_id)
   values ('announcement', gen_random_uuid(), '<any-user-uuid>');
   ```
6. Confirm no email webhook trigger remains:
   ```sql
   select t.tgname
   from pg_trigger t
   join pg_proc p on p.oid = t.tgfoid
   join pg_namespace n on n.oid = p.pronamespace
   where t.tgrelid = 'public.notification_email_outbox'::regclass
     and not t.tgisinternal
     and n.nspname = 'supabase_functions';
   -- expect 0 rows
   ```
7. Confirm the tombstone:
   ```bash
   curl -sS -o /dev/null -w '%{http_code}\n' -X POST \
     "https://<project-ref>.functions.supabase.co/send-notification-emails" \
     -H "x-internal-secret: $EMAIL_HOOK_SECRET" -d '{}'
   # expect 410
   ```
8. Publish one announcement and confirm
   `notification_push_outbox` gained rows while
   `notification_email_outbox` did not.

**Historical data is intentionally retained.** Never drop
`notification_email_outbox` or delete old rows as part of this rollout.

### Re-enabling email (only with explicit approval)

Re-enabling requires a new, deliberate migration and code review. At minimum:

1. Drop `trg_block_new_email_enqueue` and `block_new_email_enqueue()`.
2. Restore the real email worker (not the 410 tombstone).
3. Restore the Database Webhook and `RESEND_API_KEY` / `EMAIL_HOOK_SECRET`.
4. Restore the email enqueue path in a new forward migration — do not revert
   `2026102402` in place on a database that already applied it.
5. Re-run the full email test suite and device/email smoke tests.

Do not do any of this during the Android push rollout.

## 8. Manual Android device checklist

All steps require a **native build** with `EXPO_PUBLIC_ONESIGNAL_APP_ID` set.
Expo Go cannot load `react-native-onesignal`.

### 8.1 Installation and identity

- [ ] Fresh-install the APK/AAB on a physical Android device with Google Play
      Services.
- [ ] Sign in. Open **Notifications** tab. The push card appears; the OS prompt
      has **not** appeared on its own.
- [ ] Tap **Enable notifications** → Android prompt → **Allow**.
- [ ] In OneSignal → Audience/Subscriptions, the device appears and its
      **External ID exactly equals the Supabase user UUID** (not an email).
- [ ] Repeat on a second device with the same account: both devices map to the
      same External ID; a send reaches both.
- [ ] Sign out. In OneSignal, the device is no longer associated with that
      External ID. Sign in as a different user: the External ID changes.

### 8.2 Publish behavior

- [ ] As verified faculty, publish an announcement. Exactly **one** push
      arrives on every subscribed device; the bell/mobile tab has exactly one
      in-app row.
- [ ] Tap the push. The app opens the announcements screen scrolled to the new
      announcement. Back-navigation works.
- [ ] Publish an event. Exactly one push arrives; tapping opens the home/events
      surface at the event.
- [ ] Edit the announcement title/body and the event title/description. **No**
      new push and no new in-app row.
- [ ] Publish from account A while device B is signed in as A but app is
      backgrounded/killed. Push arrives; a cold-start tap routes correctly.
- [ ] Publish as a user who is **not** the recipient (e.g. the publisher's own
      device): the publisher receives no push for their own publication.
- [ ] Publish while a recipient is banned/deleted or has push disabled in
      `notification_preferences`: no push row is enqueued for that recipient.

### 8.3 Showcase top two

- [ ] Create four showcase posts and upvote them so two are clearly top two.
      Only the owners of the top-two posts get a push.
- [ ] Refresh the feed and trigger ranking recalculation several times. **No**
      duplicate push or in-app notification.
- [ ] Remove an upvote so the third showcase enters the top two. Its owner gets
      exactly one push; the displaced owner's active tenure closes.
- [ ] Re-add the upvote so the displaced showcase re-enters. Its owner gets
      exactly **one new** push (new tenure), not one per refresh.
- [ ] A showcase that never leaves the top two receives **no** second push.
- [ ] A showcase with zero upvotes never receives a push.

### 8.4 Permission denial and recovery

- [ ] Uninstall/reinstall (or reset notification permission). Open the card and
      deny the OS prompt.
- [ ] The app explains denial and offers **Open settings**; it does not loop
      the OS prompt.
- [ ] Enable notifications in Android settings, return to the app/foreground:
      the card reflects the granted state without a restart.
- [ ] With permission granted but the user's `push_enabled = false`, a publish
      creates the in-app row but no push row.

### 8.5 Queue, retry and exit criteria

- [ ] With the app in Doze/background, publish; the push still arrives
      (FCM high-priority path).
- [ ] Temporarily use an invalid OneSignal REST key: invocation returns rows to
      `pending` with an auth error, and no storm of retries. Restore the key and
      sweep: queued rows send once.
- [ ] Confirm oneSignal idempotency: re-invoke the worker repeatedly. The
      `sent` count does not increase and no duplicate notification appears.
- [ ] Confirm the outbox row for each received push is `sent` with
      `provider_message_id` populated.
- [ ] Confirm no email arrives and no new row appears in
      `notification_email_outbox`.

**Exit criterion:** a real push caused by a real publish is received on the
physical device, and the matching `notification_push_outbox` row is `sent`.
**Satisfied on 2026-10-24** for an announcement, an event, and a showcase
top-two entry. The periodic retry sweep is still unconfigured.

## 9. Troubleshooting

| Symptom | Check |
|---|---|
| No device in OneSignal | App ID set at build time; native build (not Expo Go); permission granted; device has Play Services |
| Device present but send returns 200 with empty id | No subscribed devices for that External ID; user denied permission or OneSignal opt-out |
| Push arrives but tap opens nothing | Check `additionalData.link` / route mapper. Initialize OneSignal first, then attach the click listener; attaching first crashes with `Must call 'initWithContext' before use` (fixed in `apps/mobile/src/lib/onesignal.ts`) |
| `401` from worker | `x-internal-secret` mismatch; `PUSH_HOOK_SECRET` changed but webhook not updated |
| `500` from worker | `PUSH_HOOK_SECRET`, `ONESIGNAL_APP_ID`, or `ONESIGNAL_REST_API_KEY` missing |
| Rows stay `pending` | No webhook/cron invoked; run the manual curl in §5.2 |
| Publish fails after migration | Verify 2402 landed before 2403; check `on_publish_notification()` references push, not email |
| Email still arrives | Stale deployed worker (must be 410), stale webhook not deleted, or 2403 not applied |
| Free-plan sending paused | Organization at/over 1,000 MAU; upgrade or reduce audience; queued rows remain |

## 10. Deployment status

- [x] Schema, triggers, worker, mobile code, tests and local rehearsal are in
      the working tree.
- [x] Local SQL rehearsal and unit/type/lint checks pass. The rehearsal residue
      gate requires zero notification, push-outbox and showcase-tenure rows.
- [x] Local Android prebuild and debug Gradle build pass.
- [x] Debug APK installed on a physical `moto g64 5G` (Android 15) and launched
      without the OneSignal init-order crash.
- [x] Notification permission granted through the app's deliberate prompt;
      OneSignal reports a `SUBSCRIBED` push subscription whose External ID
      exactly equals the signed-in Supabase UUID.
- [x] Migrations applied to the hosted development project (`brfxqnkafqunxauhtmar`).
      The push chain through `2026102403` was applied on 2026-10-24; retention
      `2026102501` was applied on 2026-10-25 and the remote ledger matches local.
- [x] OneSignal app created and FCM credentials uploaded.
- [ ] `EXPO_PUBLIC_ONESIGNAL_APP_ID` set for the release build (debug build verified).
- [x] Supabase secrets set and both functions deployed.
- [x] Database INSERT webhook configured.
- [ ] Scheduled retry sweep configured.
- [x] Real Android device received real pushes caused by real publishes
      (announcement, event, showcase top-two).
- [x] Email disabled and verified in the hosted project (`send-notification-emails` returns 410).
- [x] Retention migration, schema mirror, worker changes, Realtime DELETE
      handling, verifier gate 22.18, SQL suite, and 28-migration rehearsal pass
      locally (2026-10-25).
- [x] Apply `2026102501_notification_retention.sql` to the hosted project.
- [x] Redeploy `send-push-notifications` with nullable-notification and
      `finished_at` handling (version 5).
- [x] Enable `pg_cron` (1.6.4, installed in `pg_catalog` through the Management
      API on 2026-10-25).
- [x] Create the retention job with
      `select public.ensure_notification_retention_schedule();` → `true`;
      exactly one active job (`jobid 1`, `*/15 * * * *`).
- [x] Observe successful `cron.job_run_details` runs: runids 1, 2, and 3 at
      12:15, 12:30, and 12:45 UTC, all `succeeded`; real scheduled deletions of
      synthetic >24-hour notifications confirmed, including a protected row
      with a pending outbox job.
- [x] Measure `notifications` row counts and `pg_total_relation_size`:
      28 rows / 81,920 bytes before the 12:15 run, 26 rows / 81,920 bytes after;
      25 real rows / 114,688 bytes after fixture cleanup. No reclamation
      observed.

### Verification record (2026-10-24)

- Event push and announcement push both arrived on the `moto g64 5G`; tapping
  routed to the event detail and the Announcements screen.
- In-app Alerts showed exactly 2 unread / 2 total after the two publishes.
- Outbox: 24 publish rows = 2 `sent` (one recipient with a device) + 22
  `skipped` (no subscribed Android device). Both sent rows had `attempts=1`
  and a provider message ID.
- Showcase entry: `chess_game` entered the top two and delivered
  “Your showcase is in the top two”; tapping opened the showcase detail.
  The outbox row was `sent` on the first attempt. Recompute and pull-to-refresh
  did not duplicate it. The ranking was then restored and the displaced
  owner’s test-induced re-entry was rolled back, so no third party was notified.
- Edit: the published test event and announcement titles were updated through
  the same `UPDATE` path the mobile composer uses; no notification or outbox
  row was created. The titles were reverted.
- Secret rotation: a diagnostic query exposed the webhook header value.
  `PUSH_HOOK_SECRET` was rotated, the function secret updated, and the
  `push-outbox-insert` trigger recreated. A subsequent real showcase send
  proves the new value is active; the old value is invalid.

### Verification record (2026-10-25, retention — local and hosted apply)

- `bash supabase/local-rehearsal/run-rehearsal.sh` → **REHEARSAL PASSED**:
  28/28 migrations, verifier through gate 22.18, retention TEST 1–13, existing
  suites and negative controls; residue zero notifications/outbox/ledger/
  tenures, 11 profiles/users, 28 ledger rows. Step 14 also loads
  `supabase/schema.sql` into a fresh database and checks the retention objects
  and detachable outbox FK.
- `npm test` (root) → 484/484 passed. `npx vitest run
  contexts/CommunityContext.test.tsx` → 34/34. Worker tests → 15/15.
- `npm test` (mobile) → 63/63. Root and mobile typechecks passed. Mobile lint
  passed; root lint's 14 errors are pre-existing mobile `set-state-in-effect`
  findings and two `require()` imports, not retention changes.
- Final rehearsal rerun on the completed tree after the documentation and
  comment-only migration edit: **REHEARSAL PASSED** again (28/28 migrations,
  retention TEST 1–13, zero residue, fresh-install schema checks).
- Hosted apply: `supabase db push --linked --dry-run` listed only
  `2026102501_notification_retention.sql`; the real push applied it. The remote
  migration ledger now matches local.
- Hosted worker: `send-push-notifications` deployed as version 5 and returns
  `401` without the hook secret.
- Hosted structural check: 25 notifications (0 older than 24 hours), 25 outbox
  rows (0 active), all terminal rows have `finished_at`, 25 live dedupe keys,
  `notification_id` nullable with FK delete action `SET NULL`, BEFORE INSERT
  dedupe trigger present, ledger RLS enabled with zero policies, retention index
  present, and all four retention functions present.
- Hosted scheduler: `pg_cron` 1.6.4 installed in `pg_catalog`; the helper
  returned `true`; exactly one active job exists (`jobid 1`, `*/15 * * * *`).
- `cron.job_run_details`: runid 1 (12:15:00 UTC), runid 2 (12:30:00 UTC), and
  runid 3 (12:45:00 UTC) all `succeeded`.
- Scheduled deletion proof: runid 1 deleted a synthetic 25-hour-old row and
  released its dedupe key; runid 2 deleted a second expired row while a
  23-hour-old row and an expired row with a `pending` outbox job survived. The
  pending job's `next_attempt_at` was two days out, so the push worker could not
  settle it before cleanup; the outbox link stayed attached.
- Storage: 28 rows / 81,920 bytes before runid 1, 26 rows / 81,920 bytes after.
  After the second fixture and cleanup: 25 real rows / 114,688 bytes (heap
  16,384; indexes 65,536). Deletion did not shrink the relation; no disk savings
  are claimed.
- Fixtures removed: hosted residue is 25 notifications, 25 terminal outbox rows,
  25 live dedupe keys, and 0 expired notifications.

**Remaining hosted gaps:** no periodic retry sweep; the hosted project is still
missing `profile_contacts` (2026102201) and some earlier functions, so that
reconciliation is a separate change. The showcase test entry and the edit were
driven at the database layer, not through the UI. A second recipient device and
account-switch coverage are still untested. Retention scheduling is live and
proven; no storage reclamation was observed, and none should be claimed without
`VACUUM` or a table rewrite.
