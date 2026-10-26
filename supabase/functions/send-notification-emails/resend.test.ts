import { describe, expect, it, vi } from 'vitest'
import { sendViaResend, type SendPayload } from './resend'

const payload: SendPayload = {
  to: 'member@example.com',
  subject: 'New announcement: Hello',
  html: '<p>Hello</p>',
  text: 'Hello',
  idempotencyKey: 'ucc2-publish-email-row-1',
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('resend: transport', () => {
  it('posts the full payload with auth and idempotency headers', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { id: 'msg_1' }))

    const result = await sendViaResend(
      { apiKey: 're_secret_123', from: 'UBDT CSE <no-reply@example.com>', fetchImpl },
      payload,
    )

    expect(result).toEqual({ kind: 'response', status: 200, body: { id: 'msg_1' } })
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://api.resend.com/emails')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer re_secret_123')
    expect(init.headers['Idempotency-Key']).toBe('ucc2-publish-email-row-1')

    const body = JSON.parse(init.body)
    expect(body).toEqual({
      from: 'UBDT CSE <no-reply@example.com>',
      to: ['member@example.com'],
      subject: payload.subject,
      html: payload.html,
      text: payload.text,
    })
  })

  it('passes provider error responses through for classification', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(429, { message: 'rate limited' }),
    )
    const result = await sendViaResend(
      { apiKey: 'k', from: 'f', fetchImpl },
      payload,
    )
    expect(result).toEqual({
      kind: 'response',
      status: 429,
      body: { message: 'rate limited' },
    })
  })

  it('reports network failures without throwing', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('fetch failed'))
    const result = await sendViaResend(
      { apiKey: 'k', from: 'f', fetchImpl },
      payload,
    )
    expect(result.kind).toBe('network-error')
    if (result.kind === 'network-error') {
      expect(result.message).toContain('fetch failed')
    }
  })

  it('tolerates a non-JSON error body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response('<html>gateway error</html>', { status: 502 }),
    )
    const result = await sendViaResend(
      { apiKey: 'k', from: 'f', fetchImpl },
      payload,
    )
    expect(result).toEqual({ kind: 'response', status: 502, body: null })
  })
})
