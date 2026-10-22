/**
 * Announcement presentation and permission rules — UCC 2.0 Phase 6
 *
 * Pure, framework-free helpers shared by the feed, the dedicated announcements
 * area, the faculty composer and the server routes. Keeping the permission
 * check, the image validation and the reaction summary here means the client
 * and the server apply exactly the same rules.
 */
import { format, isToday, isYesterday, parseISO } from 'date-fns'
import { isApprovedFaculty } from '@/lib/profile'
import type {
  Announcement,
  AnnouncementReaction,
  AnnouncementReactionRow,
} from '@/lib/types'

export const ANNOUNCEMENT_REACTIONS: ReadonlyArray<{
  type: AnnouncementReaction
  emoji: string
  label: string
}> = [
  { type: 'thumbs_up', emoji: '👍', label: 'Thumbs up' },
  { type: 'heart', emoji: '❤️', label: 'Love' },
  { type: 'party', emoji: '🎉', label: 'Celebrate' },
  { type: 'clap', emoji: '👏', label: 'Applause' },
]

export const ANNOUNCEMENT_REACTION_TYPES: ReadonlyArray<AnnouncementReaction> =
  ANNOUNCEMENT_REACTIONS.map(reaction => reaction.type)

/** Mirrors the CHECK constraint on public.announcement_reactions.reaction. */
export function isAnnouncementReaction(value: unknown): value is AnnouncementReaction {
  return typeof value === 'string' && (ANNOUNCEMENT_REACTION_TYPES as readonly string[]).includes(value)
}

export interface ReactionSummary {
  counts: Record<AnnouncementReaction, number>
  /** The viewer's reaction, or empty when signed out / not reacted. */
  mine: AnnouncementReaction[]
}

export function emptyReactionCounts(): Record<AnnouncementReaction, number> {
  return { thumbs_up: 0, heart: 0, party: 0, clap: 0 }
}

/**
 * Counts reactions per type and reports the viewer's selection.
 *
 * A member has at most one reaction per announcement. Legacy data may still
 * contain more than one row for a user (the original composite primary key
 * allowed it), so rows are normalized first: the latest row per user wins.
 */
export function summarizeReactions(
  rows: ReadonlyArray<{ user_id?: string | null; reaction?: string | null; created_at?: string | null }> | null | undefined,
  viewerId?: string | null
): ReactionSummary {
  const counts = emptyReactionCounts()
  const mine: AnnouncementReaction[] = []

  // A reaction must belong to a member. Malformed rows without a user id are
  // still counted once per type (they cannot be attributed to the viewer), so
  // existing defensive behavior is preserved; they are dropped elsewhere.
  const orphans = new Set<AnnouncementReaction>()
  for (const row of Array.isArray(rows) ? rows : []) {
    const reaction = row.reaction
    if (!isAnnouncementReaction(reaction)) continue
    if (typeof row.user_id === 'string' && row.user_id) continue
    if (orphans.has(reaction)) continue
    orphans.add(reaction)
    counts[reaction] += 1
  }

  for (const row of normalizeReactionRows(rows)) {
    counts[row.reaction] += 1
    if (viewerId && row.user_id === viewerId) mine.push(row.reaction)
  }

  return { counts, mine }
}

export function totalReactions(counts: Record<AnnouncementReaction, number>): number {
  return ANNOUNCEMENT_REACTION_TYPES.reduce((total, type) => total + counts[type], 0)
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

export const ANNOUNCEMENT_MAX_IMAGES = 4
export const ANNOUNCEMENT_IMAGE_MAX_BYTES = 5 * 1024 * 1024
export const ANNOUNCEMENT_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
] as const

/** Human-readable reason a file cannot be attached, or null when it can. */
export function validateAnnouncementImage(file: { type?: string; size?: number }): string | null {
  const type = (file.type ?? '').toLowerCase()
  if (!(ANNOUNCEMENT_IMAGE_TYPES as readonly string[]).includes(type)) {
    return 'Only PNG, JPEG, WebP and GIF images can be attached.'
  }
  const size = typeof file.size === 'number' ? file.size : 0
  if (size <= 0) return 'That image looks empty. Pick a different file.'
  if (size > ANNOUNCEMENT_IMAGE_MAX_BYTES) {
    return `Images must be 5 MB or smaller (this one is ${(size / (1024 * 1024)).toFixed(1)} MB).`
  }
  return null
}

/** Keeps only well-formed public URLs, at most ANNOUNCEMENT_MAX_IMAGES. */
export function normalizeImageUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  const urls = value.filter(
    (item): item is string => typeof item === 'string' && /^https?:\/\/\S+$/i.test(item.trim())
  )
  return urls.slice(0, ANNOUNCEMENT_MAX_IMAGES).map(url => url.trim())
}

function reactionTimestamp(value: string | null | undefined): number | null {
  if (typeof value !== 'string' || !value) return null
  const time = Date.parse(value)
  return Number.isNaN(time) ? null : time
}

/**
 * Keeps one reaction per member, choosing the latest row when legacy data
 * contains more (the original composite primary key allowed several types per
 * user). Unknown/invalid rows are dropped. Exported so the rule can be tested
 * directly; `mapAnnouncement` and `summarizeReactions` both use it.
 */
export function normalizeReactionRows(value: unknown): AnnouncementReactionRow[] {
  if (!Array.isArray(value)) return []

  const byUser = new Map<string, AnnouncementReactionRow>()
  const order: string[] = []

  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const userId = typeof row.user_id === 'string' ? row.user_id : ''
    if (!userId || !isAnnouncementReaction(row.reaction)) continue

    const candidate: AnnouncementReactionRow = {
      user_id: userId,
      reaction: row.reaction,
    }
    if (typeof row.created_at === 'string') candidate.created_at = row.created_at
    const current = byUser.get(userId)

    if (!current) {
      byUser.set(userId, candidate)
      order.push(userId)
      continue
    }

    const candidateTime = reactionTimestamp(candidate.created_at)
    const currentTime = reactionTimestamp(current.created_at)
    // Keep the newer row. If timestamps are missing, the later array entry
    // wins (PostgREST returns the join in insertion order for this table).
    if (candidateTime !== null && currentTime !== null && candidateTime < currentTime) continue
    if (candidateTime === null && currentTime !== null) continue
    byUser.set(userId, candidate)
  }

  return order.map(userId => byUser.get(userId)!)
}

/** Maps a PostgREST row (with `author` and `reactions` embeds) to Announcement. */
export function mapAnnouncement(row: Record<string, unknown>): Announcement {
  const author = (row.author ?? row.profiles) as {
    name?: string | null
    avatar_url?: string | null
    designation?: string | null
  } | null

  return {
    id: String(row.id),
    author_id: String(row.author_id ?? ''),
    title: String(row.title ?? ''),
    body: String(row.body ?? ''),
    image_urls: normalizeImageUrls(row.image_urls),
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? row.created_at ?? ''),
    author_name: author?.name ?? undefined,
    author_avatar: author?.avatar_url ?? null,
    author_designation: author?.designation ?? null,
    reactions: normalizeReactionRows(row.reactions),
  }
}

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

/**
 * Trusted role check. Callers must pass a profile read from the database —
 * `profiles.role`/`faculty_status` are protected by the
 * protect_profile_privileges() trigger, so a client cannot self-escalate.
 * Students, alumni and unverified (pending/rejected) applicants fail.
 */
export function canPublishAnnouncements(
  profile: { role?: unknown; faculty_status?: unknown } | null | undefined
): boolean {
  // One rule with the UI gate, the API route, the directory and middleware.
  return isApprovedFaculty(profile)
}

// ---------------------------------------------------------------------------
// Display grouping
// ---------------------------------------------------------------------------

export interface AnnouncementDayGroup {
  key: string
  label: string
  announcements: Announcement[]
}

/**
 * Groups announcements into Discord-style day sections ("Today", "Yesterday",
 * "Monday, Oct 20"). Order is preserved, so the caller's newest-first list
 * stays newest-first inside each group.
 */
export function groupAnnouncementsByDay(
  announcements: Announcement[],
  now: Date = new Date()
): AnnouncementDayGroup[] {
  const groups = new Map<string, AnnouncementDayGroup>()

  for (const announcement of announcements) {
    const parsed = parseISO(announcement.created_at)
    const valid = !Number.isNaN(parsed.getTime())
    const key = valid ? format(parsed, 'yyyy-MM-dd') : 'unknown'
    const label = valid ? dayLabel(parsed, now) : 'Earlier'

    const existing = groups.get(key)
    if (existing) {
      existing.announcements.push(announcement)
    } else {
      groups.set(key, { key, label, announcements: [announcement] })
    }
  }

  return Array.from(groups.values())
}

function dayLabel(date: Date, now: Date): string {
  if (isToday(date)) return 'Today'
  if (isYesterday(date)) return 'Yesterday'
  return date.getFullYear() === now.getFullYear()
    ? format(date, 'EEEE, MMM d')
    : format(date, 'MMM d, yyyy')
}
