// Resend transport adapter — the only file that knows the provider's
// HTTP shape. Everything else in the worker speaks DeliveryOutcome, so
// swapping providers means replacing this file.
//
// Pure module (injectable fetch): unit-tested under Node by vitest.

import type { ProviderResponseBody } from './policy'

export interface ResendConfig {
  apiKey: string
  /** Default From header, e.g. 'UBDT CSE Community <onboarding@resend.dev>'. */
  from: string
  /** Injected for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch
}

export interface SendPayload {
  to: string
  subject: string
  html: string
  text: string
  /** Deterministic per outbox row (see policy.idempotencyKey). */
  idempotencyKey: string
}

export type TransportResult =
  | { kind: 'response'; status: number; body: ProviderResponseBody | null }
  | { kind: 'network-error'; message: string }

const RESEND_ENDPOINT = 'https://api.resend.com/emails'

export async function sendViaResend(
  config: ResendConfig,
  payload: SendPayload,
): Promise<TransportResult> {
  const doFetch = config.fetchImpl ?? fetch
  try {
    const response = await doFetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        // Provider-side deduplication window: 24h (Resend docs).
        'Idempotency-Key': payload.idempotencyKey,
      },
      body: JSON.stringify({
        from: config.from,
        to: [payload.to],
        subject: payload.subject,
        html: payload.html,
        text: payload.text,
      }),
    })

    let body: ProviderResponseBody | null = null
    try {
      body = (await response.json()) as ProviderResponseBody
    } catch {
      body = null
    }
    return { kind: 'response', status: response.status, body }
  } catch (err) {
    return {
      kind: 'network-error',
      message: err instanceof Error ? err.message : String(err),
    }
  }
}
