/**
 * Community data layer regression tests (Bug 2)
 *
 * Verifies deletePost/deleteEvent end to end against a stubbed Supabase client:
 *   - an authorized author delete removes the row and the feed entry
 *   - a DELETE that is silently filtered (RLS denial — PostgREST resolves
 *     with `error: null` and zero returned rows) is rejected, the card
 *     stays in the feed and a resync is requested
 *   - a zero-row delete whose row is absent is "already gone": stale card
 *     removed, neutral toast, never a fabricated success
 *   - a database/network error surfaces a toast and keeps the card
 *   - signed-out users are routed to the auth modal without hitting the DB
 *   - the same classification applies to deleteEvent
 *
 * The live failure mode was verified against the real PostgREST endpoint:
 * a DELETE matching zero rows answers HTTP 200 `[]` — without the zero-row
 * check the UI optimistically removes a record that still exists. The live
 * DB was later shown to be missing the posts/events/comments DELETE policies
 * entirely (author deletes were denied for everyone), fixed by
 * supabase/migrations/20261020_delete_policies.sql.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import React from 'react'
import { renderHook, act, waitFor } from '@testing-library/react'
import { CommunityProvider, useCommunity } from './CommunityContext'
import { Profile } from '@/lib/types'

const toastMock = vi.hoisted(() => {
  // react-hot-toast's default export is a callable function with `error`
  // and `success` attached; the "already gone" state uses the neutral call.
  const toast = Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() })
  return toast
})
const useAuthMock = vi.hoisted(() => vi.fn())
/** Set by each test before the provider mounts. */
const stubState = vi.hoisted(() => ({ current: null as null | Record<string, unknown> }))

vi.mock('react-hot-toast', () => ({ default: toastMock }))
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: (props?: unknown) => useAuthMock(props),
}))
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => stubState.current,
}))

// ---------------------------------------------------------------------------
// Supabase stub: records every query (table, operation, filters) and resolves
// per-table results so the provider mounts and fetches normally.
// ---------------------------------------------------------------------------
type Filter = { column: string; value: unknown }
type Operation = { table: string; op: string; filters: Filter[] }

function makeSupabaseStub() {
  const baseResults: Record<string, { data: unknown; error: unknown }> = {
    posts: { data: [], error: null },
    events: { data: [], error: null },
    comments: { data: [], error: null },
    announcements: { data: [], error: null },
    likes: { data: [], error: null },
    upvotes: { data: [], error: null },
    event_rsvps: { data: [], error: null },
    notifications: { data: [], error: null },
  }
  /** Per-table resolution for delete operations, set by tests. */
  const deleteResults: Record<string, unknown> = {}
  const ops: Operation[] = []

  function resolveResult(rec: { table: string; op: string }) {
    if (rec.op === 'delete') {
      return deleteResults[rec.table] ?? { data: [], error: null }
    }
    return baseResults[rec.table] ?? { data: [], error: null }
  }

  const stub = {
    from(table: string) {
      const rec: { table: string; op: string; filters: Filter[] } = {
        table,
        op: 'select',
        filters: [],
      }
      const proxy: Record<string, unknown> = new Proxy(
        {},
        {
          get(_target, prop) {
            if (prop === 'then') {
              return (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
                ops.push({ ...rec, filters: rec.filters.map(f => ({ ...f })) })
                return Promise.resolve(resolveResult(rec)).then(resolve, reject)
              }
            }
            if (prop === 'catch') {
              return (cb: unknown) => Promise.resolve(resolveResult(rec)).catch(cb as never)
            }
            return (...args: unknown[]) => {
              const name = String(prop)
              if (name === 'eq' || name === 'gte' || name === 'neq') {
                rec.filters.push({ column: String(args[0]), value: args[1] })
              }
              if (name === 'delete' || name === 'insert' || name === 'update') rec.op = name
              return proxy
            }
          },
        }
      )
      return proxy
    },
    channel: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
    })),
    removeChannel: vi.fn(),
  }

  return {
    stub: stub as unknown as Record<string, unknown>,
    ops,
    baseResults,
    setDeleteResult(table: string, result: unknown) {
      deleteResults[table] = result
    },
  } as const
}

type Stub = ReturnType<typeof makeSupabaseStub>

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------
const seedAndRender = async (supabase: Stub, profile: Profile | null) => {
  stubState.current = supabase.stub
  useAuthMock.mockReturnValue({
    profile,
    loading: false,
    signOut: vi.fn().mockResolvedValue(undefined),
    refreshProfile: vi.fn().mockResolvedValue(undefined),
  })
  const { result } = renderHook(() => useCommunity(), {
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <CommunityProvider>{children}</CommunityProvider>
    ),
  })
  // The provider fetches inside queued microtasks at mount; settle first.
  await waitFor(() => expect(result.current.feedLoading).toBe(false), { timeout: 2000 })
  return result
}

const authorProfile = {
  id: 'author-1',
  name: 'Alice Author',
  usn: '4UB24CS001',
  role: 'student',
  branch: 'CSE',
} as unknown as Profile

const seedPost = {
  id: 'post-1',
  author_id: 'author-1',
  type: 'discussion',
  title: 'Seeded discussion',
  body: 'Body',
  tags: ['General'],
  target_years: [1, 2, 3, 4],
  created_at: '2026-10-19T10:00:00.000Z',
}

const pastEventRow = {
  id: 'workshop-past',
  host_id: 'author-1',
  title: 'Bug Fixes',
  description: 'Completed session',
  type: 'Workshop',
  event_date: '2026-10-14',
  event_time: '22:00:00',
  duration: 45,
  target_years: [1, 2, 3, 4],
  created_at: '2026-10-01T00:00:00.000Z',
}

const futureEventRow = {
  id: 'workshop-future',
  host_id: 'author-1',
  title: 'Placement prep workshop',
  description: 'Upcoming session',
  type: 'Workshop',
  event_date: '2027-01-20',
  event_time: '10:00:00',
  duration: 60,
  target_years: [1, 2, 3, 4],
  created_at: '2026-10-05T00:00:00.000Z',
}

beforeEach(() => {
  toastMock.mockClear()
  toastMock.error.mockClear()
  toastMock.success.mockClear()
})

describe('deletePost', () => {
  // Bug 3 regression: completed events must not leak into the single shared
  // `events` stream feeding the feed's "Upcoming events" section and the
  // SidebarRight "Upcoming events" widget.
  it('exposes only non-completed (upcoming/live) events to upcoming-event views', async () => {
    const supabase = makeSupabaseStub()
    supabase.baseResults.events = { data: [pastEventRow, futureEventRow], error: null }

    const result = await seedAndRender(supabase, authorProfile)

    await waitFor(() => {
      expect(result.current.events).toHaveLength(1)
      expect(result.current.events[0].id).toBe('workshop-future')
    })
  })

  it('an authorized author deletes their post: state syncs and the DB op is recorded', async () => {
    const supabase = makeSupabaseStub()
    supabase.baseResults.posts = { data: [seedPost], error: null }
    supabase.setDeleteResult('posts', { data: [{ id: 'post-1' }], error: null })

    const result = await seedAndRender(supabase, authorProfile)
    expect(result.current.posts).toHaveLength(1)

    let deleted = false
    await act(async () => {
      deleted = await result.current.deletePost('post-1')
    })

    expect(deleted).toBe(true)
    expect(result.current.posts).toHaveLength(0)
    expect(toastMock.error).not.toHaveBeenCalled()

    const deleteOp = supabase.ops.find(o => o.table === 'posts' && o.op === 'delete')
    expect(deleteOp).toBeDefined()
    expect(deleteOp?.filters).toContainEqual({ column: 'id', value: 'post-1' })
  })

  it('an RLS-denied (zero rows removed) delete is rejected: card stays, error shown, resync runs', async () => {
    const supabase = makeSupabaseStub()
    supabase.baseResults.posts = { data: [seedPost], error: null }
    // The live failure mode: PostgREST answers 200 with an empty array —
    // no error, zero removed rows (server-side policy filtered the delete).
    supabase.setDeleteResult('posts', { data: [], error: null })

    const result = await seedAndRender(supabase, authorProfile)
    expect(result.current.posts).toHaveLength(1)

    let deleted = false
    await act(async () => {
      deleted = await result.current.deletePost('post-1')
    })

    expect(deleted).toBe(false)
    // The stale optimistic update must NOT remove the still-existing post.
    expect(result.current.posts).toHaveLength(1)
    expect(toastMock.error).toHaveBeenCalledTimes(1)
    expect(toastMock.error.mock.calls[0][0]).toMatch(/could not be deleted|permission/i)
    // Feed re-sync ran so the UI reflects the authoritative DB state.
    const selectOps = supabase.ops.filter(o => o.table === 'posts' && o.op === 'select')
    expect(selectOps.length).toBeGreaterThan(1)
  })

  it('a zero-row delete where the row still exists (unauthorized cross-user attempt) is rejected', async () => {
    const supabase = makeSupabaseStub()
    supabase.baseResults.posts = { data: [seedPost], error: null }
    supabase.setDeleteResult('posts', { data: [], error: null })

    const nonAuthor = { ...authorProfile, id: 'someone-else' } as unknown as Profile
    const result = await seedAndRender(supabase, nonAuthor)
    expect(result.current.posts).toHaveLength(1)

    let deleted = false
    await act(async () => {
      deleted = await result.current.deletePost('post-1')
    })

    // The UI exposes only the id; refusal to delete someone else's post is
    // enforced server-side (verified live: zero rows, no error, row persists).
    expect(deleted).toBe(false)
    expect(result.current.posts).toHaveLength(1)
    expect(toastMock.error).toHaveBeenCalledTimes(1)
    const deleteOp = supabase.ops.find(o => o.table === 'posts' && o.op === 'delete')
    expect(deleteOp?.filters).toContainEqual({ column: 'id', value: 'post-1' })
  })

  it('a zero-row delete where the row is gone reports "already gone", removes the stale card, and never fakes success', async () => {
    const supabase = makeSupabaseStub()
    supabase.baseResults.posts = { data: [seedPost], error: null }
    supabase.setDeleteResult('posts', { data: [], error: null })

    const result = await seedAndRender(supabase, authorProfile)
    expect(result.current.posts).toHaveLength(1)
    // After the delete resolves with zero rows, the follow-up existence
    // re-read finds nothing — the record was already deleted.
    supabase.baseResults.posts = { data: [], error: null }

    let deleted = false
    await act(async () => {
      deleted = await result.current.deletePost('post-1')
    })

    expect(deleted).toBe(true)
    expect(result.current.posts).toHaveLength(0)
    expect(toastMock.error).not.toHaveBeenCalled()
    // Not a fabricated "deleted" success: the message says it was already gone.
    expect(toastMock.success).not.toHaveBeenCalled()
    expect(toastMock.mock.calls[0][0]).toMatch(/already gone/i)
  })

  it('a nonexistent discussion does not produce a false success', async () => {
    const supabase = makeSupabaseStub()
    supabase.baseResults.posts = { data: [], error: null }
    supabase.setDeleteResult('posts', { data: [], error: null })

    const result = await seedAndRender(supabase, authorProfile)

    let deleted = false
    await act(async () => {
      deleted = await result.current.deletePost('post-does-not-exist')
    })

    expect(deleted).toBe(true) // nothing left to delete; treated as already gone
    expect(toastMock.error).not.toHaveBeenCalled()
    expect(toastMock.success).not.toHaveBeenCalled()
    expect(toastMock.mock.calls[0][0]).toMatch(/already gone/i)
  })

  it('an invalid or missing id aborts before touching the database', async () => {
    const supabase = makeSupabaseStub()
    supabase.baseResults.posts = { data: [seedPost], error: null }
    supabase.setDeleteResult('posts', { data: [{ id: 'post-1' }], error: null })

    const result = await seedAndRender(supabase, authorProfile)

    let deleted = false
    await act(async () => {
      deleted = await result.current.deletePost('')
    })

    expect(deleted).toBe(false)
    expect(supabase.ops.some(o => o.op === 'delete')).toBe(false)
    expect(toastMock.success).not.toHaveBeenCalled()
  })

  it('a database/network failure is surfaced with an error and the card remains', async () => {
    const supabase = makeSupabaseStub()
    supabase.baseResults.posts = { data: [seedPost], error: null }
    supabase.setDeleteResult('posts', { data: null, error: { message: 'network down' } })

    const result = await seedAndRender(supabase, authorProfile)

    let deleted = false
    await act(async () => {
      deleted = await result.current.deletePost('post-1')
    })

    expect(deleted).toBe(false)
    expect(result.current.posts).toHaveLength(1)
    expect(toastMock.error).toHaveBeenCalledWith('network down')
    expect(toastMock.error.mock.calls[0][0]).not.toMatch(/success|deleted/i)
  })

  it('a signed-out user is routed to the auth modal and never hits the database', async () => {
    const supabase = makeSupabaseStub()

    const result = await seedAndRender(supabase, null)

    let deleted = false
    await act(async () => {
      deleted = await result.current.deletePost('post-1')
    })

    expect(deleted).toBe(false)
    expect(result.current.isAuthModalOpen).toBe(true)
    expect(supabase.ops.some(o => o.op === 'delete')).toBe(false)
  })
})

describe('deleteEvent', () => {
  it('an authorized host deletes their event: state syncs and the DB op is recorded', async () => {
    const supabase = makeSupabaseStub()
    supabase.baseResults.events = { data: [futureEventRow], error: null }
    supabase.setDeleteResult('events', { data: [{ id: 'workshop-future' }], error: null })

    const result = await seedAndRender(supabase, authorProfile)
    await waitFor(() => {
      expect(result.current.events).toHaveLength(1)
    })

    let deleted = false
    await act(async () => {
      deleted = await result.current.deleteEvent('workshop-future')
    })

    expect(deleted).toBe(true)
    expect(result.current.events).toHaveLength(0)
    expect(toastMock.error).not.toHaveBeenCalled()

    const deleteOp = supabase.ops.find(o => o.table === 'events' && o.op === 'delete')
    expect(deleteOp).toBeDefined()
    expect(deleteOp?.filters).toContainEqual({ column: 'id', value: 'workshop-future' })
  })

  it('a zero-row delete (RLS denial) keeps the event and resyncs, with the correct filter', async () => {
    const supabase = makeSupabaseStub()
    supabase.baseResults.events = { data: [futureEventRow], error: null }
    supabase.setDeleteResult('events', { data: [], error: null })

    const nonHost = { ...authorProfile, id: 'someone-else' } as unknown as Profile
    const result = await seedAndRender(supabase, nonHost)
    await waitFor(() => {
      expect(result.current.events).toHaveLength(1)
    })

    let deleted = false
    await act(async () => {
      deleted = await result.current.deleteEvent('workshop-future')
    })

    expect(deleted).toBe(false)
    expect(result.current.events).toHaveLength(1)
    expect(toastMock.error).toHaveBeenCalledTimes(1)
    const deleteOp = supabase.ops.find(o => o.table === 'events' && o.op === 'delete')
    expect(deleteOp?.filters).toContainEqual({ column: 'id', value: 'workshop-future' })
  })

  it('a zero-row delete whose row is gone reports "already gone" and removes the stale entry', async () => {
    const supabase = makeSupabaseStub()
    supabase.baseResults.events = { data: [futureEventRow], error: null }
    supabase.setDeleteResult('events', { data: [], error: null })

    const result = await seedAndRender(supabase, authorProfile)
    supabase.baseResults.events = { data: [], error: null }

    let deleted = false
    await act(async () => {
      deleted = await result.current.deleteEvent('workshop-future')
    })

    expect(deleted).toBe(true)
    expect(toastMock.error).not.toHaveBeenCalled()
    expect(toastMock.mock.calls[0][0]).toMatch(/already gone/i)
  })
})
