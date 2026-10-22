/**
 * Pure helpers for the email-verification surface.
 *
 * The source of truth is Supabase Auth (`auth.users.email_confirmed_at`),
 * read through the `get_email_verification_status` RPC. Nothing here accepts a
 * client-supplied boolean or an editable profile field: callers pass the RPC
 * rows through `normalizeEmailVerificationRows` and render the resulting
 * boolean. A missing id means "not authorised or not loaded", never "verified".
 */

export type EmailVerificationState = 'verified' | 'unverified' | 'unknown'

/**
 * De-duplicates and sorts ids for a stable lookup key. Sorting means two
 * callers with the same members but a different order produce one request.
 */
export function uniqueVerificationIds(userIds: readonly string[]): string[] {
  return Array.from(
    new Set(
      userIds
        .filter((id): id is string => typeof id === 'string')
        .map(id => id.trim())
        .filter(Boolean),
    ),
  ).sort()
}

export interface EmailVerificationRow {
  user_id: string
  email_verified: boolean
}

/**
 * Validates RPC rows and indexes them by user id.
 *
 * Malformed rows are dropped rather than coerced, so a schema mismatch can
 * never produce a false "verified" badge. Duplicate rows keep the last value;
 * the RPC promises one row per id.
 */
export function normalizeEmailVerificationRows(
  rows: unknown,
): Record<string, boolean> {
  if (!Array.isArray(rows)) return {}

  const status: Record<string, boolean> = {}
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const candidate = row as Record<string, unknown>
    const userId = typeof candidate.user_id === 'string' ? candidate.user_id.trim() : ''
    if (!userId) continue
    if (typeof candidate.email_verified !== 'boolean') continue
    status[userId] = candidate.email_verified
  }
  return status
}

/**
 * Three-state classification for rendering. `undefined`/`null` is unknown
 * (not loaded, or the caller may not see this member's status) and must not be
 * rendered as either verified or unverified.
 */
export function emailVerificationState(
  verified: boolean | null | undefined,
): EmailVerificationState {
  if (verified === true) return 'verified'
  if (verified === false) return 'unverified'
  return 'unknown'
}

export function emailVerificationLabel(verified: boolean | null | undefined): string | null {
  const state = emailVerificationState(verified)
  if (state === 'verified') return 'Email verified'
  if (state === 'unverified') return 'Email not verified'
  return null
}
