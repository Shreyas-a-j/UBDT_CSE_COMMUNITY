import { describe, expect, it } from 'vitest'
import {
  MAX_ATTEMPTS,
  classifyNetworkError,
  classifyResponse,
  idempotencyKey,
  isProviderConfigError,
  isTerminal,
  retryDelayMs,
  shouldSendEmail,
} from './policy'

describe('policy: opt-out decision', () => {
  it('policy: missing preference row means send (default-on)', () => {
    expect(shouldSendEmail(null)).toBe(true)
    expect(shouldSendEmail(undefined)).toBe(true)
    expect(shouldSendEmail({} as { email_enabled?: boolean })).toBe(true)
  })

  it('policy: opted out means skip', () => {
    expect(shouldSendEmail({ email_enabled: false })).toBe(false)
  })

  it('an explicit true means send', () => {
    expect(shouldSendEmail({ email_enabled: true })).toBe(true)
  })
})

describe('policy: response classification', () => {
  it('2xx with a provider id is an accepted send', () => {
    const outcome = classifyResponse(200, { id: 'resend-123' })
    expect(outcome).toEqual({ action: 'accepted', messageId: 'resend-123' })
  })

  it('policy: transient errors retry (429 and 5xx)', () => {
    expect(classifyResponse(429, null).action).toBe('retry')
    expect(classifyResponse(500, null).action).toBe('retry')
    expect(classifyResponse(502, null).action).toBe('retry')
    expect(classifyResponse(503, null).action).toBe('retry')
  })

  it('policy: permanent errors stop retrying (other 4xx)', () => {
    expect(classifyResponse(400, null).action).toBe('permanent')
    expect(classifyResponse(401, null).action).toBe('permanent')
    expect(classifyResponse(403, null).action).toBe('permanent')
    expect(classifyResponse(404, null).action).toBe('permanent')
    expect(classifyResponse(422, null).action).toBe('permanent')
  })

  it('network failures are retryable', () => {
    expect(classifyNetworkError(new Error('fetch failed')).action).toBe('retry')
  })

  it('flags provider auth/config errors for batch abort (401/403 only)', () => {
    expect(isProviderConfigError(401)).toBe(true)
    expect(isProviderConfigError(403)).toBe(true)
    // ordinary per-row failures must NOT abort the batch
    expect(isProviderConfigError(400)).toBe(false)
    expect(isProviderConfigError(422)).toBe(false)
    expect(isProviderConfigError(429)).toBe(false)
    expect(isProviderConfigError(500)).toBe(false)
  })
})

describe('policy: retry schedule', () => {
  it('backoff doubles per attempt and caps at one hour', () => {
    expect(retryDelayMs(1)).toBe(60_000)
    expect(retryDelayMs(2)).toBe(120_000)
    expect(retryDelayMs(3)).toBe(240_000)
    expect(retryDelayMs(20)).toBe(3_600_000)
  })

  it('marks the row terminal once attempts reach the maximum', () => {
    expect(isTerminal(MAX_ATTEMPTS - 1)).toBe(false)
    expect(isTerminal(MAX_ATTEMPTS)).toBe(true)
    expect(isTerminal(MAX_ATTEMPTS + 1)).toBe(true)
  })
})

describe('idempotency: key derived from outbox row id', () => {
  it('is deterministic per row and embeds the row id', () => {
    const rowId = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d'
    const key = idempotencyKey(rowId)
    expect(key).toBe(idempotencyKey(rowId))
    expect(key).toContain(rowId)
    expect(idempotencyKey('other-row')).not.toBe(key)
  })
})
