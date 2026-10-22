import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from './route'

/**
 * The admin review list is a server API so the browser never decides who may
 * read applications. These tests pin the authorization boundary and the
 * partial-failure behaviour: missing verification data must be reported, not
 * rendered as "unverified".
 */

const state = vi.hoisted(() => ({
  user: null as null | { id: string },
  roleProfile: null as null | { role: string },
  applications: [] as Array<Record<string, unknown>>,
  applicationsError: null as null | { message: string },
  profiles: [] as Array<Record<string, unknown>>,
  profilesError: null as null | { message: string },
  verification: [] as Array<Record<string, unknown>>,
  verificationError: null as null | { message: string },
  rpcCalls: [] as Array<{ name: string; args: unknown }>,
  profileIds: [] as string[],
  applicationsReads: 0,
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: state.user }, error: null }),
    },
    from(table: string) {
      if (table === 'profiles') {
        return {
          select(columns: string) {
            if (columns === 'role') {
              return {
                eq: () => ({
                  maybeSingle: async () => ({ data: state.roleProfile, error: null }),
                }),
              }
            }

            return {
              in: async (_column: string, ids: string[]) => {
                state.profileIds = ids
                return { data: state.profiles, error: state.profilesError }
              },
            }
          },
        }
      }

      if (table === 'faculty_applications') {
        return {
          select: () => ({
            order: async () => {
              state.applicationsReads += 1
              return { data: state.applications, error: state.applicationsError }
            },
          }),
        }
      }

      throw new Error(`unexpected table ${table}`)
    },
    rpc: async (name: string, args: unknown) => {
      state.rpcCalls.push({ name, args })
      return { data: state.verification, error: state.verificationError }
    },
  }),
}))

beforeEach(() => {
  state.user = null
  state.roleProfile = null
  state.applications = []
  state.applicationsError = null
  state.profiles = []
  state.profilesError = null
  state.verification = []
  state.verificationError = null
  state.rpcCalls = []
  state.profileIds = []
  state.applicationsReads = 0
})

describe('GET /api/admin/faculty', () => {
  it('rejects a signed-out caller before reading applications', async () => {
    const response = await GET()

    expect(response.status).toBe(401)
    expect(state.applicationsReads).toBe(0)
  })

  it('rejects a signed-in non-admin before reading applications', async () => {
    state.user = { id: 'faculty-1' }
    state.roleProfile = { role: 'faculty' }

    const response = await GET()

    expect(response.status).toBe(403)
    expect(state.applicationsReads).toBe(0)
  })

  it('returns applications, profiles and trusted verification for an admin', async () => {
    state.user = { id: 'admin-1' }
    state.roleProfile = { role: 'admin' }
    state.applications = [
      { id: 'app-1', user_id: 'u1', status: 'pending' },
      { id: 'app-2', user_id: 'u1', status: 'approved' },
      { id: 'app-3', user_id: 'u2', status: 'pending' },
    ]
    state.profiles = [
      { id: 'u1', name: 'Applicant One' },
      { id: 'u2', name: 'Applicant Two' },
    ]
    state.verification = [
      { user_id: 'u1', email_verified: true },
      { user_id: 'u2', email_verified: false },
    ]

    const response = await GET()
    const payload = (await response.json()) as {
      applications: unknown[]
      profiles: unknown[]
      emailVerified: Record<string, boolean>
      emailVerificationError: string | null
    }

    expect(response.status).toBe(200)
    expect(payload.applications).toHaveLength(3)
    expect(payload.profiles).toHaveLength(2)
    expect(payload.emailVerified).toEqual({ u1: true, u2: false })
    expect(payload.emailVerificationError).toBeNull()
    // The RPC receives each applicant once, not once per application.
    expect(state.profileIds).toEqual(['u1', 'u2'])
    expect(state.rpcCalls).toEqual([
      {
        name: 'get_email_verification_status',
        args: { target_user_ids: ['u1', 'u2'] },
      },
    ])
  })

  it('surfaces an application read denial instead of returning an empty list', async () => {
    state.user = { id: 'admin-1' }
    state.roleProfile = { role: 'admin' }
    state.applicationsError = { message: 'permission denied for table faculty_applications' }

    const response = await GET()
    const payload = (await response.json()) as { error: string }

    expect(response.status).toBe(400)
    expect(payload.error).toContain('permission denied')
  })

  it('surfaces an applicant profile read denial', async () => {
    state.user = { id: 'admin-1' }
    state.roleProfile = { role: 'admin' }
    state.applications = [{ id: 'app-1', user_id: 'u1', status: 'pending' }]
    state.profilesError = { message: 'permission denied for table profiles' }

    const response = await GET()
    const payload = (await response.json()) as { error: string }

    expect(response.status).toBe(400)
    expect(payload.error).toContain('permission denied')
  })

  it('keeps the review list usable and reports a missing verification RPC', async () => {
    state.user = { id: 'admin-1' }
    state.roleProfile = { role: 'admin' }
    state.applications = [{ id: 'app-1', user_id: 'u1', status: 'pending' }]
    state.profiles = [{ id: 'u1', name: 'Applicant One' }]
    state.verificationError = { message: 'function does not exist' }

    const response = await GET()
    const payload = (await response.json()) as {
      applications: unknown[]
      emailVerified: Record<string, boolean>
      emailVerificationError: string | null
    }

    expect(response.status).toBe(200)
    expect(payload.applications).toHaveLength(1)
    // An empty map means "unknown"; the UI must not turn that into "unverified".
    expect(payload.emailVerified).toEqual({})
    expect(payload.emailVerificationError).toContain('function does not exist')
  })

  it('does not call the verification RPC when there are no applications', async () => {
    state.user = { id: 'admin-1' }
    state.roleProfile = { role: 'admin' }

    const response = await GET()
    const payload = (await response.json()) as {
      applications: unknown[]
      profiles: unknown[]
      emailVerified: Record<string, boolean>
    }

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({
      applications: [],
      profiles: [],
      emailVerified: {},
    })
    expect(state.rpcCalls).toEqual([])
  })
})
