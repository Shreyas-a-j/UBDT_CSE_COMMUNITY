// Delivery policy for the Android push worker.
//
// Pure module: no Deno APIs. Every retry/terminal/skip decision is made
// here so the worker loop stays boring and the semantics stay tested.

export interface PushPreferenceLike {
  push_enabled?: boolean | null
}

/** Missing preference row = enabled. Only an explicit false opts out. */
export function shouldSendPush(pref: PushPreferenceLike | null | undefined): boolean {
  if (!pref) return true
  return pref.push_enabled !== false
}

export type PushDeliveryOutcome =
  | { action: 'accepted'; messageId: string }
  | { action: 'no-subscribers'; reason: string }
  | { action: 'retry'; reason: string }
  | { action: 'permanent'; reason: string }

export interface OneSignalResponseBody {
  id?: string
  recipients?: number
  errors?: unknown
  warnings?: unknown
}

export const MAX_ATTEMPTS = 5

const BASE_RETRY_MS = 60_000
const MAX_RETRY_MS = 3_600_000

/**
 * OneSignal returns HTTP 200 with an empty `id` when no subscribed device
 * matched the external_id. That is a deterministic no-op, not a failure:
 * retrying would never help, and marking it terminal would look like an
 * outage.
 */
export function classifyResponse(
  status: number,
  body: OneSignalResponseBody | null,
): PushDeliveryOutcome {
  if (status >= 200 && status < 300) {
    const messageId = body?.id?.trim() ?? ''
    if (messageId) return { action: 'accepted', messageId }
    return {
      action: 'no-subscribers',
      reason: 'no subscribed Android devices matched this user',
    }
  }
  if (status === 429) {
    return { action: 'retry', reason: 'OneSignal throttled the request (429)' }
  }
  if (status >= 500) {
    return { action: 'retry', reason: `OneSignal provider error (${status})` }
  }
  return {
    action: 'permanent',
    reason: `OneSignal rejected the request (${status})`,
  }
}

export function classifyNetworkError(err: unknown): PushDeliveryOutcome {
  const message = err instanceof Error ? err.message : String(err)
  return { action: 'retry', reason: `network error: ${message}` }
}

/** 401/403 are deployment problems: abort the sweep and cool down. */
export function isProviderConfigError(status: number): boolean {
  return status === 401 || status === 403
}

/** Exponential backoff: 1m, 2m, 4m, ... capped at one hour. */
export function retryDelayMs(attempts: number): number {
  const exponent = Math.max(attempts - 1, 0)
  return Math.min(BASE_RETRY_MS * 2 ** exponent, MAX_RETRY_MS)
}

export function isTerminal(attempts: number): boolean {
  return attempts >= MAX_ATTEMPTS
}

/** OneSignal requires an RFC 9562 UUID; the outbox row id is exactly that. */
export function idempotencyKey(outboxRowId: string): string {
  return outboxRowId
}
