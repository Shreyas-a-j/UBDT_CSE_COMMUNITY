import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from './route'

/**
 * The admin review API validates the database RPC's real JSONB contract:
 *   { "success": true, "application_id": "...", "status": "approved" }
 *
 * When that contract is not met — an error, a lost response, an unexpected
 * shape or a mismatch — the route reads the persisted application and lets
 * that status decide. It never resubmits the review.
 */

const state = vi.hoisted(() => ({
  user: null as null | { id: string },
  profile: null as null | { role: string },
  rpcData: null as unknown,
  rpcError: null as null | { message: string; code?: string },
  rpcThrows: null as null | Error,
  rpcCalls: [] as Array<{ name: string; args: unknown }>,
  persisted: null as null | {
    id: string
    status: string
    review_notes?: string | null
  },
  applicationReadError: null as null | { message: string },
  applicationReads: [] as string[],
  directWrites: 0,
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

      if (table === 'faculty_applications') {
        return {
          select: () => ({
            eq: (_column: string, value: string) => ({
              maybeSingle: async () => {
                state.applicationReads.push(value)
                if (state.applicationReadError) {
                  return { data: null, error: state.applicationReadError }
                }
                return { data: state.persisted, error: null }
              },
            }),
          }),
        }
      }

      state.directWrites += 1
      throw new Error(`the review route must not write ${table} directly`)
    },
    rpc: async (name: string, args: unknown) => {
      state.rpcCalls.push({ name, args })
      if (state.rpcThrows) throw state.rpcThrows
      return { data: state.rpcData, error: state.rpcError }
    },
  }),
}))

function decide(decision: unknown, notes?: unknown, id = 'app-1') {
  return POST(
    new Request('http://localhost/api/admin/faculty/app-1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision, notes }),
    }),
    { params: Promise.resolve({ id }) },
  )
}

function setAdmin() {
  state.user = { id: 'admin-1' }
  state.profile = { role: 'admin' }
}

function setPersisted(status: 'pending' | 'approved' | 'rejected', id = 'app-1') {
  state.persisted = {
    id,
    status,
    review_notes: status === 'rejected' ? 'Incomplete documents' : null,
  }
}

function approvedResult(id = 'app-1') {
  return { success: true, application_id: id, status: 'approved' }
}

function rejectedResult(id = 'app-1') {
  return { success: true, application_id: id, status: 'rejected' }
}

beforeEach(() => {
  state.user = null
  state.profile = null
  state.rpcData = null
  state.rpcError = null
  state.rpcThrows = null
  state.rpcCalls = []
  state.persisted = null
  state.applicationReadError = null
  state.applicationReads = []
  state.directWrites = 0
})

describe('POST /api/admin/faculty/[id]', () => {
  it('rejects a signed-out caller with 401 and performs no review', async () => {
    const response = await decide('approve')

    expect(response.status).toBe(401)
    expect(state.rpcCalls).toHaveLength(0)
    expect(state.applicationReads).toHaveLength(0)
    expect(state.directWrites).toBe(0)
  })

  it('rejects a non-admin even when they submit a valid decision', async () => {
    state.user = { id: 'u1' }
    state.profile = { role: 'faculty' }

    const response = await decide('approve')

    expect(response.status).toBe(403)
    expect(state.rpcCalls).toHaveLength(0)
    expect(state.directWrites).toBe(0)
  })

  it('rejects an unknown decision before touching the database', async () => {
    setAdmin()

    const response = await decide('maybe')

    expect(response.status).toBe(400)
    expect(state.rpcCalls).toHaveLength(0)
    expect(state.applicationReads).toHaveLength(0)
    expect(state.directWrites).toBe(0)
  })

  it('rejects the stored-status vocabulary before calling the RPC', async () => {
    setAdmin()

    for (const value of ['approved', 'rejected', 'Approve', 'Reject', 'APPROVE']) {
      const response = await decide(value)

      expect(response.status).toBe(400)
      const payload = (await response.json()) as { error: string }
      expect(payload.error).toBe('Decision must be approve or reject.')
    }

    expect(state.rpcCalls).toHaveLength(0)
    expect(state.applicationReads).toHaveLength(0)
    expect(state.directWrites).toBe(0)
  })

  it('accepts the approved JSONB response and validates every field', async () => {
    setAdmin()
    state.rpcData = approvedResult()

    const response = await decide('approve')
    const payload = (await response.json()) as {
      outcome: string
      status: string
      application_id: string
    }

    expect(response.status).toBe(200)
    expect(payload.outcome).toBe('approved')
    expect(payload.status).toBe('approved')
    expect(payload.application_id).toBe('app-1')
    expect(state.applicationReads).toHaveLength(0)
    expect(state.rpcCalls).toEqual([
      {
        name: 'review_faculty_application',
        args: {
          p_application_id: 'app-1',
          p_decision: 'approve',
          p_notes: null,
        },
      },
    ])
  })

  it('accepts the rejected JSONB response and forwards the reason', async () => {
    setAdmin()
    state.rpcData = rejectedResult()

    const response = await decide('reject', 'Incomplete documents')
    const payload = (await response.json()) as { status: string }

    expect(response.status).toBe(200)
    expect(payload.status).toBe('rejected')
    expect(state.rpcCalls[0]?.args).toMatchObject({
      p_decision: 'reject',
      p_notes: 'Incomplete documents',
    })
  })

  it('accepts a single-element array wrapper when one is actually returned', async () => {
    setAdmin()
    state.rpcData = [approvedResult()]

    const response = await decide('approve')
    const payload = (await response.json()) as { status: string }

    expect(response.status).toBe(200)
    expect(payload.status).toBe('approved')
  })

  it('accepts a stringified JSONB payload', async () => {
    setAdmin()
    state.rpcData = JSON.stringify(approvedResult())

    const response = await decide('approve')

    expect(response.status).toBe(200)
  })

  it('surfaces the actual RPC error and reports that the row is still pending', async () => {
    setAdmin()
    state.rpcError = {
      message: 'Faculty profile update did not complete; approval rolled back.',
    }
    setPersisted('pending')

    const response = await decide('approve')
    const payload = (await response.json()) as { error: string; status: string }

    expect(response.status).toBe(400)
    expect(payload.error).toContain('rolled back')
    expect(payload.error).toContain('still pending')
    expect(payload.status).toBe('pending')
    expect(state.applicationReads).toEqual(['app-1'])
    expect(state.rpcCalls).toHaveLength(1)
  })

  it('surfaces a permission denial without converting it to an unknown result', async () => {
    setAdmin()
    state.rpcError = {
      message: 'permission denied for function review_faculty_application',
      code: '42501',
    }

    const response = await decide('approve')
    const payload = (await response.json()) as { error: string }

    expect(response.status).toBe(403)
    expect(payload.error).toContain('permission denied')
    expect(state.applicationReads).toHaveLength(0)
    expect(state.rpcCalls).toHaveLength(1)
  })

  it('confirms success from the persisted row after a lost RPC response', async () => {
    setAdmin()
    state.rpcError = { message: 'TypeError: fetch failed' }
    setPersisted('approved')

    const response = await decide('approve')
    const payload = (await response.json()) as { status: string }

    expect(response.status).toBe(200)
    expect(payload.status).toBe('approved')
    expect(state.applicationReads).toEqual(['app-1'])
    expect(state.rpcCalls).toHaveLength(1)
  })

  it('does not report success for an unexpected shape while the row is pending', async () => {
    setAdmin()
    state.rpcData = { unexpected: true }
    setPersisted('pending')

    const response = await decide('approve')
    const payload = (await response.json()) as { error: string; status: string }

    expect(response.status).toBe(502)
    expect(payload.error).toContain('could not be confirmed')
    expect(payload.error).toContain('still pending')
    expect(payload.status).toBe('pending')
    expect(state.applicationReads).toEqual(['app-1'])
    expect(state.rpcCalls).toHaveLength(1)
  })

  it('uses the persisted row when the RPC shape is unexpected but the change landed', async () => {
    setAdmin()
    state.rpcData = { unexpected: true }
    setPersisted('approved')

    const response = await decide('approve')
    const payload = (await response.json()) as { status: string }

    expect(response.status).toBe(200)
    expect(payload.status).toBe('approved')
    expect(state.applicationReads).toEqual(['app-1'])
    expect(state.rpcCalls).toHaveLength(1)
  })

  it('rejects an RPC response for a different application ID', async () => {
    setAdmin()
    state.rpcData = approvedResult('app-other')
    setPersisted('pending')

    const response = await decide('approve')
    const payload = (await response.json()) as { error: string }

    expect(response.status).toBe(502)
    expect(payload.error).toContain('could not be confirmed')
    expect(state.applicationReads).toEqual(['app-1'])
    expect(state.rpcCalls).toHaveLength(1)
  })

  it('rejects an RPC response whose status does not match the requested decision', async () => {
    setAdmin()
    state.rpcData = rejectedResult()
    setPersisted('pending')

    const response = await decide('approve')

    expect(response.status).toBe(502)
    expect(state.applicationReads).toEqual(['app-1'])
    expect(state.rpcCalls).toHaveLength(1)
  })

  it('does not accept a non-boolean success flag', async () => {
    setAdmin()
    state.rpcData = { success: 'true', application_id: 'app-1', status: 'approved' }
    setPersisted('pending')

    const response = await decide('approve')

    expect(response.status).toBe(502)
    expect(state.applicationReads).toEqual(['app-1'])
    expect(state.rpcCalls).toHaveLength(1)
  })

  it('treats a multi-row array as ambiguous, not successful', async () => {
    setAdmin()
    state.rpcData = [approvedResult(), approvedResult('app-2')]
    setPersisted('pending')

    const response = await decide('approve')

    expect(response.status).toBe(502)
    expect(state.applicationReads).toEqual(['app-1'])
    expect(state.rpcCalls).toHaveLength(1)
  })

  it('handles a timeout where the database update succeeded but the response was lost', async () => {
    setAdmin()
    state.rpcThrows = new Error('The operation was aborted due to timeout')
    setPersisted('approved')

    const response = await decide('approve')
    const payload = (await response.json()) as { status: string }

    expect(response.status).toBe(200)
    expect(payload.status).toBe('approved')
    expect(state.applicationReads).toEqual(['app-1'])
    expect(state.rpcCalls).toHaveLength(1)
  })

  it('reports an unconfirmed timeout while the row is still pending', async () => {
    setAdmin()
    state.rpcThrows = new Error('fetch failed')
    setPersisted('pending')

    const response = await decide('approve')
    const payload = (await response.json()) as { error: string }

    expect(response.status).toBe(502)
    expect(payload.error).toContain('fetch failed')
    expect(payload.error).toContain('still pending')
    expect(state.applicationReads).toEqual(['app-1'])
    expect(state.rpcCalls).toHaveLength(1)
  })

  it('returns 404 when the persisted row does not exist', async () => {
    setAdmin()
    state.rpcData = { success: false, error: 'Application not found.' }
    state.persisted = null

    const response = await decide('approve')
    const payload = (await response.json()) as { error: string }

    expect(response.status).toBe(404)
    expect(payload.error).toContain('Application not found')
    expect(state.rpcCalls).toHaveLength(1)
  })

  it('reports the real persisted status when the requested decision conflicts', async () => {
    setAdmin()
    state.rpcData = { success: false, error: 'Only pending applications can be reviewed.' }
    setPersisted('approved')

    const response = await decide('reject', 'No')
    const payload = (await response.json()) as { error: string; status: string }

    expect(response.status).toBe(409)
    expect(payload.error).toContain('already approved')
    expect(payload.status).toBe('approved')
    expect(state.rpcCalls).toHaveLength(1)
  })

  it('uses a JSON body error when the RPC reports failure without a Supabase error', async () => {
    setAdmin()
    state.rpcData = { success: false, error: 'A rejection reason is required.' }
    setPersisted('pending')

    const response = await decide('reject')
    const payload = (await response.json()) as { error: string }

    expect(response.status).toBe(400)
    expect(payload.error).toContain('A rejection reason is required.')
    expect(payload.error).toContain('still pending')
    expect(state.rpcCalls).toHaveLength(1)
  })

  it('reports an unconfirmed result when the persisted row cannot be read', async () => {
    setAdmin()
    state.rpcData = { unexpected: true }
    state.applicationReadError = { message: 'read failed' }

    const response = await decide('approve')
    const payload = (await response.json()) as { error: string }

    expect(response.status).toBe(502)
    expect(payload.error).toContain('could not be confirmed')
    expect(state.rpcCalls).toHaveLength(1)
  })

  it('does not match a persisted row returned for a different ID', async () => {
    setAdmin()
    state.rpcData = { unexpected: true }
    setPersisted('approved', 'app-other')

    const response = await decide('approve')
    const payload = (await response.json()) as { error: string }

    expect(response.status).toBe(502)
    expect(payload.error).toContain('could not be matched')
    expect(state.rpcCalls).toHaveLength(1)
  })

  it('caps the rejection reason at the database limit before sending it', async () => {
    setAdmin()
    state.rpcData = rejectedResult()

    await decide('reject', 'x'.repeat(800))

    expect((state.rpcCalls[0]?.args as { p_notes: string }).p_notes).toHaveLength(500)
  })
})
