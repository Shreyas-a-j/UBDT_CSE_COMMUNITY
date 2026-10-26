// Delivery policy for the publish-email worker.
//
// Pure module: no Deno APIs — unit-tested under Node by vitest. Every
// decision the worker makes about a queued row goes through these
// functions so the retry/opt-out semantics are pinned by tests rather
// than buried in the worker loop.

/** Rows of public.notification_preferences; null/undefined = no row yet. */
export interface PreferenceLike {
  email_enabled?: boolean | null
}

/**
 * Default-on policy: a missing preference row means the user still
 * receives emails (coalesce semantics shared with the SQL side). Only
 * an explicit opt-out suppresses a send.
 */
export function shouldSendEmail(pref: PreferenceLike | null | undefined): boolean {
  if (!pref) return true
  return pref.email_enabled !== false
}

export type DeliveryOutcome =
  | { action: 'accepted'; messageId: string | null }
  | { action: 'retry'; reason: string }
  | { action: 'permanent'; reason: string }

export interface ProviderResponseBody {
  id?: string
  name?: string
  message?: string
}

/** Give up after this many attempts (row is marked failed, terminal). */
export const MAX_ATTEMPTS = 5

const BASE_RETRY_MS = 60_000 // 1 minute
const MAX_RETRY_MS = 3_600_000 // 1 hour

/**
 * Provider response → delivery decision.
 *   2xx with any body        → accepted (messageId when present)
 *   429 (throttle)           → retry
 *   5xx (provider outage)    → retry
 *   any other 4xx            → permanent (bad request/key/address)
 */
export function classifyResponse(
  status: number,
  body: ProviderResponseBody | null,
): DeliveryOutcome {
  if (status >= 200 && status < 300) {
    return { action: 'accepted', messageId: body?.id ?? null }
  }
  if (status === 429) {
    return { action: 'retry', reason: `provider throttled (429)` }
  }
  if (status >= 500) {
    return { action: 'retry', reason: `provider error (${status})` }
  }
  return {
    action: 'permanent',
    reason: `provider rejected the request (${status})${body?.message ? `: ${body.message}` : ''}`,
  }
}

/** Network-level failures (DNS, TLS, timeouts) are always retryable. */
export function classifyNetworkError(err: unknown): DeliveryOutcome {
  const message = err instanceof Error ? err.message : String(err)
  return { action: 'retry', reason: `network error: ${message}` }
}

/**
 * Provider auth/config errors (bad or rotated API key, unverified
 * sending domain). These are *deployment* problems, not per-row
 * problems: retrying or permanently parking each row would burn the
 * whole batch on one misconfiguration, so the worker aborts the sweep
 * and leaves the rows for a later, correctly-configured run.
 */
export function isProviderConfigError(status: number): boolean {
  return status === 401 || status === 403
}

/** Exponential backoff from the attempt number (1-based): 1m, 2m, 4m … capped at 1h. */
export function retryDelayMs(attempts: number): number {
  const exponent = Math.max(attempts - 1, 0)
  return Math.min(BASE_RETRY_MS * 2 ** exponent, MAX_RETRY_MS)
}

/** True when a failed row must not be retried again (attempts exhausted). */
export function isTerminal(attempts: number): boolean {
  return attempts >= MAX_ATTEMPTS
}

/**
 * Provider-side idempotency key, derived deterministically from the
 * outbox row id: a re-run of the same work item (crash between provider
 * acceptance and status update, replayed webhook, manual re-invoke)
 * resends the same key, and the provider suppresses the duplicate.
 */
export function idempotencyKey(outboxRowId: string): string {
  return `ucc2-publish-email-${outboxRowId}`
}
