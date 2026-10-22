import { describe, it, expect, beforeEach, vi } from 'vitest'
import { POST } from './route'

/**
 * The publish route is the trusted half of the announcement permission model:
 * it re-reads the caller's database profile and rejects anyone who is not
 * verified faculty, regardless of what the client claims. These tests pin the
 * 401/403/400/201 contract.
 */
const state = vi.hoisted(() => ({
  user: null as null | { id: string },
  authError: null as null | { message: string },
  profile: null as null | Record<string, unknown>,
  profileError: null as null | { message: string },
  createdRow: null as null | Record<string, unknown>,
  insertError: null as null | { message: string },
  inserts: [] as Record<string, unknown>[],
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => makeClient(),
}))

function resultFor(record: { table: string }) {
  if (record.table === 'profiles') {
    return { data: state.profile, error: state.profileError }
  }
  if (record.table === 'announcements') {
    return { data: state.createdRow, error: state.insertError }
  }
  return { data: null, error: null }
}

function makeClient() {
  return {
    auth: {
      getUser: async () => ({ data: { user: state.user }, error: state.authError }),
    },
    from(table: string) {
      const record = { table }
      const proxy: unknown = new Proxy(
        {},
        {
          get(_target, property) {
            const name = String(property)
            if (name === 'then') {
              return (resolve: (value: unknown) => void) => resolve(resultFor(record))
            }
            return (...args: unknown[]) => {
              if (name === 'insert') {
                state.inserts.push(args[0] as Record<string, unknown>)
              }
              return proxy
            }
          },
        }
      )
      return proxy
    },
  }
}

function publish(body: unknown) {
  return POST(
    new Request('http://localhost/api/announcements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  )
}

const verifiedFaculty = { role: 'faculty', faculty_status: 'verified' }

beforeEach(() => {
  state.user = null
  state.authError = null
  state.profile = null
  state.profileError = null
  state.createdRow = null
  state.insertError = null
  state.inserts = []
})

describe('POST /api/announcements', () => {
  it('rejects a signed-out caller with 401 and never inserts', async () => {
    const response = await publish({ title: 'Hi', body: 'There' })

    expect(response.status).toBe(401)
    expect(state.inserts).toHaveLength(0)
  })

  it('rejects a student with 403', async () => {
    state.user = { id: 'u1' }
    state.profile = { role: 'student', faculty_status: null }

    const response = await publish({ title: 'Hi', body: 'There' })

    expect(response.status).toBe(403)
    expect(state.inserts).toHaveLength(0)
  })

  it('rejects alumni with 403', async () => {
    state.user = { id: 'u1' }
    state.profile = { role: 'alumni', faculty_status: null }

    expect((await publish({ title: 'Hi', body: 'There' })).status).toBe(403)
  })

  it('rejects an unverified faculty applicant with 403', async () => {
    state.user = { id: 'u1' }
    state.profile = { role: 'faculty', faculty_status: 'pending' }

    expect((await publish({ title: 'Hi', body: 'There' })).status).toBe(403)
    expect(state.inserts).toHaveLength(0)
  })

  it('rejects the real pending signup shape: student role, pending faculty status', async () => {
    // This is exactly what handle_new_user() writes for a faculty-intent
    // signup. The account is a normal student until an admin approves it.
    state.user = { id: 'pending-1' }
    state.profile = { role: 'student', faculty_status: 'pending' }

    expect((await publish({ title: 'Hi', body: 'There' })).status).toBe(403)
    expect(state.inserts).toHaveLength(0)
  })

  it('rejects a rejected applicant even if they claim member_type=faculty', async () => {
    state.user = { id: 'rejected-1' }
    state.profile = { role: 'student', faculty_status: 'rejected', member_type: 'faculty' }

    expect((await publish({ title: 'Hi', body: 'There' })).status).toBe(403)
    expect(state.inserts).toHaveLength(0)
  })

  it('rejects a student carrying an approved status without the faculty role', async () => {
    state.user = { id: 'u1' }
    state.profile = { role: 'student', faculty_status: 'approved' }

    expect((await publish({ title: 'Hi', body: 'There' })).status).toBe(403)
    expect(state.inserts).toHaveLength(0)
  })

  it('rejects a claimed faculty role with no verification status', async () => {
    state.user = { id: 'u1' }
    state.profile = { role: 'faculty' }

    expect((await publish({ title: 'Hi', body: 'There' })).status).toBe(403)
  })

  it('publishes for approved faculty (the live database vocabulary)', async () => {
    state.user = { id: 'faculty-approved' }
    state.profile = { role: 'faculty', faculty_status: 'approved' }
    state.createdRow = { id: 'a-approved' }

    const response = await publish({ title: 'Hi', body: 'There' })

    expect(response.status).toBe(201)
    expect(state.inserts[0]).toMatchObject({ author_id: 'faculty-approved' })
  })

  it('rejects rejected faculty with 403', async () => {
    state.user = { id: 'u1' }
    state.profile = { role: 'faculty', faculty_status: 'rejected' }

    expect((await publish({ title: 'Hi', body: 'There' })).status).toBe(403)
    expect(state.inserts).toHaveLength(0)
  })

  it('validates the title and the message', async () => {
    state.user = { id: 'u1' }
    state.profile = verifiedFaculty

    expect((await publish({ body: 'There' })).status).toBe(400)
    expect((await publish({ title: 'Hi' })).status).toBe(400)
    expect((await publish({ title: '   ', body: '   ' })).status).toBe(400)
    expect(state.inserts).toHaveLength(0)
  })

  it('rejects an image list that contains no usable URL', async () => {
    state.user = { id: 'u1' }
    state.profile = verifiedFaculty

    const response = await publish({
      title: 'Hi',
      body: 'There',
      image_urls: ['javascript:alert(1)', 'not-a-url'],
    })

    expect(response.status).toBe(400)
    expect(state.inserts).toHaveLength(0)
  })

  it('publishes for verified faculty with the trusted author id and sanitized content', async () => {
    state.user = { id: 'faculty-1' }
    state.profile = verifiedFaculty
    state.createdRow = { id: 'a1', title: 'Deadline extended', body: 'Submit by Friday.' }

    const response = await publish({
      title: '  Deadline extended  ',
      body: 'Submit by Friday.',
      image_urls: [
        'https://cdn.test/1.png',
        'https://cdn.test/2.png',
        'https://cdn.test/3.png',
        'https://cdn.test/4.png',
        'https://cdn.test/5.png',
        'javascript:alert(1)',
      ],
      // A client must not be able to choose the author or the shape of the row.
      author_id: 'someone-else',
      created_at: '1999-01-01T00:00:00.000Z',
    })

    expect(response.status).toBe(201)
    const payload = (await response.json()) as { announcement: { id: string } }
    expect(payload.announcement.id).toBe('a1')

    expect(state.inserts).toHaveLength(1)
    expect(state.inserts[0]).toMatchObject({
      author_id: 'faculty-1',
      title: 'Deadline extended',
      body: 'Submit by Friday.',
    })
    expect(state.inserts[0].image_urls).toEqual([
      'https://cdn.test/1.png',
      'https://cdn.test/2.png',
      'https://cdn.test/3.png',
      'https://cdn.test/4.png',
    ])
  })

  it('allows admins', async () => {
    state.user = { id: 'admin-1' }
    state.profile = { role: 'admin', faculty_status: null }
    state.createdRow = { id: 'a2' }

    expect((await publish({ title: 'Hi', body: 'There' })).status).toBe(201)
  })

  it('surfaces a profile read failure as 500 instead of assuming permission', async () => {
    state.user = { id: 'u1' }
    state.profileError = { message: 'boom' }

    expect((await publish({ title: 'Hi', body: 'There' })).status).toBe(500)
    expect(state.inserts).toHaveLength(0)
  })
})
