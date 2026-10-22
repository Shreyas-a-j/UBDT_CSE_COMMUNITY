import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { NextRequest } from 'next/server'
import { POST } from './route'

/**
 * R2 (S3 PutObject) rejects chunked PUTs with 411 MissingContentLength.
 * Next's route-handler fetch sends an ArrayBuffer body with
 * `Transfer-Encoding: chunked` unless Content-Length is set explicitly, so the
 * upload route must send it. This pins that contract.
 */
const state = vi.hoisted(() => ({
  fetch: vi.fn(),
  profile: { role: 'faculty', faculty_status: 'approved' } as Record<string, unknown> | null,
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: 'faculty-1' } }, error: null }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: state.profile, error: null }),
        }),
      }),
    }),
  }),
}))

vi.mock('aws4fetch', () => ({
  AwsClient: class {
    fetch = state.fetch
  },
}))

const ENV_KEYS = [
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_ACCOUNT_ID',
  'R2_BUCKET_NAME',
  'NEXT_PUBLIC_R2_PUBLIC_DOMAIN',
] as const

const previousEnv = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]))

function uploadRequest(bytes: number, type = 'image/png'): NextRequest {
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(bytes)], { type }), 'photo.png')
  return { formData: async () => form } as unknown as NextRequest
}

beforeEach(() => {
  process.env.R2_ACCESS_KEY_ID = 'test-key'
  process.env.R2_SECRET_ACCESS_KEY = 'test-secret'
  process.env.R2_ACCOUNT_ID = 'test-account'
  process.env.R2_BUCKET_NAME = 'test-bucket'
  process.env.NEXT_PUBLIC_R2_PUBLIC_DOMAIN = 'cdn.test'
  state.profile = { role: 'faculty', faculty_status: 'approved' }
  state.fetch.mockReset()
  state.fetch.mockResolvedValue(new Response('ok', { status: 200 }))
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (previousEnv[key] === undefined) delete process.env[key]
    else process.env[key] = previousEnv[key]
  }
})

describe('POST /api/announcements/upload', () => {
  it('sends Content-Length with the PUT so R2 does not reject it as chunked', async () => {
    const response = await POST(uploadRequest(5))

    expect(response.status).toBe(200)
    expect(state.fetch).toHaveBeenCalledTimes(1)

    const [, init] = state.fetch.mock.calls[0] as [
      string,
      { headers: Record<string, string>; body: ArrayBuffer },
    ]
    expect(init.headers['Content-Length']).toBe('5')
    expect(init.body.byteLength).toBe(5)
  })

  it('rejects a caller without faculty approval before touching storage', async () => {
    state.profile = { role: 'student', faculty_status: 'none' }

    const response = await POST(uploadRequest(5))

    expect(response.status).toBe(403)
    expect(state.fetch).not.toHaveBeenCalled()
  })
})
