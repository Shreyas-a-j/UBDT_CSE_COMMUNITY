/**
 * Discussion pin rules — UCC 2.0 verified faculty pinning.
 *
 * The database is authoritative (public.discussion_pins + the
 * pin_discussion/unpin_discussion RPCs). These pure helpers keep the feed,
 * the cards and the tests using one definition of "active" and one mapping
 * from database errors to useful messages.
 */
import type { DiscussionPin, Post } from '@/lib/types'

/** The community-wide cap enforced transactionally in pin_discussion(). */
export const MAX_ACTIVE_DISCUSSION_PINS = 3

/** Every successful pin lasts this long. */
export const PIN_DURATION_DAYS = 7

export const PIN_LIMIT_MESSAGE =
  'The community already has 3 active pinned discussions. Wait for a pin to expire or unpin one first.'

export const PIN_PERMISSION_MESSAGE =
  'Only admins and verified faculty can pin or unpin discussions.'

/** Shown to authorized users when every community-wide pin slot is occupied. */
export const PIN_SLOTS_FULL_MESSAGE =
  'All 3 pin slots are in use. Unpin a discussion or wait for one to expire.'

/**
 * A pin is active only while it has not been explicitly unpinned and its
 * expiry instant is still ahead. This mirrors the RLS predicate
 * `unpinned_at is null and pin_expires_at > now()`.
 */
export function isPinActive(
  pin: Pick<DiscussionPin, 'unpinned_at' | 'pin_expires_at'>,
  now: Date | number = Date.now()
): boolean {
  if (pin.unpinned_at) return false
  const expiresAt = Date.parse(pin.pin_expires_at)
  if (!Number.isFinite(expiresAt)) return false
  const nowMs = typeof now === 'number' ? now : now.getTime()
  return expiresAt > nowMs
}

/**
 * Formats the remaining pin lifetime for display. The server clock is the
 * authority for expiry; this only renders the difference the browser sees.
 */
export function formatPinCountdown(
  expiresAt: string,
  now: Date = new Date()
): string {
  const expires = Date.parse(expiresAt)
  const nowMs = now.getTime()
  if (!Number.isFinite(expires) || expires <= nowMs) return 'Expired'

  const totalSeconds = Math.floor((expires - nowMs) / 1000)
  const days = Math.floor(totalSeconds / 86_400)
  const hours = Math.floor((totalSeconds % 86_400) / 3_600)
  const minutes = Math.floor((totalSeconds % 3_600) / 60)
  const seconds = totalSeconds % 60

  if (days > 0) return `Expires in ${days}d ${hours}h`
  if (hours > 0) return `Expires in ${hours}h ${minutes}m`
  if (minutes > 0) return `Expires in ${minutes}m ${seconds}s`
  return `Expires in ${seconds}s`
}

/** Normalizes a PostgREST row without trusting column types. */
export function mapDiscussionPin(row: Record<string, unknown>): DiscussionPin | null {
  const id = typeof row.id === 'string' ? row.id : null
  // `post_id` is the canonical column; `discussion_id` is accepted only as a
  // legacy fallback so an old row shape cannot blank the pin list.
  const discussionId =
    typeof row.post_id === 'string'
      ? row.post_id
      : typeof row.discussion_id === 'string'
        ? row.discussion_id
        : null
  const pinnedBy = typeof row.pinned_by === 'string' ? row.pinned_by : null
  const pinnedAt = typeof row.pinned_at === 'string' ? row.pinned_at : null
  const pinExpiresAt = typeof row.pin_expires_at === 'string' ? row.pin_expires_at : null

  if (!id || !discussionId || !pinnedBy || !pinnedAt || !pinExpiresAt) return null

  return {
    id,
    discussion_id: discussionId,
    pinned_by: pinnedBy,
    pinned_at: pinnedAt,
    pin_expires_at: pinExpiresAt,
    unpinned_at: typeof row.unpinned_at === 'string' ? row.unpinned_at : null,
    unpinned_by: typeof row.unpinned_by === 'string' ? row.unpinned_by : null,
  }
}

/** Newest pin first, capped at the community limit. */
export function selectActivePins(
  pins: DiscussionPin[],
  now: Date | number = Date.now(),
  limit: number = MAX_ACTIVE_DISCUSSION_PINS
): DiscussionPin[] {
  return pins
    .filter(pin => isPinActive(pin, now))
    .sort((a, b) => {
      const timeA = Date.parse(a.pinned_at)
      const timeB = Date.parse(b.pinned_at)
      const safeA = Number.isFinite(timeA) ? timeA : 0
      const safeB = Number.isFinite(timeB) ? timeB : 0
      if (safeA !== safeB) return safeB - safeA
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })
    .slice(0, Math.max(0, limit))
}

/**
 * Adds active pin fields to the regular feed posts without changing their
 * order (the feed query keeps owning ordering and pagination). Posts with
 * no active pin get explicit nulls so a stale card cannot keep an old badge.
 */
export function applyActivePinsToPosts(
  posts: Post[],
  pins: DiscussionPin[],
  now: Date | number = Date.now()
): Post[] {
  const activeByDiscussion = new Map(
    selectActivePins(pins, now, Number.MAX_SAFE_INTEGER).map(pin => [pin.discussion_id, pin])
  )

  return posts.map(post => {
    const pin = activeByDiscussion.get(post.id)
    return {
      ...post,
      pinned_by: pin?.pinned_by ?? null,
      pinned_at: pin?.pinned_at ?? null,
      pin_expires_at: pin?.pin_expires_at ?? null,
    }
  })
}

/**
 * Maps a database/RPC error to the message a member should see. The
 * database's own messages are already specific; this keeps them stable if
 * PostgREST wraps them and gives network failures a useful fallback.
 */
export function pinErrorMessage(message: string | null | undefined): string {
  const raw = (message ?? '').trim()
  const lower = raw.toLowerCase()

  if (lower.includes('community already has 3 active pinned discussions')) {
    return PIN_LIMIT_MESSAGE
  }
  if (lower.includes('only admins and verified faculty') || lower.includes('only verified faculty')) {
    return PIN_PERMISSION_MESSAGE
  }
  if (lower.includes('already pinned')) {
    return 'This discussion is already pinned.'
  }
  if (lower.includes('already expired')) {
    return 'This pin has already expired.'
  }
  if (lower.includes('not pinned')) {
    return 'This discussion is no longer pinned.'
  }
  if (lower.includes('only discussions')) {
    return 'Only discussions can be pinned.'
  }
  if (lower.includes('discussion not found')) {
    return 'This discussion no longer exists.'
  }
  if (lower.includes('a discussion id is required')) {
    return 'Choose a discussion to pin.'
  }

  return raw || 'Could not update the pin. Please try again.'
}
