import { describe, it, expect, beforeEach, vi } from 'vitest'
import { subMonths } from 'date-fns'
import { GET } from './route'

/**
 * Tests for the six-month community activity CSV export route.
 *
 * Pins the 403 authorization contract (administrators and approved faculty
 * only), the rolling six-month date window on `created_at`, the single CSV
 * structure with `record_type`, empty-result header-only output, and graceful
 * failure on database errors.
 */
const state = vi.hoisted(() => ({
  user: null as null | { id: string },
  authError: null as null | { message: string },
  profile: null as null | Record<string, unknown>,
  profileError: null as null | { message: string },
  events: [] as Record<string, unknown>[],
  posts: [] as Record<string, unknown>[],
  announcements: [] as Record<string, unknown>[],
  dbError: null as null | { message: string },
  // Captured per-table filters so the mock can reproduce the server-side
  // date-window behaviour in tests.
  filters: {} as Record<string, { gte?: unknown; lte?: unknown; eq?: unknown }>,
  // Captured profiles query so a test can prove the route reads the caller's
  // own row and only the authorization columns.
  profileQuery: { id: null as unknown, columns: null as unknown },
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => makeClient(),
}))

function resultFor(table: string) {
  if (table === 'profiles') {
    return { data: state.profile, error: state.profileError }
  }
  const dbError = state.dbError
  if (dbError) return { data: null, error: dbError }
  if (table === 'events') return { data: state.events, error: null }
  if (table === 'posts') return { data: state.posts, error: null }
  if (table === 'announcements') return { data: state.announcements, error: null }
  return { data: null, error: null }
}

function matchesFilters(row: Record<string, unknown>, f: { gte?: unknown; lte?: unknown; eq?: unknown }): boolean {
  if (f.gte !== null && f.gte !== undefined) {
    const value = row.created_at
    if (typeof value !== 'string' || value < String(f.gte)) return false
  }
  if (f.lte !== null && f.lte !== undefined) {
    const value = row.created_at
    if (typeof value !== 'string' || value > String(f.lte)) return false
  }
  if (f.eq !== null && f.eq !== undefined) {
    if (row.type !== f.eq) return false
  }
  return true
}

function makeClient() {
  return {
    auth: {
      getUser: async () => ({ data: { user: state.user }, error: state.authError }),
    },
    from(table: string) {
      const filters: { gte?: unknown; lte?: unknown; eq?: unknown } = {}
      state.filters[table] = filters
      const proxy: unknown = new Proxy(
        {},
        {
          get(_target, property) {
            const name = String(property)
            if (name === 'then') {
              return (resolve: (value: unknown) => void) => {
                const { data, error } = resultFor(table)
                // Profiles is read as a single object (maybeSingle), not a
                // filtered list — pass it through unchanged.
                if (table === 'profiles') {
                  resolve({ data, error })
                  return
                }
                let rows = Array.isArray(data) ? [...data] : []
                const f = state.filters[table] ?? {}
                rows = rows.filter(row => matchesFilters(row, f))
                resolve({ data: rows, error })
              }
            }
            if (name === 'eq') {
              return (column: unknown, value: unknown) => {
                if (column === 'type') filters.eq = value
                if (table === 'profiles' && column === 'id') {
                  state.profileQuery.id = value
                }
                return proxy
              }
            }
            if (name === 'gte' || name === 'lte') {
              return (_column: unknown, value: unknown) => {
                filters[name === 'gte' ? 'gte' : 'lte'] = value
                return proxy
              }
            }
            if (name === 'select') {
              return (columns: unknown, ..._args: unknown[]) => {
                if (table === 'profiles') state.profileQuery.columns = columns
                return proxy
              }
            }
            // order, limit etc. are no-ops in the mock; must be callable and
            // return the proxy so chaining works.
            return (..._args: unknown[]) => proxy
          },
        },
      )
      return proxy
    },
  }
}

const adminProfile = { role: 'admin', faculty_status: 'approved' }
const unapprovedAdminProfile = { role: 'admin', faculty_status: null }
const approvedFacultyProfile = { role: 'faculty', faculty_status: 'approved' }
const legacyVerifiedFacultyProfile = { role: 'faculty', faculty_status: 'verified' }
const pendingFacultyProfile = { role: 'faculty', faculty_status: 'pending' }
const rejectedFacultyProfile = { role: 'faculty', faculty_status: 'rejected' }
const studentProfile = { role: 'student', faculty_status: 'none' }
const alumniProfile = { role: 'student', faculty_status: 'none', member_type: 'alumni' }

// Relative to the test clock so the fixtures never age out of the rolling
// six-month window and turn CI red on a calendar boundary.
const recentIso = new Date().toISOString()

const baseEvent = {
  id: 'e1',
  title: 'Workshop',
  description: 'Hands-on',
  host_id: 'u1',
  created_at: recentIso,
}
const basePost = {
  id: 'p1',
  title: 'Showcase',
  body: 'A project',
  type: 'showcase',
  author_id: 'u2',
  created_at: recentIso,
}
const baseAnnouncement = {
  id: 'a1',
  title: 'Notice',
  body: 'Read this',
  author_id: 'u3',
  created_at: recentIso,
}

beforeEach(() => {
  state.user = null
  state.authError = null
  state.profile = null
  state.profileError = null
  state.events = []
  state.posts = []
  state.announcements = []
  state.dbError = null
  state.filters = {}
  state.profileQuery = { id: null, columns: null }
})

describe('GET /api/export/community-activity', () => {
  it('rejects a signed-out caller with 403 and returns no CSV', async () => {
    const response = await GET()

    expect(response.status).toBe(403)
    expect(response.headers.get('content-type')).not.toContain('text/csv')
  })

  it('rejects a student with 403', async () => {
    state.user = { id: 'u-student' }
    state.profile = studentProfile

    const response = await GET()
    expect(response.status).toBe(403)
  })

  it('rejects an alumni with 403', async () => {
    state.user = { id: 'u-alumni' }
    state.profile = alumniProfile

    expect((await GET()).status).toBe(403)
  })

  it('rejects a pending faculty member with 403', async () => {
    state.user = { id: 'u-pending' }
    state.profile = pendingFacultyProfile

    expect((await GET()).status).toBe(403)
  })

  it('rejects a rejected faculty member with 403', async () => {
    state.user = { id: 'u-rejected' }
    state.profile = rejectedFacultyProfile

    expect((await GET()).status).toBe(403)
  })

  it('rejects a profile with the approved status but a non-faculty role', async () => {
    state.user = { id: 'u-student-approved' }
    state.profile = { role: 'student', faculty_status: 'approved' }

    expect((await GET()).status).toBe(403)
  })

  it('rejects a caller whose current profile cannot be read', async () => {
    state.user = { id: 'u1' }
    state.profile = null
    state.profileError = { message: 'profile unavailable' }

    expect((await GET()).status).toBe(403)
  })

  it('returns CSV for an approved faculty member', async () => {
    state.user = { id: 'u-faculty' }
    state.profile = approvedFacultyProfile
    state.events = [baseEvent]

    const response = await GET()

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/csv')
    expect(await response.text()).toContain('Workshop')
  })

  it("reads the caller's own current profile and only the authorization columns", async () => {
    state.user = { id: 'u-faculty' }
    state.profile = approvedFacultyProfile

    await GET()

    expect(state.profileQuery.id).toBe('u-faculty')
    expect(state.profileQuery.columns).toBe('role, faculty_status')
  })

  it('returns CSV for legacy verified faculty', async () => {
    state.user = { id: 'u-verified' }
    state.profile = legacyVerifiedFacultyProfile

    const response = await GET()

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/csv')
  })

  it('rejects an administrator who is not an approved faculty member', async () => {
    state.user = { id: 'u-admin-unapproved' }
    state.profile = unapprovedAdminProfile

    expect((await GET()).status).toBe(403)
  })

  it('returns CSV for an administrator who is also approved faculty', async () => {
    state.user = { id: 'u-admin' }
    state.profile = adminProfile
    state.events = [baseEvent]
    state.posts = [basePost]
    state.announcements = [baseAnnouncement]

    const response = await GET()

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/csv')
    expect(response.headers.get('content-type')).toContain('charset=utf-8')
    const disposition = response.headers.get('content-disposition') ?? ''
    expect(disposition).toContain('attachment')
    expect(disposition).toContain('.csv')

    const text = await response.text()
    expect(text).toContain('record_type')
    expect(text).toContain('event')
    expect(text).toContain('showcase')
    expect(text).toContain('announcement')
    expect(text).toContain('Workshop')
    expect(text).toContain('Showcase')
    expect(text).toContain('Notice')
  })

  it('writes the dynamic window and generation metadata into the CSV', async () => {
    state.user = { id: 'u-admin' }
    state.profile = adminProfile

    const response = await GET()
    const text = await response.text()

    const start = response.headers.get('x-export-start-date')
    const end = response.headers.get('x-export-end-date')
    const generatedAt = response.headers.get('x-export-generated-at')

    expect(start).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(end).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(response.headers.get('x-export-window-boundary')).toBe('inclusive')
    expect(response.headers.get('x-export-record-types')).toBe(
      'event;showcase;announcement',
    )

    expect(text).toContain(`export_metadata,start_date,${start}`)
    expect(text).toContain(`export_metadata,end_date,${end}`)
    expect(text).toContain(`export_metadata,exported_at,${generatedAt}`)
    expect(text).toContain('export_metadata,window_boundary,inclusive (UTC)')
    expect(text).toContain(
      'export_metadata,included_record_types,event;showcase;announcement',
    )
    expect(response.headers.get('content-disposition')).toContain(
      `ucc-community-activity-${start}-to-${end}.csv`,
    )
  })

  it('computes the window from the request clock across a month boundary', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-31T23:30:00.000Z'))
    try {
      state.user = { id: 'u-admin' }
      state.profile = adminProfile

      const response = await GET()
      const text = await response.text()

      expect(response.headers.get('x-export-start-date')).toBe('2025-09-30')
      expect(response.headers.get('x-export-end-date')).toBe('2026-03-31')
      expect(text).toContain('export_metadata,start_date,2025-09-30')
      expect(text).toContain('export_metadata,end_date,2026-03-31')

      const f = state.filters.events ?? {}
      expect(f.gte).toBe('2025-09-30T23:30:00.000Z')
      expect(f.lte).toBe('2026-03-31T23:30:00.000Z')
    } finally {
      vi.useRealTimers()
    }
  })

  it('uses inclusive start and end boundaries for the query', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-22T12:00:00.000Z'))
    try {
      state.user = { id: 'u-admin' }
      state.profile = adminProfile
      state.events = [
        // Exactly on the inclusive lower bound.
        { ...baseEvent, id: 'e-start', created_at: '2026-04-22T12:00:00.000Z' },
        // Exactly on the inclusive upper bound.
        { ...baseEvent, id: 'e-end', created_at: '2026-10-22T12:00:00.000Z' },
        // One millisecond outside each side.
        { ...baseEvent, id: 'e-too-old', created_at: '2026-04-22T11:59:59.999Z' },
        { ...baseEvent, id: 'e-too-new', created_at: '2026-10-22T12:00:00.001Z' },
      ]

      const text = await (await GET()).text()

      expect(text).toContain('e-start')
      expect(text).toContain('e-end')
      expect(text).not.toContain('e-too-old')
      expect(text).not.toContain('e-too-new')
    } finally {
      vi.useRealTimers()
    }
  })

  it('emits a header plus manifest and no data rows when there is no activity', async () => {
    state.user = { id: 'u-admin' }
    state.profile = adminProfile

    const response = await GET()
    const text = await response.text()

    expect(response.status).toBe(200)
    // One header row + six manifest rows, no business rows.
    expect(text.split('\r\n').filter(Boolean).length).toBe(7)
    expect(text).toContain('record_type')
    expect(text).toContain('export_metadata,start_date')
  })

  it('applies the six-month window on created_at for every record type', async () => {
    state.user = { id: 'u-admin' }
    state.profile = adminProfile

    const now = new Date()
    const inWindow = subMonths(now, 1).toISOString()
    const olderThanSixMonths = subMonths(now, 7).toISOString()

    state.events = [
      { ...baseEvent, id: 'e-in', created_at: inWindow },
      { ...baseEvent, id: 'e-old', created_at: olderThanSixMonths },
    ]
    state.posts = [
      { ...basePost, id: 'p-in', created_at: inWindow },
      { ...basePost, id: 'p-old', created_at: olderThanSixMonths },
    ]
    state.announcements = [
      { ...baseAnnouncement, id: 'a-in', created_at: inWindow },
      { ...baseAnnouncement, id: 'a-old', created_at: olderThanSixMonths },
    ]

    const response = await GET()
    const text = await response.text()

    expect(text).toContain('e-in')
    expect(text).toContain('p-in')
    expect(text).toContain('a-in')
    expect(text).not.toContain('e-old')
    expect(text).not.toContain('p-old')
    expect(text).not.toContain('a-old')
  })

  it('passes the six-month window bounds to the query', async () => {
    state.user = { id: 'u-admin' }
    state.profile = adminProfile

    const before = new Date()
    await GET()
    const after = new Date()

    const fromBefore = subMonths(before, 6)
    const fromAfter = subMonths(after, 6)

    for (const table of ['events', 'posts', 'announcements']) {
      const f = state.filters[table] ?? {}
      const gte = new Date(String(f.gte)).getTime()
      const lte = new Date(String(f.lte)).getTime()

      // Tolerate a few ms between the test clock and the route's clock.
      expect(gte).toBeGreaterThanOrEqual(fromBefore.getTime() - 1000)
      expect(gte).toBeLessThanOrEqual(fromAfter.getTime() + 1000)
      expect(lte).toBeGreaterThanOrEqual(before.getTime() - 1000)
      expect(lte).toBeLessThanOrEqual(after.getTime() + 1000)
    }
  })

  it('surfaces a database error as 500 instead of a malformed CSV', async () => {
    state.user = { id: 'u-admin' }
    state.profile = adminProfile
    state.dbError = { message: 'connection failed' }

    const response = await GET()

    expect(response.status).toBe(500)
    const body = (await response.json()) as { error?: string }
    expect(body.error).toBe('Export failed.')
  })
})
