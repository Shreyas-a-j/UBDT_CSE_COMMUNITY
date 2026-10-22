/**
 * Six-month community activity CSV export.
 *
 * Produces a single RFC 4180-compliant CSV document covering the trailing six
 * calendar months of community activity: events, project showcase posts, and
 * announcements.
 *
 * Date window
 * -----------
 * The window is recomputed from the current instant on every request. It is a
 * rolling six-calendar-month lookback (not 180 fixed days), expressed in UTC:
 *
 *   start = now - 6 calendar months
 *   end   = now
 *
 * Both boundaries are inclusive: a record is included when
 *
 *   created_at >= start AND created_at <= end
 *
 * `date-fns`' `subMonths` clamps month-end dates correctly (for example
 * 2026-08-31 -> 2026-02-28), so the window never points at a non-existent day.
 *
 * Metadata without corrupting the table
 * -------------------------------------
 * The CSV has a fixed header and a fixed number of columns. Immediately after
 * the header, the export writes a small manifest as rows whose
 * `record_type` is `export_metadata`. Manifest rows use the same column count
 * as data rows, so any RFC 4180 parser can still read the file as a
 * rectangular table. Consumers that only want business records filter on
 * `record_type` (all data rows are `event`, `showcase`, or `announcement`).
 *
 * Security notes:
 *  - Cells beginning with `=`, `+`, `-`, or `@` are prefixed with a tab
 *    character so spreadsheet applications do not interpret them as formulas.
 *  - Fields containing commas, double quotes, or newlines are wrapped in
 *    double quotes and inner quotes are doubled.
 *  - The export is generated server-side only; authorization is enforced in
 *    the API route, never by hiding a button.
 */

import { subMonths } from 'date-fns'

/**
 * Characters that make a cell dangerous when a spreadsheet opens the CSV.
 * A leading tab is the standard neutralizer.
 */
const FORMULA_PREFIX_CHARS = ['=', '+', '-', '@']

/** The record types included in the export, in documentation order. */
export const EXPORT_RECORD_TYPES = [
  'event',
  'showcase',
  'announcement',
] as const

export type ExportRecordType = (typeof EXPORT_RECORD_TYPES)[number]

/**
 * Sentinel `record_type` for manifest rows. It deliberately cannot collide
 * with a real record type.
 */
export const EXPORT_MANIFEST_RECORD_TYPE = 'export_metadata'

/**
 * Escapes a single CSV cell per RFC 4180 and neutralizes formula injection.
 *
 * - Cells that start with a formula character are prefixed with a tab so
 *   Excel, Sheets, LibreOffice etc. treat the cell as text.
 * - Cells containing a comma, double quote, line feed, or carriage return are
 *   wrapped in double quotes; inner double quotes are doubled.
 * - Everything else is emitted verbatim.
 */
export function escapeCell(value: unknown): string {
  const raw =
    value === null || value === undefined ? '' : String(value)

  // Neutralize formula injection: a leading formula character becomes a
  // leading tab, which spreadsheets strip when displaying but which prevents
  // formula execution.
  let cell = raw
  if (FORMULA_PREFIX_CHARS.includes(cell[0] ?? '')) {
    cell = `\t${cell}`
  }

  const needsQuotes =
    /[",\r\n]/.test(cell)

  if (!needsQuotes) return cell

  return `"${cell.replace(/"/g, '""')}"`
}

/**
 * Joins escaped cells with commas and terminates with CRLF.
 */
export function rowToCsv(cells: ReadonlyArray<unknown>): string {
  return cells.map(escapeCell).join(',') + '\r\n'
}

export interface SixMonthWindow {
  /** Inclusive lower bound as an ISO-8601 timestamp (UTC). */
  from: string
  /** Inclusive upper bound as an ISO-8601 timestamp (UTC). */
  to: string
  /** Inclusive lower bound as YYYY-MM-DD (UTC). */
  startDate: string
  /** Inclusive upper bound as YYYY-MM-DD (UTC). */
  endDate: string
  /** Human-readable date range. */
  label: string
}

/**
 * The rolling six-month window used by the export, computed relative to the
 * export instant. Both boundaries are inclusive and expressed in UTC.
 *
 * Returns ISO-8601 timestamps suitable for Supabase `gte` / `lte` filters on
 * `created_at` (a `timestamp with time zone` column), plus date-only values
 * for display and manifest rows.
 */
export function sixMonthWindow(now: Date = new Date()): SixMonthWindow {
  if (Number.isNaN(now.getTime())) {
    throw new TypeError('sixMonthWindow requires a valid Date')
  }

  const from = subMonths(now, 6)
  // toISOString() is always UTC, so the window boundaries are deterministic
  // regardless of the server's local timezone.
  return {
    from: from.toISOString(),
    to: now.toISOString(),
    startDate: formatIsoDate(from),
    endDate: formatIsoDate(now),
    label: `${formatIsoDate(from)} to ${formatIsoDate(now)}`,
  }
}

/** YYYY-MM-DD in UTC. Exported for the download UI and tests. */
export function formatIsoDate(date: Date): string {
  return `${String(date.getUTCFullYear()).padStart(4, '0')}-` +
    `${String(date.getUTCMonth() + 1).padStart(2, '0')}-` +
    `${String(date.getUTCDate()).padStart(2, '0')}`
}

/**
 * Metadata written into the CSV manifest rows. The API route supplies these
 * from the same instant it uses for the database query, so the file and the
 * query cannot disagree.
 */
export interface ExportMetadata {
  /** Inclusive start date, YYYY-MM-DD (UTC). */
  startDate: string
  /** Inclusive end date, YYYY-MM-DD (UTC). */
  endDate: string
  /** ISO-8601 instant at which the export was generated. */
  generatedAt: string
  /** Record types included. Defaults to EXPORT_RECORD_TYPES. */
  recordTypes?: ReadonlyArray<ExportRecordType>
}

/**
 * Columns shared by every record type, in export order.
 */
export const SHARED_COLUMNS: ReadonlyArray<string> = [
  'record_type',
  'id',
  'title',
  'body',
  'author_id',
  'author_name',
  'created_at',
  'updated_at',
]

/**
 * Type-specific extra columns appended after the shared set. Rows of other
 * types emit empty strings for these.
 */
const EVENT_EXTRA = [
  'event_date',
  'event_time',
  'duration_minutes',
  'link',
  'host_id',
  'host_name',
  'type',
]

const POST_EXTRA = [
  'post_type',
  'image_url',
  'github_url',
  'demo_url',
  'tech_stack',
  'tags',
  'target_years',
]

const ANNOUNCEMENT_EXTRA = [
  'image_urls',
]

/**
 * Header row for the single consistent CSV structure. `record_type` is one of
 * `event`, `showcase`, `announcement`, or `export_metadata` (manifest row).
 */
export const CSV_HEADER: ReadonlyArray<string> = [
  ...SHARED_COLUMNS,
  ...EVENT_EXTRA,
  ...POST_EXTRA,
  ...ANNOUNCEMENT_EXTRA,
]

export type ActivityRow = {
  record_type: ExportRecordType
  id: string
  title: string
  body: string
  author_id: string
  author_name: string
  created_at: string
  /** Only announcements have an updated_at column in the live schema. */
  updated_at?: string | null
  event_date?: string | null
  event_time?: string | null
  duration_minutes?: number | null
  link?: string | null
  host_id?: string | null
  host_name?: string | null
  type?: string | null
  post_type?: string | null
  image_url?: string | null
  github_url?: string | null
  demo_url?: string | null
  tech_stack?: ReadonlyArray<string> | null
  tags?: ReadonlyArray<string> | null
  target_years?: ReadonlyArray<number> | null
  image_urls?: ReadonlyArray<string> | null
}

/**
 * Maps a normalized activity row to the fixed column order so every row in the
 * CSV has the same shape. Missing type-specific columns become empty strings.
 */
export function rowToCells(row: ActivityRow): ReadonlyArray<unknown> {
  const base = [
    row.record_type,
    row.id,
    row.title,
    row.body,
    row.author_id,
    row.author_name,
    row.created_at,
    row.updated_at ?? '',
  ]

  // event:      event_date, event_time, duration_minutes, link, host_id, host_name, type
  // post:       post_type, image_url, github_url, demo_url, tech_stack, tags, target_years
  // announcement: image_urls
  const empty7 = ['', '', '', '', '', '', '']
  const empty1 = ['']

  const eventExtras =
    row.record_type === 'event'
      ? [
          row.event_date ?? '',
          row.event_time ?? '',
          row.duration_minutes ?? '',
          row.link ?? '',
          row.host_id ?? '',
          row.host_name ?? '',
          row.type ?? '',
        ]
      : empty7
  const postExtras =
    row.record_type === 'showcase'
      ? [
          row.post_type ?? '',
          row.image_url ?? '',
          row.github_url ?? '',
          row.demo_url ?? '',
          Array.isArray(row.tech_stack) ? row.tech_stack.join(';') : '',
          Array.isArray(row.tags) ? row.tags.join(';') : '',
          Array.isArray(row.target_years) ? row.target_years.join(';') : '',
        ]
      : empty7
  const announcementExtras =
    row.record_type === 'announcement'
      ? [Array.isArray(row.image_urls) ? row.image_urls.join(';') : '']
      : empty1

  return [...base, ...eventExtras, ...postExtras, ...announcementExtras]
}

/**
 * Builds one manifest row with exactly the same number of cells as the header.
 * The key lives in `id` and the value in `title`; every other column is empty.
 */
function manifestCells(key: string, value: string): ReadonlyArray<unknown> {
  const cells: unknown[] = new Array(CSV_HEADER.length).fill('')
  cells[0] = EXPORT_MANIFEST_RECORD_TYPE
  cells[1] = key
  cells[2] = value
  return cells
}

/**
 * Manifest rows documented in the file itself. They are ordinary rows with a
 * sentinel `record_type`, so the CSV stays rectangular.
 */
export function manifestRows(
  metadata: ExportMetadata,
): ReadonlyArray<ReadonlyArray<unknown>> {
  const recordTypes = metadata.recordTypes ?? EXPORT_RECORD_TYPES
  return [
    manifestCells('start_date', metadata.startDate),
    manifestCells('end_date', metadata.endDate),
    manifestCells('window_boundary', 'inclusive (UTC)'),
    manifestCells('lookback', '6 calendar months'),
    manifestCells('exported_at', metadata.generatedAt),
    manifestCells('included_record_types', recordTypes.join(';')),
  ]
}

/**
 * Renders the full CSV document as a string: header row, manifest rows (when
 * metadata is supplied), then data rows. Empty results still emit the header
 * and manifest so the file is always well-formed and self-describing.
 */
export function buildCommunityActivityCsv(
  rows: ReadonlyArray<ActivityRow>,
  metadata?: ExportMetadata,
): string {
  const lines: string[] = [rowToCsv(CSV_HEADER)]

  if (metadata) {
    for (const cells of manifestRows(metadata)) {
      lines.push(rowToCsv(cells))
    }
  }

  for (const row of rows) {
    lines.push(rowToCsv(rowToCells(row)))
  }
  return lines.join('')
}

/**
 * Byte length of the CSV content, useful for setting Content-Length.
 */
export function csvByteLength(csv: string): number {
  return new TextEncoder().encode(csv).length
}
