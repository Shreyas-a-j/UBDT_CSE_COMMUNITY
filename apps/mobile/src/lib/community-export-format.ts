/**
 * Pure helpers for the community activity CSV download.
 *
 * Kept separate from the Expo file-system layer so filename handling can be
 * unit-tested in Node. The filename comes from the server response, but it is
 * still untrusted input: it is reduced to a single safe cache-file name and
 * must end in `.csv`.
 */

const DEFAULT_CSV_FILENAME = 'ucc-community-activity.csv';

/** Extract the quoted or token filename from a Content-Disposition header. */
export function filenameFromContentDisposition(header: string | null | undefined): string | null {
  if (typeof header !== 'string' || !header.trim()) return null;

  // RFC 5987 form: filename*=UTF-8''name.csv
  const extended = header.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  if (extended?.[1]) {
    try {
      return decodeURIComponent(extended[1].trim());
    } catch {
      return extended[1].trim();
    }
  }

  const quoted = header.match(/filename\s*=\s*"([^"]+)"/i);
  if (quoted?.[1]) return quoted[1].trim();

  const token = header.match(/filename\s*=\s*([^;\s]+)/i);
  return token?.[1]?.trim() ?? null;
}

/**
 * Reduce a server-provided name to a safe single path segment ending in
 * `.csv`. Path separators, control characters and cache-hostile characters
 * are replaced.
 */
export function safeCsvFilename(candidate: string | null | undefined): string {
  const base = (candidate ?? '')
    .split(/[\\/]/)
    .pop()
    ?.replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);

  if (!base) return DEFAULT_CSV_FILENAME;
  return base.toLowerCase().endsWith('.csv') ? base : `${base}.csv`;
}

/** Keep only usable HTTP headers, normalised to lower-case keys. */
export function normalizedHeaders(headers: Record<string, string> | null | undefined): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (typeof value === 'string') normalized[key.toLowerCase()] = value;
  }
  return normalized;
}

function isoDate(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}

/**
 * Display-only mirror of the server's rolling six-calendar-month window.
 * Month-end dates are clamped (for example Aug 31 → Feb 28/29) so the label
 * never names a day that does not exist.
 */
export function sixMonthWindow(now: Date = new Date()): { startDate: string; endDate: string } {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const day = now.getUTCDate();

  const startMonthIndex = month - 6;
  const startYear = year + Math.floor(startMonthIndex / 12);
  const normalizedStartMonth = ((startMonthIndex % 12) + 12) % 12;
  const lastDayOfStartMonth = new Date(Date.UTC(startYear, normalizedStartMonth + 1, 0)).getUTCDate();

  return {
    startDate: isoDate(startYear, normalizedStartMonth, Math.min(day, lastDayOfStartMonth)),
    endDate: isoDate(year, month, day),
  };
}

export function sixMonthWindowLabel(now: Date = new Date()): string {
  const window = sixMonthWindow(now);
  return `${window.startDate} to ${window.endDate}`;
}
