import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from './route'

/**
 * The admin approval API is a second entry point to the same database action
 * as the admin dashboard. It re-reads the caller's role on the server, so a
 * hidden UI button is not the security boundary. RLS and
 * enforce_faculty_application_transition() remain the final gate.
 */

const state = vi.hoisted(() => ({
  user: null as null | { id: string },
  profile: null as null | { role: string },
  updateError: null as null | { message: string },
  updated: null as null | Record<string, unknown>,
  updates: [] as Record<string, unknown>[],
  eqs: [] as Array<[string, unknown]>,
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: state.user }, error: null }),
    },
    from(table: string) {
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: state.profile, error: null }),
            }),
          }),
        }
      }

      return {
        update(payload: Record<string, unknown>) {
          state.updates.push(payload)
          return {
            eq(column: string, value: unknown) {
              state.eqs.push([column, value])
              return {
                eq(nextColumn: string, nextValue: unknown) {
                  state.eqs.push([nextColumn, nextValue])
                  return {
                    select: () => ({
                      maybeSingle: async () => ({
                        data: state.updated,
                        error: state.updateError,
                      }),
                    }),
                  }
                },
              }
            },
          }
        },
      }
    },
  }),
}))

function decide(decision: unknown, id = 'app-1') {
  return POST(
    new Request('http://localhost/api/admin/faculty/app-1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision }),
    }),
    { params: Promise.resolve({ id }) },
  )
}

beforeEach(() => {
  state.user = null
  state.profile = null
  state.updateError = null
  state.updated = null
  state.updates = []
  state.eqs = []
})

describe('POST /api/admin/faculty/[id]', () => {
  it('rejects a signed-out caller with 401 and performs no update', async () => {
    const response = await decide('approved')

    expect(response.status).toBe(401)
    expect(state.updates).toHaveLength(0)
  })

  it('rejects a non-admin even when they submit a valid decision', async () => {
    state.user = { id: 'u1' }
    state.profile = { role: 'faculty' }

    const response = await decide('approved')

    expect(response.status).toBe(403)
    expect(state.updates).toHaveLength(0)
  })

  it('rejects an unknown decision before touching the database', async () => {
    state.user = { id: 'admin-1' }
    state.profile = { role: 'admin' }

    const response = await decide('maybe')

    expect(response.status).toBe(400)
    expect(state.updates).toHaveLength(0)
  })

  it('updates only a pending application and pins the acting admin as reviewer', async () => {
    state.user = { id: 'admin-1' }
    state.profile = { role: 'admin' }
    state.updated = { id: 'app-1', status: 'approved' }

    const response = await decide('approved')

    expect(response.status).toBe(200)
    expect(state.updates[0]).toMatchObject({
      status: 'approved',
      reviewed_by: 'admin-1',
      notes: null,
    })
    expect(state.updates[0].reviewed_at).toEqual(expect.any(String))
    // The second filter is what prevents double approval.
    expect(state.eqs).toEqual([
      ['id', 'app-1'],
      ['status', 'pending'],
    ])
  })

  it('returns 404 when the application was already reviewed', async () => {
    state.user = { id: 'admin-1' }
    state.profile = { role: 'admin' }
    state.updated = null

    const response = await decide('rejected')

    expect(response.status).toBe(404)
  })

  it('surfaces a database denial instead of reporting success', async () => {
    state.user = { id: 'admin-1' }
    state.profile = { role: 'admin' }
    state.updateError = { message: 'permission denied' }

    const response = await decide('approved')

    expect(response.status).toBe(400)
    const payload = (await response.json()) as { error: string }
    expect(payload.error).toContain('permission denied')
  })
})
