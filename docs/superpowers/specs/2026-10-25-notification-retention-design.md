# Notification Retention and Storage Optimization — Design

**Date:** 2026-10-25
**Status:** proposed; implementation and deployment require approval
**Scope:** UCC 2.0 Supabase notification retention, push-outbox retention, dedupe state, and verification

---

## 1. Intent

Keep the in-app notification bell and mobile Alerts tab useful for 24 hours, then
automatically remove the notification records. Preserve push delivery, retries,
deduplication, and all underlying UCC content.

The 24-hour policy applies to **in-app notification records only**. It does not
delete events, announcements, posts, showcases, profiles, auth users, faculty
applications, audit data, or Storage objects.

## 2. Goals

- Delete eligible `public.notifications` rows once `created_at` is older than
  24 hours.
- Run the cleanup automatically on a server-side schedule that can be verified.
- Keep cleanup idempotent and batched.
- Never delete a notification whose push job is still pending, sending, or
  waiting for a retry.
- Preserve deduplication after the notification row is gone.
- Stop retaining a permanent delivery record for every successful push.
- Keep concise, non-sensitive failure information for real failures.
- Preserve event, announcement, and showcase targeting, RLS, and authorization.
- Prove local behavior with SQL tests and prove the deployed schedule with a
  real scheduled run before claiming automatic deletion works.

## 3. Non-goals

- No email, web push, or iOS push.
- No changes to publish eligibility, publisher exclusion, showcase ranking, or
  OneSignal secret handling.
- No deletion of business content or storage.
- No full provider-response or payload archive.
- No new Edge Function or new shared secret for the primary design.

## 4. Current state (inspected 2026-10-25)

- `public.notifications.created_at` is `timestamp with time zone`, default
  `timezone('utc', now())`. This is the retention timestamp.
- No notification cleanup job exists.
- `notification_push_outbox.notification_id` is `NOT NULL` with
  `ON DELETE CASCADE`. Deleting a notification would destroy its push job and
  delivery state.
- Deduplication is the unique index on `notifications (user_id, dedupe_key)`
  plus trigger lookups in `public.notifications`. Deleting the row removes the
  dedupe record.
- `showcase_top_entries.notification_id` is nullable with `ON DELETE SET NULL`;
  the durable `entry_seq` and `notified_at` survive notification deletion.
- Hosted project `brfxqnkafqunxauhtmar`: `pg_cron` is available (1.6.4) but not
  installed; `pg_net` is installed. There are no cron jobs. Only
  `send-push-notifications` and `send-notification-emails` are deployed.
  The `postgres` role is not a superuser, so `pg_cron` must be enabled from the
  Supabase Dashboard.
- Current hosted data: 25 notifications (all under 24h), 25 push-outbox rows
  (3 sent, 22 skipped, 0 pending), 3 showcase tenures.

## 5. Design

### 5.1 Retention function

Add `public.cleanup_expired_notifications(...)` as a `SECURITY DEFINER`
PL/pgSQL function with `search_path = public, pg_temp`.

Default parameters:

| Parameter | Default | Meaning |
|---|---|---|
| `p_notification_retention` | `24 hours` | In-app notification lifetime |
| `p_dedupe_retention` | `30 days` | Dedupe-key lifetime after no notification references it |
| `p_success_log_retention` | `7 days` | Terminal `sent` / `skipped` outbox rows |
| `p_failure_log_retention` | `30 days` | Terminal `failed` outbox rows |
| `p_batch_size` | `1000` | Notifications deleted per batch |
| `p_max_batches` | `10` | Upper bound per invocation |

Behavior:

1. Capture one `now()` timestamp for the whole run.
2. Backfill `finished_at` for terminal rows left by the old worker:
   - `sent` / `skipped`: `coalesce(sent_at, updated_at, created_at)`.
   - `failed` with `next_attempt_at > now() + interval '1 day'`:
     `coalesce(updated_at, created_at)`.
3. Delete notifications older than `now() - 24 hours` in batches. A notification
   is **not** eligible while it has a non-terminal outbox row (see below).
4. Release dedupe keys for the deleted notifications (`released_at = now()`),
   then release any remaining orphaned ledger rows whose notification is
   already gone.
5. Delete terminal success/skipped outbox logs older than 7 days.
6. Delete terminal failed outbox logs older than 30 days.
7. Delete dedupe-ledger rows whose `released_at` is older than 30 days and which
   have no surviving notification.
8. Return a JSON summary with deleted counts, batch count, remaining expired
   notifications, and the cutoff timestamp. Also `RAISE NOTICE` the same counts
   for operator visibility, but do not depend on `cron.job_run_details`
   capturing the message; verification uses the run status and the data change.
9. Reject non-positive batch parameters.
10. Be safe to call repeatedly: a second call deletes zero rows and does not
    error.

**Single terminal predicate.** The migration adds
`public.notification_push_outbox_is_terminal(status, finished_at, next_attempt_at)`.
It returns:

- `true` for `sent` and `skipped`;
- `true` for `failed` when `finished_at is not null` or
  `next_attempt_at > now() + interval '1 day'`;
- `false` for `pending`, `sending`, and near-term retryable `failed`.

Cleanup, pruning, and tests all use this one predicate. The worker sets
`finished_at` on every terminal path going forward; the predicate and the
cleanup backfill cover rows settled by the old worker during the deployment
window. A failed row parked at the worker's 365-day terminal horizon is
therefore terminal even before it is backfilled; a row with the one-hour
maximum retry backoff is not.

Timestamp handling: all comparisons use `timestamptz` and `now()`. `24 hours`
is an exact interval, not a local calendar day, so DST cannot change the
cutoff. The database stores UTC and comparisons are absolute.

### 5.2 Dedupe ledger

Add `public.notification_dedupe_ledger`:

```
user_id      uuid not null references public.profiles(id) on delete cascade
dedupe_key   text not null check (char_length(dedupe_key) between 1 and 200)
created_at   timestamptz not null default now()
released_at  timestamptz
primary key (user_id, dedupe_key)
```

- RLS enabled, no policies, all privileges revoked from `anon` and
  `authenticated`.
- Index on `released_at` for cleanup.
- Backfill from existing notifications with a non-null `dedupe_key`, using the
  earliest `created_at` per pair and `released_at = null`.
- Add a `BEFORE INSERT` trigger on `public.notifications`:
  - Null `dedupe_key`: allow the insert unchanged.
  - Otherwise insert `(user_id, dedupe_key)` into the ledger with
    `ON CONFLICT DO NOTHING`.
  - If no ledger row was inserted, return `NULL` and suppress the duplicate
    notification.
- The trigger runs as the table owner so the client lockout on the ledger does
  not block fan-out.
- Revoke execute on the trigger function from `public`, `anon`, and
  `authenticated`.
- The cleanup function sets `released_at = now()` in the same statement that
  deletes a notification. A separate orphan sweep releases ledger rows whose
  notification was deleted manually. The ledger is pruned only 30 days after
  `released_at`, and only when no notification still references the key. This
  gives a full 30-day dedupe window after the in-app row is gone, even if a
  stuck outbox pinned the notification past its original 30-day ledger age.
- Keep the existing unique index on `notifications (user_id, dedupe_key)` as the
  concurrency backstop. The trigger suppresses duplicates before the insert; all
  production inserts currently go through `emit_notification` or the showcase
  function, both of which already use `ON CONFLICT DO NOTHING` and re-select the
  existing id. No production caller depends on a duplicate-key error. Direct
  inserts exist only in tests.
- Normal publish and showcase flows cannot reuse a key after the ledger window:
  publish fan-out is INSERT-only and showcase keys include a durable per-post
  `entry_seq`. A manual replay after the ledger window is outside normal
  operation and is documented as a residual risk.

This makes dedupe independent of the notification row. Deleting the in-app row,
or its outbox row, cannot authorize a second push.

### 5.3 Push outbox changes

- Make `notification_push_outbox.notification_id` nullable and change the FK to
  `ON DELETE SET NULL`. Deleting a notification detaches the delivery record
  instead of destroying it.
- Keep the existing unique constraint on `notification_id`. Postgres permits
  multiple `NULL`s, so detached logs do not collide.
- Add `finished_at timestamptz`. It marks a terminal state:
  - `sent`: set on successful provider acceptance.
  - `skipped`: set on any terminal no-op (no subscribers, preference off,
    missing/banned recipient, notification gone).
  - `failed`: set only for permanent provider failures or exhausted retries.
  - `pending` and `sending`: always null.
  - Retryable `failed`: null.
- Backfill `finished_at` for existing `sent` / `skipped` rows and for existing
  `failed` rows with `next_attempt_at > now() + interval '1 day'` (the worker
  parks terminal failures at 365 days and retries within one hour). Leave
  `pending`, `sending`, and near-term `failed` rows null. Use
  `coalesce(sent_at, updated_at, created_at)` for success rows and
  `coalesce(updated_at, created_at)` for failure rows; this preserves the
  original terminal age rather than granting a fresh retention window.
- Add an index on `(status, finished_at)` for log pruning.
- Update the worker:
  - Keep the existing `pending`, due `failed`, and stale `sending` candidate
    queries and add `finished_at is null` to each. Do **not** replace the
    status filters: a `sent` or `skipped` row settled by the old worker during
    the migration-to-deploy window has `finished_at = null` but must never be
    re-claimed.
  - Clear `finished_at` when claiming a retryable row.
  - Set `finished_at` on every terminal path.
  - Treat a null `notification_id` as terminal/skipped if it is ever claimed.
- The cleanup's terminal predicate and backfill make old-worker settlements
  safe: `sent`/`skipped` are terminal by status even with a null
  `finished_at`, and the backfill stamps them before pruning.
- Do not store full provider responses, payload copies, or new verbose fields.
  Keep the existing `provider_message_id` only for the short terminal-log
  window. Keep concise `last_error` text for real failures.
- Never log authorization headers, the OneSignal REST key, or the hook secret.

### 5.4 Schedule

Use Supabase Cron (`pg_cron`) with a SQL job, not an Edge Function.

- Add `public.ensure_notification_retention_schedule()`:
  - If `pg_cron` is not installed, raise a notice and return `false`.
  - Otherwise create or update job
    `ucc2-cleanup-expired-notifications` with schedule `*/15 * * * *` and
    command `select public.cleanup_expired_notifications();`.
  - Use dynamic SQL against the `cron` schema so the migration works on a
    database without `pg_cron`.
- Call the helper from the migration. On a database without `pg_cron`, the
  schedule is skipped, not failed.
- After the operator enables `pg_cron`, run the helper manually and verify
  `cron.job` and a real `cron.job_run_details` success.
- The schedule runs in UTC. A 15-minute cadence means deletion happens between
  24h and 24h15m after creation.
- No cleanup Edge Function and no new secret are introduced.

### 5.5 Clients

Add a Realtime `DELETE` handler to the mobile notifications list subscription
(alongside the existing `INSERT` handler) so a row removed by cleanup disappears
without waiting for focus/resume. The unread badge already listens to `*` and
re-reads on resume; no new badge logic is required.

Add the equivalent `DELETE` handler to the web notification subscription in
`contexts/CommunityContext.tsx`. The web bell currently subscribes to `INSERT`
only and would otherwise keep showing a deleted row until a full reload. Both
handlers remove the row from local state by id; the web unread count derives
from that state, so it updates with the removal.

### 5.6 Database indexes

- `notifications (created_at)` for the global retention scan.
- `notification_dedupe_ledger (released_at)` for ledger cleanup.
- `notification_push_outbox (status, finished_at)` partial where
  `finished_at is not null` for terminal-log pruning.

Existing indexes remain, including the user-scoped notification index and the
outbox unique `notification_id` index.

### 5.7 RLS and privileges

- `notification_dedupe_ledger`: RLS on, no policies, revoke all from
  `anon`/`authenticated`.
- `cleanup_expired_notifications()` and
  `ensure_notification_retention_schedule()`: `SECURITY DEFINER`, execute
  revoked from `public`, `anon`, and `authenticated`.
- The ledger trigger function: execute revoked from clients.
- Existing notification RLS is unchanged: users still select/update only their
  own rows.
- Existing outbox and showcase-tenure client lockouts remain.

## 6. Testing

### 6.1 SQL rehearsal

Add `supabase/test-notification-retention.sql` and run it in
`supabase/local-rehearsal/run-rehearsal.sh`. Cover:

1. A notification younger than 24h remains.
2. A notification older than 24h is deleted.
3. A second cleanup call deletes zero rows and does not error.
4. Batched deletion with a small batch size deletes all eligible rows across
   batches.
5. A pending outbox row blocks notification deletion.
6. A retryable `failed` outbox row blocks deletion.
7. A terminal `failed` outbox row allows notification deletion and keeps the
   concise error log until the 30-day window.
8. A `sent`/`skipped` outbox row allows notification deletion and is pruned only
   after its 7-day window.
9. After notification deletion, inserting the same `(user_id, dedupe_key)` is
   suppressed by the ledger and creates no new push outbox row.
10. Showcase: deleting the notification while the tenure is active does not
    re-notify on recompute; a genuine leave/re-entry with a new `entry_seq`
    still notifies once.
11. Timezone: with a non-UTC session timezone, 23h-old and 25h-old rows are
    classified the same as under UTC.
12. Other data: events, announcements, posts, profiles, and tenures survive
    cleanup unchanged.
13. RLS: clients cannot read/write the ledger or execute either cleanup
    function; notification owner-only RLS still works.
14. Outbox: multiple detached rows with `notification_id = null` are allowed;
    the unique constraint still rejects two rows for one non-null notification.

Update existing tests that relied on `ON DELETE CASCADE` to delete outbox rows
by source and ledger rows by key explicitly. Specifically:

- `supabase/test-notification-fanout.sql` TEST 4, 5, 6, and 7 delete fan-out
  rows for seeded recipients.
- `supabase/test-faculty-onboarding.sql` deletes the announcement fan-out.
- The residue gate adds `notification_dedupe_ledger` and still expects zero
  notifications, outbox rows, ledger rows, and showcase tenures.

### 6.2 Schema verifier

Add a new gate to `supabase/verify_schema.sql` for the retention migration:

- Ledger table, PK, length check, RLS, zero policies, client lockout.
- Ledger trigger and function exist, are `SECURITY DEFINER`, and are not
  executable by clients.
- Outbox `notification_id` is nullable and its FK is `ON DELETE SET NULL`.
- `finished_at` exists and the pruning index exists.
- Cleanup/schedule functions exist, are `SECURITY DEFINER`, and are not
  executable by clients.
- `notifications (created_at)` index exists.

### 6.3 Worker and app checks

- Push worker tests (`15/15` currently) still pass.
- Mobile `typecheck`, `lint`, and `63/63` tests still pass, plus a device smoke
  test of Alerts deletion handling.
- Root web tests (`483/483` currently) still pass; the web notification context
  gains a DELETE handler and its tests are updated for the removed row.
- Full rehearsal passes with 28/28 migrations and zero residue. The canonical
  list currently has 27 migrations; the retention migration is the 28th.

### 6.4 Deployed verification

After approval and deployment:

1. Verify `cron.job` contains an active job with schedule `*/15 * * * *`.
2. Create a synthetic test auth user and one notification with
   `created_at = now() - interval '25 hours'`, no outbox row.
3. Wait for the next scheduled run.
4. Verify:
   - `cron.job_run_details` records a successful run.
   - The 25h-old test notification is gone.
   - A 23h-old companion notification remains.
   - The test user's other data is untouched.
5. Clean up the synthetic user and companion notification.
6. Measure `count(*)` and `pg_total_relation_size('public.notifications')`
   before and after. Report logical deletion separately from physical storage;
   autovacuum may not have reclaimed pages yet. Do not claim disk reclamation
   without a measured size drop.

If the scheduled run cannot be observed, report the job as created but
automatic deletion as **unverified**. Do not claim success from the manual
function call alone.

## 7. Deployment plan

1. Enable `pg_cron` in the Supabase Dashboard
   (Database → Extensions). This is the only operator-only prerequisite.
2. Apply `2026102501_notification_retention.sql` to the hosted project. The
   migration backfills `finished_at`, creates the retention/dedupe objects, and
   attempts to create the schedule.
3. Deploy the updated `send-push-notifications` Edge Function. The cleanup
   predicate and backfill make any old-worker settlements in this window safe;
   the cleanup never calls the worker and never sends a push.
4. Run `select public.ensure_notification_retention_schedule();` again to
   confirm the schedule is idempotent and active.
5. Verify the cron job and perform the deployed verification in 6.4.
6. Update docs and the SDD ledger with the verified state.

No hosted SQL is run before explicit approval of this design and the exact
migration. No commits or pushes are made without separate authorization.

## 8. Risks and limits

- **Retention is delayed for live retries.** A notification with a pending,
  sending, or retryable failed outbox row can live longer than 24 hours. This is
  deliberate: deleting it would break delivery. A stuck worker or missing
  webhook/scheduler can therefore retain rows past 24 hours. Monitor outbox rows
  with `status in ('pending','sending')` and old timestamps.
- **Dedupe ledger expires 30 days after release.** Normal publish/showcase flows
  cannot reuse a key after that. A manual replay of an old publication insert
  after the window could create a new notification; this is outside normal
  operation.
- **Physical storage is not immediately reclaimed.** Row deletion frees space
  for reuse; `pg_total_relation_size` may not shrink until autovacuum. Report
  measured results honestly.
- **No production schedule proof until pg_cron is enabled.** The migration is
  safe without it, but automatic deletion is not claimed until a scheduled run
  is observed.
- **The pg_cron branch is not testable in the raw-Postgres rehearsal.** The
  rehearsal image has no `pg_cron`; it can verify the absent-extension branch
  and the cleanup function directly. Schedule creation, the 15-minute trigger,
  and `cron.job_run_details` are verified only on the hosted project.
- **Existing tests must be updated** because the outbox FK no longer cascades.
  This is expected and part of the change, not a regression.
- **No new secrets.** The cron job is database-local; no authorization header is
  stored in the job command.

## 9. Builder-check resolutions

The fresh-review pass raised these questions; the design above now resolves
them:

1. **Terminal source of truth.** One SQL predicate,
   `notification_push_outbox_is_terminal(status, finished_at, next_attempt_at)`.
   `sent`/`skipped` are terminal by status; `failed` is terminal when
   `finished_at` is set or `next_attempt_at > now() + interval '1 day'`.
   Backfill timestamps preserve the original terminal age.
2. **Worker migration window.** Keep the status filters and add
   `finished_at is null`; never re-select `sent`/`skipped`. Migration backfills
   existing terminal rows, and the cleanup backfills any old-worker settlements
   before pruning. Schedule creation before worker deploy is safe because cleanup
   never sends a push.
3. **Web bell.** Add the DELETE handler to `contexts/CommunityContext.tsx` as
   well as mobile; update the web tests.
4. **Ledger clock.** Add `released_at`; set it when cleanup deletes the
   notification, sweep orphans, and prune 30 days after release, not 30 days
   after first insert.
5. **Trigger vs unique index.** Keep the unique index as the concurrency
   backstop; the trigger suppresses first. All production inserts go through
   `emit_notification` or the showcase function with their existing
   `ON CONFLICT`/re-select paths; tests may insert directly.
6. **pg_cron local testability.** Accepted: local rehearsal verifies the
   absent-extension branch and the cleanup function; hosted verification proves
   the schedule and a real run.
7. **Cron observability.** Do not rely on `return_message`; verify run status
   and data changes. The function returns JSON and raises a notice for manual
   inspection. No run-history table is added.
8. **Test counts.** The canonical list is 27 today; the new total is 28/28. The
   reviewer’s “28 currently” was a miscount.

## 10. Decisions left to the builder

- Exact SQL formatting, batch loop structure, and function return shape.
- Exact mobile/web DELETE handler placement and test approach.
- Exact doc updates and migration order entry.
- Whether to add a separate operator query/runbook for stuck outbox rows.
