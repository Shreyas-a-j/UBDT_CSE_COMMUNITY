import { describe, it, expect } from 'vitest'
import { subMonths } from 'date-fns'
import {
  escapeCell,
  rowToCsv,
  buildCommunityActivityCsv,
  sixMonthWindow,
  CSV_HEADER,
  EXPORT_MANIFEST_RECORD_TYPE,
  EXPORT_RECORD_TYPES,
  manifestRows,
  rowToCells,
  type ActivityRow,
  type ExportMetadata,
} from '@/lib/csv'

const metadata: ExportMetadata = {
  startDate: '2026-04-22',
  endDate: '2026-10-22',
  generatedAt: '2026-10-22T12:00:00.000Z',
  recordTypes: EXPORT_RECORD_TYPES,
}

describe('escapeCell', () => {
  it('emits plain values verbatim', () => {
    expect(escapeCell('hello')).toBe('hello')
    expect(escapeCell(42)).toBe('42')
    expect(escapeCell(null)).toBe('')
    expect(escapeCell(undefined)).toBe('')
  })

  it('wraps values containing commas in quotes', () => {
    expect(escapeCell('a, b, c')).toBe('"a, b, c"')
  })

  it('doubles inner quotes and wraps', () => {
    expect(escapeCell('say "hi"')).toBe('"say ""hi"""')
  })

  it('wraps values containing newlines', () => {
    expect(escapeCell('line1\nline2')).toBe('"line1\nline2"')
    expect(escapeCell('line1\r\nline2')).toBe('"line1\r\nline2"')
  })

  it('neutralizes formula injection prefixes', () => {
    expect(escapeCell('=1+1')).toBe('\t=1+1')
    expect(escapeCell('+1+1')).toBe('\t+1+1')
    expect(escapeCell('-1+1')).toBe('\t-1+1')
    expect(escapeCell('@sum(A1)')).toBe('\t@sum(A1)')
    // A formula character inside (not leading) is left alone.
    expect(escapeCell('a=b')).toBe('a=b')
    // Leading formula char is tab-neutralized even when the cell is quoted.
    expect(escapeCell('=1+1, "x"')).toBe('"\t=1+1, ""x"""')
  })
})

describe('rowToCsv', () => {
  it('joins cells with commas and terminates with CRLF', () => {
    expect(rowToCsv(['a', 'b', 'c'])).toBe('a,b,c\r\n')
  })
})

describe('sixMonthWindow', () => {
  it('computes a six-calendar-month window relative to now', () => {
    const now = new Date(Date.UTC(2026, 9, 22, 12, 0, 0)) // 2026-10-22
    const { from, to, startDate, endDate, label } = sixMonthWindow(now)

    expect(to).toBe('2026-10-22T12:00:00.000Z')
    expect(from).toBe('2026-04-22T12:00:00.000Z')
    expect(startDate).toBe('2026-04-22')
    expect(endDate).toBe('2026-10-22')
    expect(label).toBe('2026-04-22 to 2026-10-22')
  })

  it('uses the current date when none is supplied', () => {
    const { from } = sixMonthWindow()
    const expectedFrom = subMonths(new Date(), 6)
    // Compare at day granularity.
    expect(from.slice(0, 10)).toBe(
      expectedFrom.toISOString().slice(0, 10),
    )
  })

  it('clamps month-end dates instead of overflowing into the next month', () => {
    const marchEnd = sixMonthWindow(new Date('2026-03-31T00:00:00.000Z'))
    expect(marchEnd.startDate).toBe('2025-09-30')
    expect(marchEnd.endDate).toBe('2026-03-31')

    const augustEnd = sixMonthWindow(new Date('2026-08-31T12:00:00.000Z'))
    expect(augustEnd.startDate).toBe('2026-02-28')
    expect(augustEnd.endDate).toBe('2026-08-31')

    const leapDay = sixMonthWindow(new Date('2024-02-29T12:00:00.000Z'))
    expect(leapDay.startDate).toBe('2023-08-29')
    expect(leapDay.endDate).toBe('2024-02-29')
  })

  it('preserves the exact time of day at both boundaries', () => {
    const now = new Date('2026-01-31T23:59:59.000Z')
    const window = sixMonthWindow(now)

    expect(window.from).toBe('2025-07-31T23:59:59.000Z')
    expect(window.to).toBe('2026-01-31T23:59:59.000Z')
  })

  it('rejects an invalid date rather than silently exporting the wrong window', () => {
    expect(() => sixMonthWindow(new Date('not-a-date'))).toThrow(TypeError)
  })
})

describe('rowToCells / CSV_HEADER', () => {
  const eventRow: ActivityRow = {
    record_type: 'event',
    id: 'e1',
    title: 'Workshop',
    body: 'Learn things',
    author_id: 'u1',
    author_name: 'Dr Rao',
    created_at: '2026-10-20T09:00:00.000Z',
    updated_at: '2026-10-20T09:00:00.000Z',
    event_date: '2026-10-25',
    event_time: '10:00:00',
    duration_minutes: 60,
    link: 'https://example.com',
    host_id: 'u1',
    host_name: 'Dr Rao',
    type: 'Workshop',
  }

  const showcaseRow: ActivityRow = {
    record_type: 'showcase',
    id: 'p1',
    title: 'My Project',
    body: 'A showcase post',
    author_id: 'u2',
    author_name: 'Student',
    created_at: '2026-10-21T09:00:00.000Z',
    updated_at: '2026-10-21T09:00:00.000Z',
    post_type: 'showcase',
    image_url: 'https://cdn.test/1.png',
    github_url: 'https://github.com/me/proj',
    demo_url: 'https://proj.vercel.app',
    tech_stack: ['React', 'Supabase'],
    tags: ['web', 'project'],
    target_years: [3, 4],
  }

  const announcementRow: ActivityRow = {
    record_type: 'announcement',
    id: 'a1',
    title: 'Deadline',
    body: 'Submit by Friday',
    author_id: 'u3',
    author_name: 'Faculty',
    created_at: '2026-10-22T09:00:00.000Z',
    updated_at: '2026-10-22T09:00:00.000Z',
    image_urls: ['https://cdn.test/a.png'],
  }

  it('has record_type as the first column', () => {
    expect(CSV_HEADER[0]).toBe('record_type')
  })

  it('maps an event row to the full column count', () => {
    const cells = rowToCells(eventRow)
    expect(cells).toHaveLength(CSV_HEADER.length)
    expect(cells[0]).toBe('event')
    expect(cells[8]).toBe('2026-10-25') // event_date
  })

  it('maps a showcase row with empty event columns', () => {
    const cells = rowToCells(showcaseRow)
    expect(cells).toHaveLength(CSV_HEADER.length)
    expect(cells[0]).toBe('showcase')
    expect(cells[8]).toBe('') // event_date empty for non-event
    expect(cells[15]).toBe('showcase') // post_type
    expect(cells[19]).toBe('React;Supabase') // tech_stack joined
  })

  it('maps an announcement row with image_urls last', () => {
    const cells = rowToCells(announcementRow)
    expect(cells).toHaveLength(CSV_HEADER.length)
    expect(cells[0]).toBe('announcement')
    expect(cells[CSV_HEADER.length - 1]).toBe('https://cdn.test/a.png')
  })
})

describe('CSV manifest rows', () => {
  it('uses the same rectangular shape as data rows', () => {
    for (const cells of manifestRows(metadata)) {
      expect(cells).toHaveLength(CSV_HEADER.length)
      expect(cells[0]).toBe(EXPORT_MANIFEST_RECORD_TYPE)
    }
  })

  it('includes start_date, end_date, exported_at and record types', () => {
    const byKey = new Map(
      manifestRows(metadata).map(cells => [String(cells[1]), String(cells[2])]),
    )

    expect(byKey.get('start_date')).toBe('2026-04-22')
    expect(byKey.get('end_date')).toBe('2026-10-22')
    expect(byKey.get('window_boundary')).toBe('inclusive (UTC)')
    expect(byKey.get('lookback')).toBe('6 calendar months')
    expect(byKey.get('exported_at')).toBe('2026-10-22T12:00:00.000Z')
    expect(byKey.get('included_record_types')).toBe(
      'event;showcase;announcement',
    )
  })
})

describe('buildCommunityActivityCsv', () => {
  it('emits a header row even for empty results', () => {
    const csv = buildCommunityActivityCsv([])
    expect(csv).toBe(rowToCsv(CSV_HEADER))
  })

  it('emits the manifest before data rows and keeps every row rectangular', () => {
    const rows: ActivityRow[] = [
      {
        record_type: 'event',
        id: 'e1',
        title: 'Workshop',
        body: 'Café naïve',
        author_id: 'u1',
        author_name: 'Dr Rao',
        created_at: '2026-10-20T09:00:00.000Z',
        event_date: '2026-10-25',
      },
    ]

    const csv = buildCommunityActivityCsv(rows, metadata)
    const lines = csv.split('\r\n').filter(Boolean)

    expect(lines[0]).toBe(rowToCsv(CSV_HEADER).trimEnd())
    expect(lines[1]).toContain(
      `${EXPORT_MANIFEST_RECORD_TYPE},start_date,2026-04-22`,
    )

    const columnCount = CSV_HEADER.length
    for (const line of lines) {
      expect(line.split(',').length).toBe(columnCount)
    }

    // Manifest rows come before the business row, which is last.
    expect(lines[lines.length - 1]).toContain('event,e1,Workshop')
  })

  it('emits manifest-only CSV when there is no activity', () => {
    const csv = buildCommunityActivityCsv([], metadata)
    const lines = csv.split('\r\n').filter(Boolean)
    expect(lines).toHaveLength(1 + manifestRows(metadata).length)
    expect(csv).toContain('start_date,2026-04-22')
    expect(csv).toContain('end_date,2026-10-22')
  })

  it('escapes and formula-protects data rows', () => {
    const rows: ActivityRow[] = [
      {
        record_type: 'announcement',
        id: 'a1',
        title: '=1+1',
        body: 'a, "b"',
        author_id: 'u1',
        author_name: 'x',
        created_at: '2026-10-22T09:00:00.000Z',
        updated_at: '2026-10-22T09:00:00.000Z',
      },
    ]
    const csv = buildCommunityActivityCsv(rows, metadata)
    const lines = csv.split('\r\n').filter(Boolean)
    expect(lines).toHaveLength(2 + manifestRows(metadata).length)
    // Title cell should be tab-neutralized and quoted where needed.
    expect(csv).toContain('\t=1+1')
    expect(csv).toContain('"a, ""b"""')
  })

  it('formula-protects a manifest value as well', () => {
    const csv = buildCommunityActivityCsv([], {
      ...metadata,
      startDate: '=2026-04-22',
    })
    expect(csv).toContain('\t=2026-04-22')
  })

  it('uses UTF-8 encodable output', () => {
    const rows: ActivityRow[] = [
      {
        record_type: 'event',
        id: 'e1',
        title: 'Workshop',
        body: 'Café naïve',
        author_id: 'u1',
        author_name: 'Dr Rao',
        created_at: '2026-10-22T09:00:00.000Z',
        updated_at: '2026-10-22T09:00:00.000Z',
        event_date: '2026-10-25',
      },
    ]
    const csv = buildCommunityActivityCsv(rows, metadata)
    expect(() => new TextEncoder().encode(csv)).not.toThrow()
    expect(csv).toContain('Café naïve')
  })
})
