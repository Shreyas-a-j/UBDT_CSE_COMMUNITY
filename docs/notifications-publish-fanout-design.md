# Notifications for Published Announcements & Events — Design Note

**Date:** 2026-10-23 · **Scope:** Phase 1 (in-app) + Phase 2 (email) ·
**Status:** **partially superseded on 2026-10-24** — email delivery is
disabled and Android push now ships. See
`docs/android-push-notifications-design.md` and
`docs/android-push-notifications-deployment.md`.

> **Email is disabled.** As of `2026102403`, new email enqueue is hard-blocked,
> Database Webhook triggers on the email outbox are dropped, and the email
> worker returns HTTP 410. The email sections below are the historical Phase 2
> design retained for audit. Do **not** follow the old activation guide in
> `docs/notifications-publish-fanout-deployment.md`; that document is retained
> only as a historical record. In-app notifications and their fan-out remain
> current and unchanged.

## 1. Intent

When a faculty announcement or any event is **published**, every eligible
member gets exactly one in-app notification. In the original Phase 2, that
publish also queued exactly one email; email has since been replaced by
Android push. Retries never duplicate anything, a delivery failure can never
roll back the publication or remove the in-app row, and ordinary users can
neither forge notifications nor read anyone else's.

## 2. What exists (verified against the code, 2026-10-23)

- `public.notifications` — RLS `Users view own notifications` +
  `Users can update own notifications` (`auth.uid() = user_id`), realtime
  publication, `content_type`/`content_id`/`dedupe_key` columns, unique
  `(user_id, dedupe_key)` partial index (from `2026102202`).
- `emit_notification(...)` — `SECURITY DEFINER`, `ON CONFLICT DO NOTHING`
  dedupe, EXECUTE revoked from `public`, `anon`, `authenticated`
  (`schema.sql` lines 1271–1272).
- Web bell: `components/Navbar.tsx` (unread count, list, mark read,
  `router.push(notification.link)`); `contexts/CommunityContext.tsx` loads
  40 rows + realtime INSERT channel. Mobile reads the same table in
  `apps/mobile/src/app/(tabs)/notifications.tsx`.
- Publish paths: announcements **only** via `POST /api/announcements`
  (server-side verified-faculty check + RLS `is_verified_faculty`), events
  via direct client insert with RLS `auth.uid() = host_id`. There is no
  draft state: the INSERT *is* the publish; every edit is an UPDATE.
- No preferences table, no email queue, no Edge Functions, no `config.toml`
  existed before this change.

## 3. Architecture (final)

```
client INSERT ──► [AFTER INSERT trigger: announcements | events]
                    │  (same transaction as the publish)
                    ├─ 1. per eligible recipient: emit_notification(…, dedupe_key)
                    │      → public.notifications rows (idempotent)
                    └─ 2. per eligible recipient: insert notification_email_outbox
                           ON CONFLICT DO NOTHING, wrapped in an exception
                           block → enqueue failure = RAISE WARNING only
                                      (never blocks publish or in-app rows)

Database Webhook (INSERT → notification_email_outbox, header x-internal-secret)
        └─► supabase/functions/send-notification-emails (Edge Function, Deno)
              ├─ verifies EMAIL_HOOK_SECRET (fail-closed)
              ├─ claims due rows: atomic compare-and-set
              │    (status+next_attempt_at/locked_at guard → sending;
              │     stale claims >5 min reclaimed, see §5)
              ├─ re-checks notification_preferences.email_enabled per row
              ├─ builds branded HTML (template.ts) with link to original
              └─ POST Resend with Idempotency-Key = outbox row id
                    ├─ any 2xx → status sent (message id stored when present)
                    ├─ 429/5xx/network → status failed, attempts+1,
                    │     next_attempt_at = backoff (retryable)
                    └─ other 4xx / attempts exhausted → status failed
                          (terminal, observable), or skipped (opt-out)
```

Delivery is **at-least-once with effectively-once results**: the outbox
unique key prevents duplicate work items, row claiming prevents concurrent
workers, and the Resend `Idempotency-Key` (24 h retention, provider-side)
prevents duplicate sends even if the function crashes between provider
acceptance and the status update.

## 4. Recipient model

Eligibility (one query, `publish_recipient_ids()` semantics): a row in
`public.profiles` whose `auth.users` has `email_confirmed_at IS NOT NULL`,
`banned_until` null-or-past, `deleted_at` null — **excluding the publisher**.

- The user's stated rule ("every signed-in and verified email user") maps to
  "has a profile (provisioned at signup) with a confirmed email".
- **Ambiguity ruled:** "signed-in" is read as *account exists and is in good
  standing*, not "has signed in within N days" — no activity cutoff exists
  in the repository, so inventing one would silently drop members. Narrowest
  defensible set: confirmed, not banned, not deleted, not the publisher.
- Eligibility is evaluated **once at publish time** for both channels, so
  in-app and email sets always agree.

Notification record shape: `type` = `announcement` | `event_published`
(new value), `content_type` = `announcement` | `event`, `content_id` = row
id, `link` = `/announcements#announcement-<id>` | `/#event-<id>`,
`dedupe_key` = `publish:<content_type>:<content_id>`.

## 5. Idempotency inventory

| Layer | Key | Mechanism |
|---|---|---|
| In-app rows | `(user_id, dedupe_key)` unique index | `ON CONFLICT DO NOTHING` |
| Email work items | `(source_type, source_id, user_id)` unique | `ON CONFLICT DO NOTHING` |
| Worker concurrency | atomic compare-and-set claim (`status` + `next_attempt_at`/`locked_at` guard → `sending`; Supabase-js has no `FOR UPDATE SKIP LOCKED`) | stale-claim reclaim after 5 min; settle fenced by claim identity |
| Provider send | `Idempotency-Key` = outbox row id | Resend dedupes 24 h |

Re-running the publish workflow (client retry, trigger re-fire, webhook
replay, function re-invoke) changes none of the four counts.

## 6. Email opt-out (preferences)

`public.notification_preferences(user_id PK → profiles cascade,
email_enabled bool not null default true, updated_at)`.

- **Missing row = enabled** (read as `coalesce(prefs.email_enabled, true)`),
  so the default-on policy needs no backfill and no trigger.
- RLS: a user may SELECT/INSERT/UPDATE/DELETE **only their own** row
  (`auth.uid() = user_id`); no policy grants touching another user, and
  privileged/cross-user changes are reserved for the service role (no code
  path does this today). No UI ships in this phase; a future UI is a plain
  client form on the user's own row — no schema or policy change needed.
- The preference is checked **immediately before each send** inside the
  Edge Function, after the row is claimed. An opt-out that lands between
  enqueue and send therefore suppresses the email (row → `skipped`) while
  the in-app notification — already written at publish time — stays intact.
- In-app notifications never consult this flag: it is an *email* preference.
- The column is a single channel flag today; the table shape (one row per
  user, one boolean per channel) extends to future channels
  (`push_enabled`, …) without a generalized framework.

**Policy note (partner decision carried forward):** these are transactional
community notifications about published content, on by default. Default-on
application settings are *not* treated as legally valid marketing consent;
no marketing/digest traffic goes through this path.

## 7. Security model

- Fan-out trigger function and recipient query are `SECURITY DEFINER` with
  `search_path = public`, EXECUTE revoked from `public`/`anon`/`authenticated`
  — only the database itself fires them (Postgres does not check EXECUTE on
  trigger invocation, and no client can call them directly).
- `notification_email_outbox`: RLS enabled with **no** policies and table
  privileges revoked from `anon`/`authenticated` — invisible and unwritable
  to every client; only the service role (Edge Function) touches it.
- The Edge Function fail-closes unless `EMAIL_HOOK_SECRET` is configured and
  the webhook header matches; secrets (`RESEND_API_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, `EMAIL_HOOK_SECRET`, `SITE_URL`) live only in
  Supabase Edge Function secrets. Nothing secret reaches web or mobile code.
- Provider logic is isolated in `supabase/functions/send-notification-emails/
  resend.ts` behind a tiny interface so the provider can be swapped without
  touching the worker, queue, or database.
- Existing authorization untouched: announcement publishing still requires
  verified faculty (route + RLS), events still require `auth.uid() = host_id`,
  anon can do neither. `notifications` RLS is unchanged.

### Known abuse surface (agreed brief behaviour, flagged)

Event creation is open to **any authenticated member** (`host_id =
auth.uid()`), so any member's publish now fans out to the whole community
— in-app and one email each. This is exactly the brief's recipient rule
("every signed-in user with verified email, excluding the publisher") applied
to the existing authorization model, and announcements are already gated to
verified faculty; but it means a malicious or careless member can generate
community-wide email volume (rate is bounded per publish by member count,
not per member). Accepted for this phase. If abuse appears, the narrow
mitigations — without touching the fan-out design — are: (a) restrict
event INSERT RLS to verified faculty like announcements, (b) add a per-user
publish rate limit, or (c) flip the default in `notification_preferences`
and let members opt *in*. Resend's own complaint/bounce handling is the
final backstop.

## 8. Deep links (acceptance test 7)

The bell pushes `notification.link`. There were no per-item routes
(`/announcements/[id]` and an events route do not exist), so the fan-out
links to the list page plus an element anchor, and the cards now carry
`id="announcement-<id>"` / `id="event-<id>"`:

- `/announcements#announcement-<id>` — announcements page scrolls to the
  card after the feed loads (hash alone cannot, because the list renders
  asynchronously).
- `/#event-<id>` — home page does the same for the events section.

Mobile keeps its existing routing behaviour for these types (its `routeFor`
falls back to the home tab); no web URLs are pushed into the native router.

## 9. OneSignal compatibility (implemented 2026-10-24)

The outbox models **source event** (`source_type`, `source_id`) and
**recipient** (`user_id`) separately from **delivery channel** (`status`,
`provider`, `provider_message_id`). The Android push phase now consumes that
same source-event/recipient model through
`notification_push_outbox`, with one push work item per in-app notification and
OneSignal `external_id` = Supabase user UUID. See
`docs/android-push-notifications-design.md`. Email is disabled; it is not a
parallel delivery channel.

## 10. Failure-handling rulings

- In-app fan-out failure **propagates** (statement-level atomicity): a
  publish that cannot notify is rejected loudly and can be retried cleanly —
  half-fanned-out publishes cannot exist.
- Outbox enqueue failure is **trapped** (`BEGIN … EXCEPTION` savepoint,
  `RAISE WARNING`): per the requirement, email problems must never roll back
  publication or suppress in-app rows. The trade-off — a persistently broken
  outbox loses email work silently-logged rather than blocking publishing.
- The webhook fires post-insert via `pg_net` (asynchronously); a rolled-back
  publish can still leave a fired webhook — the worker's row claim is the
  authority, and rolled-back rows simply do not exist when it queries.
- **Retry scheduling is deployment-gated (not automatic).** The webhook only
  fires on INSERT, so a parked retry (`failed`, future `next_attempt_at`) or
  a crash-reclaimed row is only picked up on the next publish's webhook or a
  manual invocation. Unattended retries require a cron/scheduled invocation
  — see `docs/notifications-publish-fanout-deployment.md` §5b. This is
  deliberate: no scheduler exists in the repo, and inventing one (pg_cron,
  external cron) is a deployment decision, not a code change.

## 11. Non-goals

No notification-management UI, no redesign of bell or mobile tab, no digest
or marketing email, no OneSignal SDK, no replacement of `notifications` or
`emit_notification()`, no weakening of existing RLS.
