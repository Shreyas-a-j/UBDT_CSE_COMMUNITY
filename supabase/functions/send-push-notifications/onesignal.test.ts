import { describe, expect, it, vi } from 'vitest'

import { sendViaOneSignal, type PushRequest } from './onesignal'

const request: PushRequest = {
  userId: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
  outboxId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  title: 'New announcement: Hello',
  body: 'A new faculty announcement was published.',
  notificationId: '8a7d6c5b-4a39-4281-9f0e-1d2c3b4a5968',
  contentType: 'announcement',
  contentId: '1b2c3d4e-5f60-4718-9a2b-3c4d5e6f7081',
  link: '/announcements#announcement-1b2c3d4e-5f60-4718-9a2b-3c4d5e6f7081',
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('OneSignal transport', () => {
  it('posts an external-id push with server auth and the outbox idempotency key', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { id: 'os-1', recipients: 2 }))

    const result = await sendViaOneSignal(
      { appId: 'app-public-id', apiKey: 'server-secret', fetchImpl },
      request,
    )

    expect(result).toEqual({ kind: 'response', status: 200, body: { id: 'os-1', recipients: 2 } })
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://api.onesignal.com/notifications')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Key server-secret')
    expect(init.headers['Content-Type']).toBe('application/json')

    const body = JSON.parse(init.body)
    expect(body.app_id).toBe('app-public-id')
    expect(body.include_aliases).toEqual({ external_id: [request.userId] })
    expect(body.target_channel).toBe('push')
    expect(body.idempotency_key).toBe(request.outboxId)
    expect(body.headings).toEqual({ en: request.title })
    expect(body.contents).toEqual({ en: request.body })
    expect(body.data).toEqual({
      notification_id: request.notificationId,
      content_type: request.contentType,
      content_id: request.contentId,
      link: request.link,
    })
    expect(JSON.stringify(body)).not.toContain('@')
    expect(body).not.toHaveProperty('include_email_tokens')
  })

  it('passes provider errors through for classification', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(429, { errors: ['throttled'] }))
    const result = await sendViaOneSignal(
      { appId: 'app', apiKey: 'key', fetchImpl },
      request,
    )
    expect(result).toEqual({ kind: 'response', status: 429, body: { errors: ['throttled'] } })
  })

  it('reports network failures without throwing', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('socket closed'))
    const result = await sendViaOneSignal(
      { appId: 'app', apiKey: 'key', fetchImpl },
      request,
    )
    expect(result.kind).toBe('network-error')
    if (result.kind === 'network-error') expect(result.message).toContain('socket closed')
  })

  it('tolerates non-JSON error bodies', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('<html>bad gateway</html>', { status: 502 }))
    const result = await sendViaOneSignal(
      { appId: 'app', apiKey: 'key', fetchImpl },
      request,
    )
    expect(result).toEqual({ kind: 'response', status: 502, body: null })
  })
})
