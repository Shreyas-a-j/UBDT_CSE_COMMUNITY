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
 * supabase/migrations/2026102001_delete_policies.sql.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import React from 'react'
import { renderHook, act, waitFor } from '@testing-library/react'
import { CommunityProvider, useCommunity } from './CommunityContext'
import { summarizeReactions } from '@/lib/logic/announcements'
import { PIN_LIMIT_MESSAGE, PIN_PERMISSION_MESSAGE } from '@/lib/logic/discussionPins'
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
    discussion_pins: { data: [], error: null },
  }
  /** Per-table resolution for delete operations, set by tests. */
  const deleteResults: Record<string, unknown> = {}
  const ops: Operation[] = []
  /** Payloads passed to .insert(), in call order. */
  const insertPayloads: Record<string, unknown>[] = []
  /** Payloads passed to .update(), in call order. */
  const updatePayloads: Record<string, unknown>[] = []
  const rpcCalls: Array<{ name: string; args: unknown }> = []
  const rpcResults: Record<string, { data: unknown; error: unknown }> = {}
  const channelHandlers: Array<{
    event: string
    config: Record<string, unknown>
    callback: (payload: unknown) => void
  }> = []

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
              if (name === 'insert') insertPayloads.push(args[0] as Record<string, unknown>)
              if (name === 'update') updatePayloads.push(args[0] as Record<string, unknown>)
              return proxy
            }
          },
        }
      )
      return proxy
    },
    channel: vi.fn(() => {
      const channel = {
        on: vi.fn(
          (
            event: string,
            config: Record<string, unknown>,
            callback: (payload: unknown) => void
          ) => {
            channelHandlers.push({ event, config, callback })
            return channel
          }
        ),
        subscribe: vi.fn(() => channel),
      }
      return channel
    }),
    removeChannel: vi.fn(),
    rpc(name: string, args: unknown) {
      rpcCalls.push({ name, args })
      return Promise.resolve(rpcResults[name] ?? { data: null, error: null })
    },
  }

  return {
    stub: stub as unknown as Record<string, unknown>,
    ops,
    insertPayloads,
    updatePayloads,
    rpcCalls,
    baseResults,
    channelHandlers,
    setDeleteResult(table: string, result: unknown) {
      deleteResults[table] = result
    },
    setRpcResult(name: string, result: { data: unknown; error: unknown }) {
      rpcResults[name] = result
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

describe('announcement reactions', () => {
  const facultyAnnouncement = {
    id: 'a1',
    author_id: 'faculty-1',
    title: 'Deadline extended',
    body: 'Submit by Friday.',
    image_urls: ['https://cdn.test/one.png'],
    created_at: '2026-10-22T09:00:00.000Z',
    updated_at: '2026-10-22T09:00:00.000Z',
    author: { name: 'Dr Rao', avatar_url: null, designation: 'Professor' },
    reactions: [
      { user_id: 'someone-else', reaction: 'thumbs_up' },
      { user_id: 'author-1', reaction: 'heart' },
    ],
  }

  it('maps image urls and raw reaction rows from the join', async () => {
    const supabase = makeSupabaseStub()
    supabase.baseResults.announcements = { data: [facultyAnnouncement], error: null }

    const result = await seedAndRender(supabase, authorProfile)

    await waitFor(() => expect(result.current.announcements).toHaveLength(1))
    const [announcement] = result.current.announcements
    expect(announcement.author_name).toBe('Dr Rao')
    expect(announcement.image_urls).toEqual(['https://cdn.test/one.png'])
    expect(announcement.reactions).toHaveLength(2)
  })

  it('adds exactly one row for a first reaction', async () => {
    const supabase = makeSupabaseStub()
    supabase.baseResults.announcements = { data: [facultyAnnouncement], error: null }

    const result = await seedAndRender(supabase, authorProfile)
    await waitFor(() => expect(result.current.announcements).toHaveLength(1))

    await act(async () => {
      await result.current.toggleAnnouncementReaction('a1', 'clap')
    })

    expect(supabase.insertPayloads).toEqual([
      { announcement_id: 'a1', user_id: 'author-1', reaction: 'clap' },
    ])
    expect(
      result.current.announcements[0].reactions.filter(
        (row: { user_id: string }) => row.user_id === 'author-1'
      )
    ).toEqual([{ user_id: 'author-1', reaction: 'clap' }])
  })

  it('removes the caller\'s own row when the same reaction is selected again', async () => {
    const supabase = makeSupabaseStub()
    supabase.baseResults.announcements = { data: [facultyAnnouncement], error: null }

    const result = await seedAndRender(supabase, authorProfile)
    await waitFor(() => expect(result.current.announcements).toHaveLength(1))

    await act(async () => {
      await result.current.toggleAnnouncementReaction('a1', 'heart')
    })

    expect(supabase.insertPayloads).toHaveLength(0)
    const deleteOp = supabase.ops.find(o => o.table === 'announcement_reactions' && o.op === 'delete')
    expect(deleteOp?.filters).toEqual(
      expect.arrayContaining([
        { column: 'announcement_id', value: 'a1' },
        { column: 'user_id', value: 'author-1' },
      ])
    )
    // Deletes every row for this member on this announcement (and nothing else).
    expect(deleteOp?.filters).toHaveLength(2)
    expect(
      result.current.announcements[0].reactions.some(
        (row: { user_id: string }) => row.user_id === 'author-1'
      )
    ).toBe(false)
  })

  it('replaces a different reaction instead of adding a second one', async () => {
    const supabase = makeSupabaseStub()
    supabase.baseResults.announcements = { data: [facultyAnnouncement], error: null }

    const result = await seedAndRender(supabase, authorProfile)
    await waitFor(() => expect(result.current.announcements).toHaveLength(1))

    await act(async () => {
      await result.current.toggleAnnouncementReaction('a1', 'party')
    })

    expect(supabase.insertPayloads).toEqual([
      { announcement_id: 'a1', user_id: 'author-1', reaction: 'party' },
    ])
    const deleteOp = supabase.ops.find(o => o.table === 'announcement_reactions' && o.op === 'delete')
    expect(deleteOp?.filters).toEqual(
      expect.arrayContaining([
        { column: 'announcement_id', value: 'a1' },
        { column: 'user_id', value: 'author-1' },
      ])
    )

    const mine = result.current.announcements[0].reactions.filter(
      (row: { user_id: string }) => row.user_id === 'author-1'
    )
    expect(mine).toEqual([{ user_id: 'author-1', reaction: 'party' }])
  })

  it('updates counts and preserves other members\' reactions when replacing', async () => {
    const supabase = makeSupabaseStub()
    supabase.baseResults.announcements = { data: [facultyAnnouncement], error: null }

    const result = await seedAndRender(supabase, authorProfile)
    await waitFor(() => expect(result.current.announcements).toHaveLength(1))

    await act(async () => {
      await result.current.toggleAnnouncementReaction('a1', 'party')
    })

    const reactions = result.current.announcements[0].reactions
    const { counts, mine } = summarizeReactions(reactions, 'author-1')
    expect(counts).toEqual({ thumbs_up: 1, heart: 0, party: 1, clap: 0 })
    expect(mine).toEqual(['party'])
    // The other member's reaction is never touched.
    expect(reactions).toContainEqual({ user_id: 'someone-else', reaction: 'thumbs_up' })
  })

  it('restores the previous reaction when the replacement delete fails', async () => {
    const supabase = makeSupabaseStub()
    supabase.baseResults.announcements = { data: [facultyAnnouncement], error: null }
    supabase.setDeleteResult('announcement_reactions', {
      data: null,
      error: { message: 'permission denied' },
    })

    const result = await seedAndRender(supabase, authorProfile)
    await waitFor(() => expect(result.current.announcements).toHaveLength(1))

    await act(async () => {
      await result.current.toggleAnnouncementReaction('a1', 'party')
    })

    expect(toastMock.error).toHaveBeenCalled()
    expect(supabase.insertPayloads).toHaveLength(0)
    // The resync puts the old row back instead of leaving the optimistic one.
    expect(
      result.current.announcements[0].reactions.filter(
        (row: { user_id: string }) => row.user_id === 'author-1'
      )
    ).toEqual([{ user_id: 'author-1', reaction: 'heart' }])
  })

  it('re-inserts the old reaction when the new insert fails', async () => {
    const supabase = makeSupabaseStub()
    supabase.baseResults.announcements = { data: [facultyAnnouncement], error: null }
    supabase.baseResults.announcement_reactions = {
      data: null,
      error: { message: 'insert failed' },
    }

    const result = await seedAndRender(supabase, authorProfile)
    await waitFor(() => expect(result.current.announcements).toHaveLength(1))

    await act(async () => {
      await result.current.toggleAnnouncementReaction('a1', 'party')
    })

    expect(toastMock.error).toHaveBeenCalled()
    // The new reaction was attempted, then the previous one was restored.
    expect(supabase.insertPayloads.map(payload => payload.reaction)).toEqual(['party', 'heart'])
    expect(
      result.current.announcements[0].reactions.filter(
        (row: { user_id: string }) => row.user_id === 'author-1'
      )
    ).toEqual([{ user_id: 'author-1', reaction: 'heart' }])
  })

  it('ignores a second toggle for the same announcement while one is in flight', async () => {
    const supabase = makeSupabaseStub()
    supabase.baseResults.announcements = { data: [facultyAnnouncement], error: null }

    const result = await seedAndRender(supabase, authorProfile)
    await waitFor(() => expect(result.current.announcements).toHaveLength(1))

    await act(async () => {
      const first = result.current.toggleAnnouncementReaction('a1', 'clap')
      const second = result.current.toggleAnnouncementReaction('a1', 'party')
      await Promise.all([first, second])
    })

    expect(supabase.insertPayloads).toHaveLength(1)
    expect(supabase.insertPayloads[0].reaction).toBe('clap')
  })

  it('routes a signed-out visitor to the auth modal without touching the database', async () => {
    const supabase = makeSupabaseStub()
    supabase.baseResults.announcements = { data: [facultyAnnouncement], error: null }

    const result = await seedAndRender(supabase, null)
    await waitFor(() => expect(result.current.announcements).toHaveLength(1))

    await act(async () => {
      await result.current.toggleAnnouncementReaction('a1', 'party')
    })

    expect(result.current.isAuthModalOpen).toBe(true)
    expect(supabase.insertPayloads).toHaveLength(0)
    expect(supabase.ops.some(o => o.table === 'announcement_reactions')).toBe(false)
  })
})

describe('openCreateEvent', () => {
  it('opens the shared event composer for a signed-in member', async () => {
    const supabase = makeSupabaseStub()

    const result = await seedAndRender(supabase, authorProfile)

    act(() => {
      result.current.openCreateEvent()
    })

    expect(result.current.isCreateEventOpen).toBe(true)
    expect(result.current.isAuthModalOpen).toBe(false)
  })

  it('sends a signed-out visitor to auth instead of the event composer', async () => {
    const supabase = makeSupabaseStub()

    const result = await seedAndRender(supabase, null)

    act(() => {
      result.current.openCreateEvent()
    })

    expect(result.current.isCreateEventOpen).toBe(false)
    expect(result.current.isAuthModalOpen).toBe(true)
  })
})

describe('createEvent', () => {
  it('submits through the one existing event path exactly once', async () => {
    const supabase = makeSupabaseStub()

    const result = await seedAndRender(supabase, authorProfile)

    // The initial feed fetch expects a list; the insert resolves a single row.
    supabase.baseResults.events = {
      data: {
        id: 'event-new',
        host_id: 'author-1',
        title: 'Placement prep',
        description: 'Bring your resume.',
        type: 'Workshop',
        event_date: '2027-02-01',
        event_time: '10:00:00',
        duration: 60,
        link: null,
        target_years: [1, 2, 3, 4],
        created_at: '2026-10-22T10:00:00.000Z',
      },
      error: null,
    }

    await act(async () => {
      await result.current.createEvent({
        host_id: '',
        title: 'Placement prep',
        description: 'Bring your resume.',
        type: 'Workshop',
        event_date: '2027-02-01',
        event_time: '10:00:00',
        duration: 60,
        link: null,
        target_years: [1, 2, 3, 4],
      })
    })

    const eventInserts = supabase.insertPayloads.filter(payload => 'event_date' in payload)
    expect(eventInserts).toHaveLength(1)
    expect(result.current.events.filter((event: { id: string }) => event.id === 'event-new')).toHaveLength(1)
    expect(toastMock.success).toHaveBeenCalledWith('Event created')
  })
})

describe('createAnnouncement', () => {
  const verifiedFaculty = {
    id: 'faculty-1',
    name: 'Dr Rao',
    role: 'faculty',
    faculty_status: 'verified',
  } as unknown as Profile

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('posts through the trusted route and prepends the created announcement', async () => {
    const supabase = makeSupabaseStub()
    const createdRow = {
      id: 'new-a',
      author_id: 'faculty-1',
      title: 'Deadline extended',
      body: 'Submit by Friday.',
      image_urls: [],
      created_at: '2026-10-22T10:00:00.000Z',
      updated_at: '2026-10-22T10:00:00.000Z',
      author: { name: 'Dr Rao', avatar_url: null, designation: 'Professor' },
      reactions: [],
    }
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ announcement: createdRow }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await seedAndRender(supabase, verifiedFaculty)

    let created: unknown = null
    await act(async () => {
      created = await result.current.createAnnouncement({
        title: '  Deadline extended  ',
        body: 'Submit by Friday.',
        image_urls: [],
      })
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/announcements',
      expect.objectContaining({ method: 'POST' })
    )
    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as { body: string }).body
    ) as Record<string, unknown>
    expect(body.title).toBe('Deadline extended')
    expect(created).not.toBeNull()
    expect(result.current.announcements[0].id).toBe('new-a')
    expect(toastMock.success).toHaveBeenCalled()
  })

  it('never calls the API for a student', async () => {
    const supabase = makeSupabaseStub()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await seedAndRender(supabase, authorProfile)

    let created: unknown = 'unset'
    await act(async () => {
      created = await result.current.createAnnouncement({
        title: 'Hi',
        body: 'There',
        image_urls: [],
      })
    })

    expect(created).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(toastMock.error).toHaveBeenCalledWith('Only verified faculty can publish announcements')
  })
})

describe('deleteAnnouncement', () => {
  const facultyProfile = {
    id: 'faculty-1',
    name: 'Dr Rao',
    role: 'faculty',
    faculty_status: 'approved',
  } as unknown as Profile

  const row = {
    id: 'ann-1',
    author_id: 'faculty-1',
    title: 'Delete me',
    body: 'body',
    image_urls: [],
    created_at: '2026-10-22T10:00:00.000Z',
    updated_at: '2026-10-22T10:00:00.000Z',
    author: { name: 'Dr Rao', avatar_url: null, designation: 'Professor' },
    reactions: [],
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function render(fetchResult: unknown) {
    const supabase = makeSupabaseStub()
    supabase.baseResults.announcements = { data: [row], error: null }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fetchResult))
    const result = await seedAndRender(supabase, facultyProfile)
    await waitFor(() => expect(result.current.announcements).toHaveLength(1))
    return result
  }

  it('removes the row only after the server confirms deletion', async () => {
    const result = await render({
      ok: true,
      status: 200,
      json: async () => ({ deleted: true }),
    })

    let outcome: { ok: boolean; alreadyGone?: boolean; error?: string } | null = null
    await act(async () => {
      outcome = await result.current.deleteAnnouncement('ann-1')
    })

    expect(outcome!.ok).toBe(true)
    expect(result.current.announcements).toHaveLength(0)
  })

  it('treats the route\'s explicit already-gone 404 as success', async () => {
    const result = await render({
      ok: false,
      status: 404,
      json: async () => ({ error: 'This announcement is already gone.' }),
    })

    let outcome: { ok: boolean; alreadyGone?: boolean; error?: string } | null = null
    await act(async () => {
      outcome = await result.current.deleteAnnouncement('ann-1')
    })

    expect(outcome!.ok).toBe(true)
    expect(outcome!.alreadyGone).toBe(true)
    expect(result.current.announcements).toHaveLength(0)
  })

  it('keeps the row when a 404 is not the route JSON (missing route/HTML)', async () => {
    const result = await render({
      ok: false,
      status: 404,
      json: async () => {
        throw new Error('HTML 404')
      },
    })

    let outcome: { ok: boolean; alreadyGone?: boolean; error?: string } | null = null
    await act(async () => {
      outcome = await result.current.deleteAnnouncement('ann-1')
    })

    expect(outcome!.ok).toBe(false)
    expect(result.current.announcements).toHaveLength(1)
  })

  it('keeps the row when a 200 response does not confirm deletion', async () => {
    const result = await render({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    })

    let outcome: { ok: boolean; alreadyGone?: boolean; error?: string } | null = null
    await act(async () => {
      outcome = await result.current.deleteAnnouncement('ann-1')
    })

    expect(outcome!.ok).toBe(false)
    expect(result.current.announcements).toHaveLength(1)
  })

  it('keeps the row on a 409 policy/grant failure', async () => {
    const result = await render({
      ok: false,
      status: 409,
      json: async () => ({ error: 'The announcement could not be deleted.' }),
    })

    let outcome: { ok: boolean; alreadyGone?: boolean; error?: string } | null = null
    await act(async () => {
      outcome = await result.current.deleteAnnouncement('ann-1')
    })

    expect(outcome!.ok).toBe(false)
    expect(result.current.announcements).toHaveLength(1)
  })
})

describe('notification load state', () => {
  it('marks the list loaded and replaces the previous account rows on a user switch', async () => {
    const supabase = makeSupabaseStub()
    supabase.baseResults.notifications = {
      data: [
        {
          id: 'notification-a',
          user_id: 'author-1',
          type: 'announcement',
          title: 'For account A',
          body: null,
          link: '/announcements',
          read: false,
          created_at: '2026-10-25T09:00:00.000Z',
        },
      ],
      error: null,
    }
    stubState.current = supabase.stub
    const auth = {
      profile: authorProfile,
      loading: false,
      signOut: vi.fn().mockResolvedValue(undefined),
      refreshProfile: vi.fn().mockResolvedValue(undefined),
    }
    useAuthMock.mockReturnValue(auth)

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <CommunityProvider>{children}</CommunityProvider>
    )
    const { result, rerender } = renderHook(() => useCommunity(), { wrapper })

    await waitFor(() => expect(result.current.notifications).toHaveLength(1))
    expect(result.current.notificationsLoaded).toBe(true)

    const secondProfile = { ...authorProfile, id: 'author-2' } as unknown as Profile
    supabase.baseResults.notifications = {
      data: [
        {
          id: 'notification-b',
          user_id: 'author-2',
          type: 'comment',
          title: 'For account B',
          body: null,
          link: '/',
          read: false,
          created_at: '2026-10-25T10:00:00.000Z',
        },
      ],
      error: null,
    }
    useAuthMock.mockReturnValue({ ...auth, profile: secondProfile })
    rerender()

    await waitFor(() => expect(result.current.notifications[0]?.id).toBe('notification-b'))
    expect(result.current.notificationsLoaded).toBe(true)
    expect(
      supabase.ops.some(
        op =>
          op.table === 'notifications' &&
          op.filters.some(filter => filter.column === 'user_id' && filter.value === 'author-2')
      )
    ).toBe(true)
  })

  it('does not mark notifications loaded when the read fails, and recovers on focus', async () => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    })

    const supabase = makeSupabaseStub()
    supabase.baseResults.notifications = {
      data: null,
      error: { message: 'notifications read failed' },
    }

    const result = await seedAndRender(supabase, authorProfile)

    await waitFor(() =>
      expect(supabase.ops.some(op => op.table === 'notifications')).toBe(true)
    )
    // A failed read is not "no notifications": the list must stay unloaded so
    // the bell/popup can retry instead of reporting an empty inbox forever.
    expect(result.current.notificationsLoaded).toBe(false)

    supabase.baseResults.notifications = {
      data: [
        {
          id: 'notification-recovered',
          user_id: 'author-1',
          type: 'announcement',
          title: 'Recovered',
          body: null,
          link: '/announcements',
          read: false,
          created_at: '2026-10-25T11:00:00.000Z',
        },
      ],
      error: null,
    }

    act(() => {
      window.dispatchEvent(new Event('focus'))
    })

    await waitFor(() => expect(result.current.notifications).toHaveLength(1))
    expect(result.current.notificationsLoaded).toBe(true)
  })
})

describe('notification realtime retention', () => {
  it('persists mark-one and mark-all as database updates', async () => {
    const supabase = makeSupabaseStub()
    supabase.baseResults.notifications = {
      data: [
        {
          id: 'notification-a',
          user_id: 'author-1',
          type: 'announcement',
          title: 'A',
          body: null,
          link: '/announcements',
          read: false,
          created_at: '2026-10-25T09:00:00.000Z',
        },
        {
          id: 'notification-b',
          user_id: 'author-1',
          type: 'announcement',
          title: 'B',
          body: null,
          link: '/announcements',
          read: false,
          created_at: '2026-10-25T09:01:00.000Z',
        },
      ],
      error: null,
    }

    const result = await seedAndRender(supabase, authorProfile)
    await waitFor(() => expect(result.current.notifications).toHaveLength(2))

    // A bare `void builder` never sent the PATCH; attaching .then() does.
    act(() => result.current.markNotificationAsRead('notification-a'))
    await waitFor(() => expect(supabase.updatePayloads).toContainEqual({ read: true }))
    expect(
      supabase.ops.some(
        op =>
          op.table === 'notifications' &&
          op.op === 'update' &&
          op.filters.some(filter => filter.column === 'id' && filter.value === 'notification-a')
      )
    ).toBe(true)

    supabase.updatePayloads.length = 0
    act(() => result.current.markAllNotificationsAsRead())
    await waitFor(() =>
      expect(
        supabase.ops.some(
          op =>
            op.table === 'notifications' &&
            op.op === 'update' &&
            op.filters.some(f => f.column === 'user_id' && f.value === 'author-1') &&
            op.filters.some(f => f.column === 'read' && f.value === false)
        )
      ).toBe(true)
    )
    expect(supabase.updatePayloads).toContainEqual({ read: true })
  })

  it('adds a live INSERT as an unread notification and ignores hidden types', async () => {
    const supabase = makeSupabaseStub()
    const result = await seedAndRender(supabase, authorProfile)
    await waitFor(() => expect(result.current.notificationsLoaded).toBe(true))

    const insertHandler = supabase.channelHandlers.find(
      handler =>
        handler.config.event === 'INSERT' &&
        handler.config.table === 'notifications' &&
        handler.config.filter === 'user_id=eq.author-1'
    )
    expect(insertHandler).toBeDefined()

    act(() => {
      insertHandler!.callback({
        new: {
          id: 'notification-live',
          user_id: 'author-1',
          type: 'event_published',
          title: 'Live event',
          body: null,
          link: '/#event-1',
          read: false,
          created_at: '2026-10-25T12:00:00.000Z',
        },
      })
    })

    await waitFor(() => expect(result.current.notifications).toHaveLength(1))
    // The bell derives its unread count from this state.
    expect(result.current.notifications[0].read).toBe(false)

    // Legacy messaging rows are hidden by the shared visibility rule.
    act(() => {
      insertHandler!.callback({
        new: {
          id: 'notification-hidden',
          user_id: 'author-1',
          type: 'message',
          title: 'Hidden',
          body: null,
          link: '/',
          read: false,
          created_at: '2026-10-25T12:01:00.000Z',
        },
      })
    })
    expect(result.current.notifications).toHaveLength(1)
  })

  it('removes a notification when the server deletes it after the 24-hour window', async () => {
    const supabase = makeSupabaseStub()
    supabase.baseResults.notifications = {
      data: [
        {
          id: 'notification-old',
          user_id: 'author-1',
          type: 'announcement',
          title: 'Old announcement',
          body: 'This row is due for retention cleanup.',
          link: '/announcements',
          read: false,
          created_at: '2026-10-24T09:00:00.000Z',
        },
      ],
      error: null,
    }

    const result = await seedAndRender(supabase, authorProfile)
    await waitFor(() => expect(result.current.notifications).toHaveLength(1))

    const deleteHandler = supabase.channelHandlers.find(
      handler =>
        handler.config.event === 'DELETE' &&
        handler.config.table === 'notifications' &&
        handler.config.filter === 'user_id=eq.author-1'
    )
    expect(deleteHandler).toBeDefined()

    act(() => {
      deleteHandler!.callback({ old: { id: 'notification-old' } })
    })

    await waitFor(() => expect(result.current.notifications).toHaveLength(0))
  })
})

describe('discussion pin actions', () => {
  const approvedFaculty = {
    id: 'faculty-1',
    name: 'Dr Rao',
    role: 'faculty',
    faculty_status: 'approved',
  } as unknown as Profile

  const adminWithoutFaculty = {
    id: 'admin-1',
    name: 'Admin',
    role: 'admin',
    faculty_status: 'none',
  } as unknown as Profile

  const pendingFaculty = {
    id: 'faculty-pending',
    name: 'Pending Faculty',
    role: 'faculty',
    faculty_status: 'pending',
  } as unknown as Profile

  it('calls the pin RPC and refreshes the feed for approved faculty', async () => {
    const supabase = makeSupabaseStub()
    const result = await seedAndRender(supabase, approvedFaculty)

    let pinned = false
    await act(async () => {
      pinned = await result.current.pinDiscussion('post-1')
    })

    expect(pinned).toBe(true)
    expect(supabase.rpcCalls).toContainEqual({
      name: 'pin_discussion',
      args: { p_discussion_id: 'post-1' },
    })
    expect(toastMock.success).toHaveBeenCalledWith('Discussion pinned for 7 days.')
  })

  it('calls the unpin RPC for approved faculty', async () => {
    const supabase = makeSupabaseStub()
    const result = await seedAndRender(supabase, approvedFaculty)

    let unpinned = false
    await act(async () => {
      unpinned = await result.current.unpinDiscussion('post-1')
    })

    expect(unpinned).toBe(true)
    expect(supabase.rpcCalls).toContainEqual({
      name: 'unpin_discussion',
      args: { p_discussion_id: 'post-1' },
    })
    expect(toastMock.success).toHaveBeenCalledWith('Discussion unpinned.')
  })

  it('calls the pin RPC for an admin without any faculty verification', async () => {
    const supabase = makeSupabaseStub()
    const result = await seedAndRender(supabase, adminWithoutFaculty)

    let pinned = false
    await act(async () => {
      pinned = await result.current.pinDiscussion('post-1')
    })

    expect(pinned).toBe(true)
    expect(supabase.rpcCalls).toContainEqual({
      name: 'pin_discussion',
      args: { p_discussion_id: 'post-1' },
    })
    expect(toastMock.success).toHaveBeenCalledWith('Discussion pinned for 7 days.')
  })

  it('calls the unpin RPC for an admin without any faculty verification', async () => {
    const supabase = makeSupabaseStub()
    const result = await seedAndRender(supabase, adminWithoutFaculty)

    let unpinned = false
    await act(async () => {
      unpinned = await result.current.unpinDiscussion('post-1')
    })

    expect(unpinned).toBe(true)
    expect(supabase.rpcCalls).toContainEqual({
      name: 'unpin_discussion',
      args: { p_discussion_id: 'post-1' },
    })
    expect(toastMock.success).toHaveBeenCalledWith('Discussion unpinned.')
  })

  it('never calls the RPC for a student', async () => {
    const supabase = makeSupabaseStub()
    const result = await seedAndRender(supabase, authorProfile)

    let pinned = true
    await act(async () => {
      pinned = await result.current.pinDiscussion('post-1')
    })

    expect(pinned).toBe(false)
    expect(supabase.rpcCalls).toHaveLength(0)
    expect(toastMock.error).toHaveBeenCalledWith(PIN_PERMISSION_MESSAGE)
  })

  it('never calls the RPC for unapproved faculty', async () => {
    const supabase = makeSupabaseStub()
    const result = await seedAndRender(supabase, pendingFaculty)

    let pinned = true
    await act(async () => {
      pinned = await result.current.pinDiscussion('post-1')
    })

    expect(pinned).toBe(false)
    expect(supabase.rpcCalls).toHaveLength(0)
    expect(toastMock.error).toHaveBeenCalledWith(PIN_PERMISSION_MESSAGE)
  })

  it('shows the global-limit message when the database rejects a pin', async () => {
    const supabase = makeSupabaseStub()
    supabase.setRpcResult('pin_discussion', {
      data: null,
      error: {
        message:
          'The community already has 3 active pinned discussions. Wait for a pin to expire or unpin one first.',
      },
    })
    const result = await seedAndRender(supabase, approvedFaculty)

    let pinned = true
    await act(async () => {
      pinned = await result.current.pinDiscussion('post-1')
    })

    expect(pinned).toBe(false)
    expect(toastMock.error).toHaveBeenCalledWith(PIN_LIMIT_MESSAGE)
  })
})
