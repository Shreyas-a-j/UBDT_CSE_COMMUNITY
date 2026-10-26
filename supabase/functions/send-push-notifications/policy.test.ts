import { describe, expect, it } from 'vitest'

import {
  MAX_ATTEMPTS,
  classifyNetworkError,
  classifyResponse,
  idempotencyKey,
  isProviderConfigError,
  isTerminal,
  retryDelayMs,
  shouldSendPush,
} from './policy'

describe('push policy: opt-in', () => {
  it('missing preference row means push is enabled by default', () => {
    expect(shouldSendPush(null)).toBe(true)
    expect(shouldSendPush(undefined)).toBe(true)
    expect(shouldSendPush({})).toBe(true)
  })

  it('explicit opt-out suppresses the push', () => {
    expect(shouldSendPush({ push_enabled: false })).toBe(false)
    expect(shouldSendPush({ push_enabled: true })).toBe(true)
  })
})

describe('push policy: provider response', () => {
  it('accepts a 2xx response with a OneSignal notification id', () => {
    expect(classifyResponse(200, { id: 'os-123' })).toEqual({
      action: 'accepted',
      messageId: 'os-123',
    })
  })

  it('treats an empty id as zero addressed subscribers, not a failure', () => {
    expect(classifyResponse(200, { id: '' })).toEqual({
      action: 'no-subscribers',
      reason: 'no subscribed Android devices matched this user',
    })
    expect(classifyResponse(200, {})).toEqual({
      action: 'no-subscribers',
      reason: 'no subscribed Android devices matched this user',
    })
  })

  it('retries throttling and provider outages', () => {
    expect(classifyResponse(429, null).action).toBe('retry')
    expect(classifyResponse(500, null).action).toBe('retry')
    expect(classifyResponse(503, null).action).toBe('retry')
  })

  it('parks other 4xx responses as permanent', () => {
    expect(classifyResponse(400, null).action).toBe('permanent')
    expect(classifyResponse(404, null).action).toBe('permanent')
    expect(classifyResponse(422, null).action).toBe('permanent')
  })

  it('retries network failures', () => {
    expect(classifyNetworkError(new Error('offline')).action).toBe('retry')
  })

  it('flags 401/403 as deployment configuration errors', () => {
    expect(isProviderConfigError(401)).toBe(true)
    expect(isProviderConfigError(403)).toBe(true)
    expect(isProviderConfigError(429)).toBe(false)
    expect(isProviderConfigError(500)).toBe(false)
  })
})

describe('push policy: retries and idempotency', () => {
  it('uses exponential backoff capped at one hour', () => {
    expect(retryDelayMs(1)).toBe(60_000)
    expect(retryDelayMs(2)).toBe(120_000)
    expect(retryDelayMs(20)).toBe(3_600_000)
  })

  it('terminates at the maximum number of attempts', () => {
    expect(isTerminal(MAX_ATTEMPTS - 1)).toBe(false)
    expect(isTerminal(MAX_ATTEMPTS)).toBe(true)
  })

  it('uses the outbox row UUID as the OneSignal idempotency key', () => {
    const rowId = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d'
    expect(idempotencyKey(rowId)).toBe(rowId)
    expect(idempotencyKey('3f2504e0-4f89-41d3-9a0c-0305e82c3301')).toBe(
      '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
    )
  })
})
