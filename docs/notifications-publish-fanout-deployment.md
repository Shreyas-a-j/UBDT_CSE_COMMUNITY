# Publish Notifications — Email Delivery Activation Guide (HISTORICAL / DISABLED)

> **DO NOT FOLLOW THIS GUIDE. Email delivery is disabled as of 2026-10-24.**
> `2026102403_disable_publish_email.sql` hard-blocks all new email enqueue and
> drops the email webhook triggers; `send-notification-emails` is an HTTP 410
> tombstone. This page is retained only as the historical record of how the
> Resend path was configured before it was replaced by Android push.
>
> Current architecture: `docs/android-push-notifications-design.md`
> Current deployment and email-shutdown procedure:
> `docs/android-push-notifications-deployment.md`

**Date:** 2026-10-23 · **Scope:** the historical publish fan-out described in
`docs/notifications-publish-fanout-design.md` · **Status:** superseded on
2026-10-24. Everything below is the pre-disable configuration record; none of
it should be applied to a current deployment.

## What was live before the disable

- In-app notifications on announcement/event publication
  (`AFTER INSERT` triggers, `2026102304`), idempotent per
  `(user, dedupe_key)`, delivered through the existing bell/mobile tab.
- A durable email queue (`public.notification_email_outbox`) filled in the
  same transaction as the publish — one row per (publish, recipient).
- A per-user email preference (`public.notification_preferences`,
  default-on, no UI) enforced immediately before every send.
- The delivery worker `supabase/functions/send-notification-emails/`
  (claim → preference re-check → branded email → Resend with an
  `Idempotency-Key`; retries with exponential backoff, terminal after 5
  attempts or a permanent 4xx).

That path is now stopped at three layers: the publish trigger writes push
instead of email, the database rejects every new email-outbox insert, and the
worker returns 410. Historical email rows remain for audit.

## 1. Apply the migrations (hosted project)

In order, exactly as `docs/migration-dependency-order.md` describes:

1. `supabase/migrations/2026102303_notification_publish_schema.sql`
2. `supabase/migrations/2026102304_notification_publish_triggers.sql`

Then in the SQL editor run `supabase/verify_schema.sql` (expect
`VERIFICATION PASSED`; blocks 22.13/22.14 cover these objects).

## 2. Set the Edge Function secrets

```bash
supabase secrets set \
  RESEND_API_KEY="re_xxx" \
  EMAIL_HOOK_SECRET="$(openssl rand -hex 32)" \
  SITE_URL="https://ubdt-cse-community.vercel.app" \
  EMAIL_FROM="UBDT CSE Community <onboarding@resend.dev>"
```

| Secret | Meaning |
|---|---|
| `RESEND_API_KEY` | Resend API key (https://resend.com/api-keys). Never put this in web or mobile code. |
| `EMAIL_HOOK_SECRET` | Shared secret required on every invocation (`x-internal-secret` header). The function **fails closed** if it is unset. Generate it yourself; it is not the service-role key. |
| `SITE_URL` | Base URL used to build the deep links inside emails (`/announcements#announcement-<id>`, `/#event-<id>`). |
| `EMAIL_FROM` | Optional. Defaults to the Resend **sandbox** sender `UBDT CSE Community <onboarding@resend.dev>`, which only delivers to your own Resend account address until the domain is verified. For real delivery: verify a domain in Resend and set e.g. `UBDT CSE Community <no-reply@your-domain>`. |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically
into hosted functions — do not set them manually.

## 3. Deploy the function

```bash
supabase functions deploy send-notification-emails --no-verify-jwt
```

`--no-verify-jwt` is required: the caller is a Database Webhook, not a
user session. Access control is the `x-internal-secret` header checked
against `EMAIL_HOOK_SECRET`.

## 4. Create the Database Webhook

Dashboard → **Integrations → Database Webhooks** → new webhook:

| Field | Value |
|---|---|
| Table | `notification_email_outbox` |
| Event | `INSERT` |
| Type | HTTP request (Edge Function) |
| Function | `send-notification-emails` |
| Method | `POST` |
| Headers | `x-internal-secret: <the EMAIL_HOOK_SECRET value>` |

The webhook is only a *nudge*: every invocation sweeps **all** due rows,
so a missed, delayed or replayed webhook never loses or duplicates work.
A rolled-back publish can still fire the webhook; the worker then finds no
committed rows and does nothing.

## 5. Retry / catch-up without waiting for a webhook

Any re-invocation drains whatever is due (e.g. after an outage, or to
retry terminal rows you deliberately re-armed):

```bash
curl -sS -X POST \
  "https://<project-ref>.functions.supabase.co/send-notification-emails" \
  -H "x-internal-secret: $EMAIL_HOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Response: `{ ok, candidates, sent, retried, terminal, skipped, lostRace }`.

## 5b. Scheduled sweep (required for unattended retries)

The webhook only fires on INSERT, so **nothing invokes the worker on its
own schedule**: a row parked for retry (`status = 'failed'`,
`next_attempt_at` in the future) or reclaimed after a crash will sit until
some INSERT nudges the function or a human runs the curl in §5. That is
fine for a quiet queue but not for unattended delivery. Pick one:

1. **Cron-triggered invocation (recommended, no code change).** Supabase
   Edge Functions support cron triggers:
   ```bash
   supabase functions schedule send-notification-emails --cron "*/5 * * * *"
   ```
   Supabase invokes it with the `x-supabase-cron-secret` header; add that
   secret to the allowed headers alongside `x-internal-secret` in a future
   revision if you use this route (out of scope for this change set — the
   function currently accepts only `x-internal-secret`).
   Alternative that needs no function change: a tiny external scheduler
   (GitHub Actions `schedule:` cron, Vercel Cron) calling the §5 curl.
2. **Database Scheduler alternative:** a `pg_cron` job calling
   `net.http_post` (Supabase's `pg_net` extension) against the function
   URL with the secret header — runs entirely inside Postgres.

Until one of these exists, the documented operating model is: retries fire
on the next publish (webhook) or on demand (§5 curl). This is stated in
`docs/notifications-publish-fanout-design.md` §10 as a deployment-gated
item.

**Re-arming a terminal row** (status `failed`, parked ~1 year out):

```sql
update public.notification_email_outbox
set next_attempt_at = now(), status = 'pending', attempts = 0
where id = '<row-id>';
```

## 6. Per-user opt-out (no UI yet)

Default is **on**; a missing row means enabled. To opt a user out (or let
them do it themselves in any future surface):

```sql
insert into public.notification_preferences (user_id, email_enabled)
values ('<user-uuid>', false)
on conflict (user_id) do update set email_enabled = excluded.email_enabled;
```

RLS lets a user manage **only their own** row. An opt-out that lands after
a message was queued but before it was sent still wins: the worker
re-reads the preference immediately before the provider call and marks the
row `skipped`. In-app notifications are unaffected by this flag.

## 7. End-to-end smoke test (real delivery)

1. Verify your sender (or use the sandbox + your own address).
2. Publish an announcement as verified faculty (or insert directly):
   ```sql
   insert into public.announcements (author_id, title, body)
   values ('<faculty-user-uuid>', 'Email smoke test', 'It works.');
   ```
3. Confirm queueing:
   ```sql
   select status, count(*) from public.notification_email_outbox
   where source_type = 'announcement' group by status;
   ```
4. Invoke the function (§5) or wait for the webhook.
5. Confirm rows move to `sent` with `provider_message_id` populated, and
   the email arrives. Resend deduplicates on the idempotency key for 24 h,
   so re-invoking cannot double-send.

## What remains deployment-gated (could not be verified locally)

The local rehearsal (docker) verifies schema, triggers, RLS and queue
behaviour end to end, but **not** the live provider path: there is no Deno
runtime locally, no real Database Webhook firing, and no Resend account in
the loop. The steps above are the exact sequence that turns delivery on;
do not consider email live until §7 step 5 shows a received message.

## Policy note

These are **transactional community notifications** about newly published
announcements and events, on by default for members. They are not
marketing communications, and the default-on application setting is not
treated as legally valid marketing consent — no digest, campaign or
promotional mail may reuse this path.
