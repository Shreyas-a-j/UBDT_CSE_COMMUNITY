// Supabase Edge Function: send-push-notifications
//
// Authenticated Android push worker for the durable
// public.notification_push_outbox queue.
//
// Invocation: Database Webhook on INSERT (header x-internal-secret) and/or
// a scheduled POST with the same header. Every invocation sweeps all due
// work, so missed webhooks and replays are harmless.
//
// Secrets:
//   PUSH_HOOK_SECRET           shared webhook secret (fail closed if unset)
//   ONESIGNAL_APP_ID           public app id (also embedded in the app)
//   ONESIGNAL_REST_API_KEY     server-only key
//   SUPABASE_SERVICE_ROLE_KEY  injected by Supabase
//   SUPABASE_URL               injected by Supabase
//
// Deploy:
//   supabase functions deploy send-push-notifications --no-verify-jwt
//
// Delivery is at-least-once with effectively-once provider behaviour:
//   * notification_id UNIQUE — one work item per in-app notification;
//   * CAS claim + stale reclaim — concurrent workers cannot own a row;
//   * OneSignal idempotency_key = outbox row UUID (valid 30 days);
//   * 200 + empty id means zero subscribed devices → skipped, never retried.

import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  classifyNetworkError,
  classifyResponse,
  idempotencyKey,
  isProviderConfigError,
  isTerminal,
  retryDelayMs,
  shouldSendPush,
  type PushDeliveryOutcome,
} from './policy.ts'
import { sendViaOneSignal } from './onesignal.ts'

interface OutboxRow {
  id: string
  notification_id: string | null
  user_id: string
  source_type: 'announcement' | 'event' | 'showcase_top2'
  source_id: string
  status: string
  attempts: number
}

interface NotificationRow {
  id: string
  user_id: string
  title: string
  body: string | null
  link: string | null
  content_type: string | null
  content_id: string | null
}

const STALE_CLAIM_MS = 5 * 60 * 1000
const BATCH_LIMIT = 25
const TERMINAL_PARK_MS = 365 * 24 * 60 * 60 * 1000
const CONFIG_ERROR_COOLDOWN_MS = 15 * 60 * 1000

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function env(name: string): string | null {
  return Deno.env.get(name) ?? null
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return json(405, { error: 'method not allowed' })
  }

  const hookSecret = env('PUSH_HOOK_SECRET')
  if (!hookSecret) {
    return json(500, { error: 'PUSH_HOOK_SECRET is not configured; refusing to deliver' })
  }
  if (req.headers.get('x-internal-secret') !== hookSecret) {
    return json(401, { error: 'unauthorized' })
  }

  const appId = env('ONESIGNAL_APP_ID')
  const apiKey = env('ONESIGNAL_REST_API_KEY')
  const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY')
  const supabaseUrl = env('SUPABASE_URL')
  if (!appId || !apiKey || !serviceKey || !supabaseUrl) {
    return json(500, {
      error:
        'missing configuration (need ONESIGNAL_APP_ID, ONESIGNAL_REST_API_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL)',
    })
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const now = Date.now()
  const nowIso = new Date(now).toISOString()
  const staleIso = new Date(now - STALE_CLAIM_MS).toISOString()

  const ROW_COLUMNS =
    'id, notification_id, user_id, source_type, source_id, status, attempts, next_attempt_at, locked_at'

  const [pendingRes, failedRes, staleRes] = await Promise.all([
    admin
      .from('notification_push_outbox')
      .select(ROW_COLUMNS)
      .eq('status', 'pending')
      .is('finished_at', null)
      .lte('next_attempt_at', nowIso)
      .order('next_attempt_at', { ascending: true })
      .limit(BATCH_LIMIT),
    admin
      .from('notification_push_outbox')
      .select(ROW_COLUMNS)
      .eq('status', 'failed')
      .is('finished_at', null)
      .lte('next_attempt_at', nowIso)
      .order('next_attempt_at', { ascending: true })
      .limit(BATCH_LIMIT),
    admin
      .from('notification_push_outbox')
      .select(ROW_COLUMNS)
      .eq('status', 'sending')
      .is('finished_at', null)
      .lte('locked_at', staleIso)
      .order('locked_at', { ascending: true })
      .limit(BATCH_LIMIT),
  ])

  if (pendingRes.error || failedRes.error || staleRes.error) {
    return json(500, {
      error: `push outbox read failed: ${
        pendingRes.error?.message ?? failedRes.error?.message ?? staleRes.error?.message
      }`,
    })
  }

  type Candidate = OutboxRow & { next_attempt_at: string; locked_at: string | null }
  const due = ([
    ...(pendingRes.data ?? []),
    ...(failedRes.data ?? []),
    ...(staleRes.data ?? []),
  ] as Candidate[])
    .sort((a, b) => a.next_attempt_at.localeCompare(b.next_attempt_at))
    .slice(0, BATCH_LIMIT)

  let sent = 0
  let retried = 0
  let terminal = 0
  let skipped = 0
  let lostRace = 0
  let abortedForConfig = false

  for (const row of due) {
    const claim = admin
      .from('notification_push_outbox')
      .update({
        status: 'sending',
        locked_at: nowIso,
        attempts: row.attempts + 1,
        finished_at: null,
      })
      .eq('id', row.id)

    if (row.status === 'failed') {
      claim.eq('status', 'failed').lte('next_attempt_at', nowIso)
    } else if (row.status === 'sending') {
      claim.eq('status', 'sending').lte('locked_at', staleIso)
    } else {
      claim.eq('status', 'pending').lte('next_attempt_at', nowIso)
    }

    const { data: claimed, error: claimError } = await claim.select('id')
    if (claimError) {
      console.error(`push claim failed for ${row.id}: ${claimError.message}`)
      continue
    }
    if (!claimed || claimed.length === 0) {
      lostRace += 1
      continue
    }

    const attempts = row.attempts + 1

    // `row.attempts` is the count already consumed. A row that already has
    // MAX_ATTEMPTS (for example a stale `sending` row) is parked without a
    // new provider call; a row on attempt 4 still gets its fifth and final
    // send, then the failure branch below parks it.
    if (isTerminal(row.attempts)) {
      terminal += 1
      const { error: fenceError } = await admin
        .from('notification_push_outbox')
        .update({
          status: 'failed',
          last_error: `abandoned after ${attempts} attempts (worker crashed before settling)`,
          next_attempt_at: new Date(now + TERMINAL_PARK_MS).toISOString(),
          locked_at: null,
          finished_at: nowIso,
        })
        .eq('id', row.id)
        .eq('status', 'sending')
        .eq('locked_at', nowIso)
      if (fenceError) console.error(`push fence failed for ${row.id}: ${fenceError.message}`)
      continue
    }

    let finish: {
      status: string
      last_error: string | null
      nextAttemptIso: string
      finishedAt: string | null
      sentAt?: string
      providerMessageId?: string
    }

    const notificationResult = row.notification_id
      ? await admin
          .from('notifications')
          .select('id, user_id, title, body, link, content_type, content_id')
          .eq('id', row.notification_id)
          .maybeSingle<NotificationRow>()
      : { data: null, error: null }

    const notification = notificationResult.data
    const notificationError = notificationResult.error

    if (!row.notification_id || notificationError || !notification || notification.user_id !== row.user_id) {
      skipped += 1
      finish = {
        status: 'skipped',
        last_error: !row.notification_id
          ? 'notification no longer exists'
          : notificationError
            ? `notification read failed: ${notificationError.message}`
            : 'notification no longer exists or belongs to another user',
        nextAttemptIso: nowIso,
        finishedAt: nowIso,
      }
    } else {
      const { data: authData, error: authError } = await admin.auth.admin.getUserById(row.user_id)
      const authUser = authData?.user
      const deletedAt = (authUser as { deleted_at?: string | null } | undefined)?.deleted_at

      if (authError || !authUser) {
        skipped += 1
        finish = {
          status: 'skipped',
          last_error: 'recipient account not found',
          nextAttemptIso: nowIso,
          finishedAt: nowIso,
        }
      } else if ((authUser.banned_until && authUser.banned_until > nowIso) || deletedAt) {
        skipped += 1
        finish = {
          status: 'skipped',
          last_error: 'recipient is banned or deleted',
          nextAttemptIso: nowIso,
          finishedAt: nowIso,
        }
      } else {
        const { data: pref, error: prefError } = await admin
          .from('notification_preferences')
          .select('push_enabled')
          .eq('user_id', row.user_id)
          .maybeSingle()

        if (prefError) {
          retried += 1
          finish = {
            status: 'failed',
            last_error: `preference read failed (will retry): ${prefError.message}`,
            nextAttemptIso: new Date(now + retryDelayMs(attempts)).toISOString(),
            finishedAt: null,
          }
        } else if (!shouldSendPush(pref)) {
          skipped += 1
          finish = {
            status: 'skipped',
            last_error: 'push disabled by user preference',
            nextAttemptIso: nowIso,
            finishedAt: nowIso,
          }
        } else {
          const transport = await sendViaOneSignal(
            { appId, apiKey },
            {
              userId: row.user_id,
              outboxId: idempotencyKey(row.id),
              notificationId: notification.id,
              title: notification.title,
              body: notification.body || notification.title,
              contentType: notification.content_type,
              contentId: notification.content_id,
              link: notification.link,
            },
          )

          if (transport.kind === 'response' && isProviderConfigError(transport.status)) {
            abortedForConfig = true
            finish = {
              status: 'pending',
              last_error: `OneSignal auth/config error (${transport.status}); sweep aborted, will retry`,
              nextAttemptIso: new Date(now + CONFIG_ERROR_COOLDOWN_MS).toISOString(),
              finishedAt: null,
            }
          } else {
            const outcome: PushDeliveryOutcome =
              transport.kind === 'network-error'
                ? classifyNetworkError(new Error(transport.message))
                : classifyResponse(transport.status, transport.body)

            if (outcome.action === 'accepted') {
              sent += 1
              finish = {
                status: 'sent',
                last_error: null,
                nextAttemptIso: nowIso,
                finishedAt: nowIso,
                sentAt: nowIso,
                providerMessageId: outcome.messageId,
              }
            } else if (outcome.action === 'no-subscribers') {
              skipped += 1
              finish = {
                status: 'skipped',
                last_error: outcome.reason,
                nextAttemptIso: nowIso,
                finishedAt: nowIso,
              }
            } else if (outcome.action === 'permanent') {
              terminal += 1
              finish = {
                status: 'failed',
                last_error: outcome.reason,
                nextAttemptIso: new Date(now + TERMINAL_PARK_MS).toISOString(),
                finishedAt: nowIso,
              }
            } else if (isTerminal(attempts)) {
              terminal += 1
              finish = {
                status: 'failed',
                last_error: `${outcome.reason} (giving up after ${attempts} attempts)`,
                nextAttemptIso: new Date(now + TERMINAL_PARK_MS).toISOString(),
                finishedAt: nowIso,
              }
            } else {
              retried += 1
              finish = {
                status: 'failed',
                last_error: outcome.reason,
                nextAttemptIso: new Date(now + retryDelayMs(attempts)).toISOString(),
                finishedAt: null,
              }
            }
          }
        }
      }
    }

    const { error: settleError } = await admin
      .from('notification_push_outbox')
      .update({
        status: finish.status,
        last_error: finish.last_error,
        next_attempt_at: finish.nextAttemptIso,
        locked_at: null,
        finished_at: finish.finishedAt,
        provider: 'onesignal',
        ...(finish.sentAt ? { sent_at: finish.sentAt } : {}),
        ...(finish.providerMessageId
          ? { provider_message_id: finish.providerMessageId }
          : {}),
      })
      .eq('id', row.id)
      .eq('status', 'sending')
      .eq('locked_at', nowIso)

    if (settleError) {
      console.error(`push settle failed for ${row.id}: ${settleError.message}`)
    }
    if (abortedForConfig) break
  }

  return json(200, {
    ok: true,
    candidates: due.length,
    sent,
    retried,
    terminal,
    skipped,
    lostRace,
  })
})
