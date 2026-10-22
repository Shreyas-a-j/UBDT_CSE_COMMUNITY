/**
 * GET /api/export/community-activity
 *
 * Downloadable CSV export of community activity from the trailing six
 * calendar months.
 *
 * Authorization: the caller must be signed in and currently be an approved
 * faculty member, read from the database on every request. Approved means
 * `profiles.faculty_status` is `'approved'` (or the legacy `'verified'`
 * spelling, which the live database also uses for the same state) together
 * with `profiles.role = 'faculty'`. An administrator also qualifies, because
 * the single-admin role may only be held by an approved faculty member and is
 * required to retain approved-faculty permissions.
 *
 * Pending and rejected applicants, students, alumni and signed-out visitors
 * are denied. The check is performed server-side from the database profile —
 * never from anything the client sends — and the Supabase RLS policies remain
 * in force. No service-role key is ever used or exposed.
 *
 * Record types exported (single consistent CSV structure, identified by the
 * `record_type` column):
 *   - event        (public.events)
 *   - showcase     (public.posts where type = 'showcase')
 *   - announcement (public.announcements)
 *
 * All three tables use `created_at` (timestamp with time zone) as the
 * timestamp field, so the six-month window is applied uniformly. The window is
 * [now - 6 calendar months, now], inclusive at both ends, computed on the
 * server at export time in UTC — never hardcoded.
 *
 * The CSV itself contains `start_date`, `end_date`, `exported_at`,
 * `window_boundary` and `included_record_types` manifest rows
 * (`record_type = export_metadata`). The same values are mirrored in response
 * headers and in the download UI.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isApprovedFacultyStatus } from '@/lib/profile'
import {
  EXPORT_RECORD_TYPES,
  buildCommunityActivityCsv,
  csvByteLength,
  sixMonthWindow,
  type ActivityRow,
} from '@/lib/csv'

const EXPORT_FILENAME_PREFIX = 'ucc-community-activity'
const PAGE_SIZE = 1000

interface PageResult<T> {
  data: T[] | null
  error: { message: string } | null
}

/**
 * Drains a PostgREST query in pages. Supabase caps each response (1000 rows by
 * default), so a busy six-month window must not be silently truncated. Each
 * page re-issues the query with a new `range` offset until a short page is
 * returned.
 */
async function fetchAllRows<T>(
  build: (offset: number, limit: number) => PromiseLike<PageResult<T>>,
): Promise<PageResult<T>> {
  const all: T[] = []
  let offset = 0
  for (;;) {
    const { data, error } = await build(offset, PAGE_SIZE)
    if (error) return { data: null, error }
    const rows = data ?? []
    all.push(...rows)
    if (rows.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }
  return { data: all, error: null }
}

/**
 * The one export rule, kept explicit so it is easy to audit: the role must be
 * faculty (or the approved-faculty admin role) AND the database approval
 * status must be an approved spelling. This is deliberately stricter than
 * `isApprovedFaculty`, which treats any admin as verified for legacy display.
 */
export function canExportCommunityActivity(profile?: {
  role?: unknown
  faculty_status?: unknown
} | null): boolean {
  if (!profile) return false
  if (!isApprovedFacultyStatus(profile.faculty_status)) return false
  return profile.role === 'faculty' || profile.role === 'admin'
}

/**
 * Reads the caller's current database profile and returns the user only when
 * the caller may export community activity. Returns null when not signed in,
 * when the profile cannot be read, or when the caller is not authorised.
 *
 * This runs on the server with the caller's own Supabase session, so the
 * profile comes from the database rather than from a client-provided role.
 */
async function requireExportAccess(
  supabase: Awaited<ReturnType<typeof createClient>>,
) {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) return null

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role, faculty_status')
    .eq('id', user.id)
    .maybeSingle()

  if (profileError || !profile || !canExportCommunityActivity(profile)) {
    return null
  }
  return user
}

function mapEventRow(row: Record<string, unknown>): ActivityRow {
  const host = (row.host ?? row.profiles) as { name?: string | null } | null
  return {
    record_type: 'event',
    id: String(row.id ?? ''),
    title: String(row.title ?? ''),
    body: String(row.description ?? ''),
    author_id: String(row.host_id ?? ''),
    author_name: host?.name ?? '',
    created_at: String(row.created_at ?? ''),
    event_date: (row.event_date as string | null) ?? null,
    event_time: (row.event_time as string | null) ?? null,
    duration_minutes:
      typeof row.duration === 'number' ? row.duration : null,
    link: (row.link as string | null) ?? null,
    host_id: String(row.host_id ?? ''),
    host_name: host?.name ?? null,
    type: (row.type as string | null) ?? null,
  }
}

function mapPostRow(row: Record<string, unknown>): ActivityRow {
  const author = (row.author ?? row.profiles) as {
    name?: string | null
  } | null
  return {
    record_type: 'showcase',
    id: String(row.id ?? ''),
    title: String(row.title ?? ''),
    body: String(row.body ?? ''),
    author_id: String(row.author_id ?? ''),
    author_name: author?.name ?? '',
    created_at: String(row.created_at ?? ''),
    post_type: (row.type as string | null) ?? null,
    image_url: (row.image_url as string | null) ?? null,
    github_url: (row.github_url as string | null) ?? null,
    demo_url: (row.demo_url as string | null) ?? null,
    tech_stack: Array.isArray(row.tech_stack) ? (row.tech_stack as string[]) : null,
    tags: Array.isArray(row.tags) ? (row.tags as string[]) : null,
    target_years: Array.isArray(row.target_years)
      ? (row.target_years as number[])
      : null,
  }
}

function mapAnnouncementRow(row: Record<string, unknown>): ActivityRow {
  const author = (row.author ?? row.profiles) as {
    name?: string | null
  } | null
  return {
    record_type: 'announcement',
    id: String(row.id ?? ''),
    title: String(row.title ?? ''),
    body: String(row.body ?? ''),
    author_id: String(row.author_id ?? ''),
    author_name: author?.name ?? '',
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? row.created_at ?? ''),
    image_urls: Array.isArray(row.image_urls)
      ? (row.image_urls as string[])
      : null,
  }
}

export async function GET() {
  const supabase = await createClient()
  const authorised = await requireExportAccess(supabase)
  if (!authorised) {
    return NextResponse.json(
      { error: 'Approved faculty access required.' },
      { status: 403 },
    )
  }

  // One clock reading drives the query window, the filename, the manifest
  // rows and the headers. Nothing in this route is date-hardcoded.
  const now = new Date()
  const window = sixMonthWindow(now)
  const generatedAt = now.toISOString()

  // Fetch each record type from the trailing six months using created_at.
  // Both bounds are inclusive. Paginated so a busy window is exported in full.
  const [eventsRes, postsRes, announcementsRes] = await Promise.all([
    fetchAllRows<Record<string, unknown>>((offset, limit) =>
      supabase
        .from('events')
        .select(`
          *,
          host:profiles!host_id (name)
        `)
        .gte('created_at', window.from)
        .lte('created_at', window.to)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1),
    ),

    fetchAllRows<Record<string, unknown>>((offset, limit) =>
      supabase
        .from('posts')
        .select(`
          *,
          author:profiles!author_id (name)
        `)
        .eq('type', 'showcase')
        .gte('created_at', window.from)
        .lte('created_at', window.to)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1),
    ),

    fetchAllRows<Record<string, unknown>>((offset, limit) =>
      supabase
        .from('announcements')
        .select(`
          *,
          author:profiles!author_id (name)
        `)
        .gte('created_at', window.from)
        .lte('created_at', window.to)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1),
    ),
  ])

  const errors = [
    eventsRes.error && `events: ${eventsRes.error.message}`,
    postsRes.error && `posts: ${postsRes.error.message}`,
    announcementsRes.error && `announcements: ${announcementsRes.error.message}`,
  ].filter(Boolean)

  if (errors.length) {
    // Keep database details in the server log; the caller receives a generic
    // failure so table/column names and policy hints are not reflected back.
    console.error('Community activity export failed:', errors.join(' · '))
    return NextResponse.json({ error: 'Export failed.' }, { status: 500 })
  }

  const rows: ActivityRow[] = [
    ...((eventsRes.data ?? []) as Record<string, unknown>[]).map(mapEventRow),
    ...((postsRes.data ?? []) as Record<string, unknown>[]).map(mapPostRow),
    ...((announcementsRes.data ?? []) as Record<string, unknown>[]).map(
      mapAnnouncementRow,
    ),
  ]

  // Newest first across all types.
  rows.sort((a, b) => {
    const at = new Date(a.created_at).getTime()
    const bt = new Date(b.created_at).getTime()
    return bt - at
  })

  const csv = buildCommunityActivityCsv(rows, {
    startDate: window.startDate,
    endDate: window.endDate,
    generatedAt,
    recordTypes: EXPORT_RECORD_TYPES,
  })

  const filename =
    `${EXPORT_FILENAME_PREFIX}-${window.startDate}-to-${window.endDate}.csv`

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(csvByteLength(csv)),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      // Mirrors the manifest rows for clients that inspect headers only.
      'X-Export-Start-Date': window.startDate,
      'X-Export-End-Date': window.endDate,
      'X-Export-Generated-At': generatedAt,
      'X-Export-Window-Boundary': 'inclusive',
      'X-Export-Record-Types': EXPORT_RECORD_TYPES.join(';'),
    },
  })
}
