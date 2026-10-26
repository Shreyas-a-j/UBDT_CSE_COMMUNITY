import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { NextRequest } from 'next/server'
import { DELETE } from './route'

/**
 * The delete route is the trusted half of announcement deletion: it re-reads
 * the row and the caller's role, then deletes through the user-scoped client
 * so RLS stays a second layer. Storage cleanup is best-effort and must never
 * turn a successful row deletion into a failed request.
 */
const state = vi.hoisted(() => ({
  user: null as null | { id: string },
  authError: null as null | { message: string },
  row: null as null | Record<string, unknown>,
  readError: null as null | { message: string },
  recheckRow: null as null | Record<string, unknown>,
  recheckError: null as null | { message: string },
  profile: null as null | Record<string, unknown>,
  profileError: null as null | { message: string },
  deletedRows: [] as Record<string, unknown>[],
  deleteError: null as null | { message: string },
  deletes: [] as string[],
}))

const deleteR2ObjectMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => makeClient(),
}))

vi.mock('@/lib/r2', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/r2')>()
  return { ...actual, deleteR2Object: deleteR2ObjectMock }
})

function makeClient() {
  // The route reads the row before deleting and again if the delete returns
  // zero rows, to distinguish "already gone" from "RLS filtered the delete".
  let announcementReads = 0
  return {
    auth: {
      getUser: async () => ({ data: { user: state.user }, error: state.authError }),
    },
    from(table: string) {
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: state.profile, error: state.profileError }),
            }),
          }),
        }
      }
      if (table === 'announcements') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => {
                const first = announcementReads === 0
                announcementReads += 1
                return first
                  ? { data: state.row, error: state.readError }
                  : { data: state.recheckRow, error: state.recheckError }
              },
            }),
          }),
          delete: () => ({
            eq: (_column: string, value: string) => {
              state.deletes.push(value)
              return {
                select: async () => ({ data: state.deletedRows, error: state.deleteError }),
              }
            },
          }),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    },
  }
}

const ANNOUNCEMENT_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'
const AUTHOR_ID = 'faculty-1'

function remove(id = ANNOUNCEMENT_ID) {
  const request = new Request(`http://localhost/api/announcements/${id}`, {
    method: 'DELETE',
  }) as unknown as NextRequest
  return DELETE(request, { params: Promise.resolve({ id }) })
}

function announcementRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ANNOUNCEMENT_ID,
    author_id: AUTHOR_ID,
    image_urls: [] as string[],
    ...overrides,
  }
}

beforeEach(() => {
  state.user = null
  state.authError = null
  state.row = null
  state.readError = null
  state.recheckRow = null
  state.recheckError = null
  state.profile = null
  state.profileError = null
  state.deletedRows = []
  state.deleteError = null
  state.deletes = []
  deleteR2ObjectMock.mockReset()
  deleteR2ObjectMock.mockResolvedValue({ ok: true })

  vi.stubEnv('R2_ACCESS_KEY_ID', 'test-key')
  vi.stubEnv('R2_SECRET_ACCESS_KEY', 'test-secret')
  vi.stubEnv('R2_ACCOUNT_ID', 'test-account')
  vi.stubEnv('R2_BUCKET_NAME', 'test-bucket')
  vi.stubEnv('NEXT_PUBLIC_R2_PUBLIC_DOMAIN', 'cdn.test')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('DELETE /api/announcements/[id]', () => {
  it('rejects a signed-out caller with 401 and never deletes', async () => {
    const response = await remove()

    expect(response.status).toBe(401)
    expect(state.deletes).toHaveLength(0)
  })

  it('rejects an empty id with 400', async () => {
    const response = await remove('')

    expect(response.status).toBe(400)
    expect(state.deletes).toHaveLength(0)
  })

  it.each([
    ['a non-UUID string', 'not-a-uuid'],
    ['a UUID with a non-hex character', 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5g'],
    ['a truncated UUID', 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5'],
    ['a path traversal segment', '../../etc/passwd'],
  ])('rejects %s with 400 before any lookup', async (_label, id) => {
    const response = await remove(id)

    expect(response.status).toBe(400)
    expect(state.deletes).toHaveLength(0)
  })

  it('returns 404 when the announcement does not exist', async () => {
    state.user = { id: AUTHOR_ID }
    state.row = null

    const response = await remove()

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({
      error: 'This announcement is already gone.',
    })
    expect(state.deletes).toHaveLength(0)
  })

  it('rejects a different student with 403', async () => {
    state.user = { id: 'student-1' }
    state.row = announcementRow()
    state.profile = { role: 'student' }

    const response = await remove()

    expect(response.status).toBe(403)
    expect(state.deletes).toHaveLength(0)
  })

  it('rejects a different faculty member with 403', async () => {
    state.user = { id: 'faculty-2' }
    state.row = announcementRow()
    state.profile = { role: 'faculty' }

    const response = await remove()

    expect(response.status).toBe(403)
    expect(state.deletes).toHaveLength(0)
  })

  it('deletes for the author and reports the deleted row', async () => {
    state.user = { id: AUTHOR_ID }
    state.row = announcementRow()
    state.profile = { role: 'faculty' }
    state.deletedRows = [{ id: ANNOUNCEMENT_ID }]

    const response = await remove()

    expect(response.status).toBe(200)
    expect(state.deletes).toEqual([ANNOUNCEMENT_ID])
    await expect(response.json()).resolves.toMatchObject({ deleted: true })
  })

  it('deletes for an admin who is not the author', async () => {
    state.user = { id: 'admin-1' }
    state.row = announcementRow()
    state.profile = { role: 'admin' }
    state.deletedRows = [{ id: ANNOUNCEMENT_ID }]

    const response = await remove()

    expect(response.status).toBe(200)
    expect(state.deletes).toEqual([ANNOUNCEMENT_ID])
  })

  it('returns 404 when the delete returns zero rows and the row is gone', async () => {
    state.user = { id: AUTHOR_ID }
    state.row = announcementRow()
    state.profile = { role: 'faculty' }
    state.deletedRows = []
    state.recheckRow = null

    const response = await remove()

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({
      error: 'This announcement is already gone.',
    })
  })

  it('returns 409 when the delete is filtered but the row still exists', async () => {
    state.user = { id: AUTHOR_ID }
    state.row = announcementRow()
    state.profile = { role: 'faculty' }
    state.deletedRows = []
    // PostgREST silently filters a DELETE without a matching policy to zero
    // rows. The follow-up read still finds the row, so this is a failure, not
    // "already gone": the UI must keep the row and show an error.
    state.recheckRow = { id: ANNOUNCEMENT_ID }

    const response = await remove()

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringMatching(/could not be deleted/i),
    })
  })

  it('returns 500 when the post-delete existence check fails', async () => {
    state.user = { id: AUTHOR_ID }
    state.row = announcementRow()
    state.profile = { role: 'faculty' }
    state.deletedRows = []
    state.recheckError = { message: 'read failed' }

    const response = await remove()

    expect(response.status).toBe(500)
  })

  it('counts a non-R2 image URL as skipped, not failed', async () => {
    state.user = { id: AUTHOR_ID }
    state.row = announcementRow({ image_urls: ['https://evil.test/announcements/one.png'] })
    state.profile = { role: 'faculty' }
    state.deletedRows = [{ id: ANNOUNCEMENT_ID }]

    const response = await remove()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      deleted: true,
      imagesDeleted: 0,
      imagesFailed: 0,
      imagesSkipped: 1,
      imageCleanupError: null,
    })
    expect(deleteR2ObjectMock).not.toHaveBeenCalled()
  })

  it('keeps the deletion successful when R2 delete fails', async () => {
    state.user = { id: AUTHOR_ID }
    state.row = announcementRow({ image_urls: ['https://cdn.test/announcements/one.png'] })
    state.profile = { role: 'faculty' }
    state.deletedRows = [{ id: ANNOUNCEMENT_ID }]
    deleteR2ObjectMock.mockResolvedValue({ ok: false, error: 'Storage delete failed (500).' })

    const response = await remove()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      deleted: true,
      imagesDeleted: 0,
      imagesFailed: 1,
      imagesSkipped: 0,
      imageCleanupError: 'Storage delete failed (500).',
    })
  })

  it('deletes the row even when storage configuration is missing', async () => {
    vi.stubEnv('R2_ACCESS_KEY_ID', '')
    state.user = { id: AUTHOR_ID }
    state.row = announcementRow({ image_urls: ['https://cdn.test/announcements/one.png'] })
    state.profile = { role: 'faculty' }
    state.deletedRows = [{ id: ANNOUNCEMENT_ID }]

    const response = await remove()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      deleted: true,
      imagesFailed: 1,
      imageCleanupError: 'Server storage configuration is missing.',
    })
    expect(state.deletes).toEqual([ANNOUNCEMENT_ID])
    expect(deleteR2ObjectMock).not.toHaveBeenCalled()
  })

  it('skips a path-traversal URL and never passes it to storage', async () => {
    state.user = { id: AUTHOR_ID }
    state.row = announcementRow({
      image_urls: ['https://cdn.test/announcements/../secret'],
    })
    state.profile = { role: 'faculty' }
    state.deletedRows = [{ id: ANNOUNCEMENT_ID }]

    const response = await remove()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      deleted: true,
      imagesSkipped: 1,
      imagesFailed: 0,
    })
    expect(deleteR2ObjectMock).not.toHaveBeenCalled()
  })
})
