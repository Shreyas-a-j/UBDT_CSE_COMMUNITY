/**
 * Supabase row mapping + presentation helpers for the community surfaces.
 *
 * The web app remains the source of truth for the schema (see
 * `lib/types.ts` and `contexts/CommunityContext.tsx`). These helpers are
 * intentionally defensive: a partially provisioned profile or an older row
 * must never crash a list.
 */

import type {
  Announcement,
  AnnouncementReaction,
  AnnouncementReactionRow,
  DiscussionPin,
  Event,
  EventType,
  Post,
  PostType,
  Profile,
  UserRole,
} from './types';

type Row = Record<string, unknown>;

export const POST_SELECT = `
  id, author_id, type, title, body, image_url, github_url, demo_url,
  tech_stack, tags, target_years, created_at,
  author:profiles!author_id (id, name, usn, avatar_url, year, role),
  likes (count),
  comments (count),
  upvotes (count)
`;

export const EVENT_SELECT = `
  id, host_id, title, description, type, event_date, event_time, duration,
  link, target_years, created_at,
  host:profiles!host_id (id, name, usn, avatar_url, year, role),
  event_rsvps (count)
`;

export const COMMENT_SELECT = `
  id, post_id, author_id, body, parent_id, created_at,
  author:profiles!author_id (id, name, usn, avatar_url)
`;

export const ANNOUNCEMENT_SELECT = `
  *,
  author:profiles!author_id (id, name, avatar_url, designation),
  reactions:announcement_reactions (user_id, reaction, created_at)
`;

export const PIN_SELECT = `
  id, post_id, pinned_by, pinned_at, pin_expires_at, unpinned_at, unpinned_by
`;

const EVENT_TYPES: EventType[] = ['Workshop', 'Meeting', 'Showcase', 'Seminar', 'Project Session'];

export function countFromEmbed(value: unknown): number {
  if (Array.isArray(value) && value[0] && typeof value[0] === 'object' && 'count' in value[0]) {
    return Number((value[0] as { count: number }).count) || 0;
  }
  return 0;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNullableString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function asNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [1, 2, 3, 4];
  const numbers = value.map(Number).filter((item) => Number.isFinite(item));
  return numbers.length ? numbers : [1, 2, 3, 4];
}

function asRole(value: unknown): UserRole {
  return value === 'faculty' || value === 'admin' ? value : 'student';
}

function embeddedProfile(value: unknown): Profile | null {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== 'object') return null;
  const source = row as Row;
  return {
    id: asString(source.id),
    usn: asNullableString(source.usn),
    name: asString(source.name, 'CSE member'),
    year: typeof source.year === 'number' ? source.year : null,
    branch: asString(source.branch, 'CSE'),
    section: null,
    bio: null,
    avatar_url: asNullableString(source.avatar_url),
    skills: [],
    interests: [],
    role: asRole(source.role),
    faculty_status: 'none',
    designation: null,
    employee_id: null,
    expertise: [],
    member_type: asRole(source.role) === 'student' ? 'student' : 'faculty',
    graduation_year: null,
    portfolio_url: null,
    github_url: null,
    linkedin_url: null,
    created_at: '',
  };
}

export function mapPost(row: Row): Post {
  const author = embeddedProfile(row.author ?? row.profiles);
  const type: PostType = row.type === 'showcase' ? 'showcase' : 'discussion';
  return {
    id: String(row.id),
    author_id: String(row.author_id),
    type,
    title: asString(row.title, 'Untitled post'),
    body: asString(row.body),
    image_url: asNullableString(row.image_url),
    github_url: asNullableString(row.github_url),
    demo_url: asNullableString(row.demo_url),
    tech_stack: asStringArray(row.tech_stack),
    tags: asStringArray(row.tags),
    target_years: asNumberArray(row.target_years),
    created_at: asString(row.created_at, new Date().toISOString()),
    author_name: author?.name ?? 'CSE member',
    author_usn: author?.usn ?? '',
    author_avatar: author?.avatar_url ?? null,
    author_year: author?.year ?? null,
    author_role: author?.role ?? 'student',
    like_count: countFromEmbed(row.likes) || Number(row.like_count) || 0,
    upvote_count: countFromEmbed(row.upvotes) || Number(row.upvote_count) || 0,
    comment_count: countFromEmbed(row.comments) || Number(row.comment_count) || 0,
  };
}

export function mapEvent(row: Row): Event {
  const host = embeddedProfile(row.host ?? row.profiles);
  const type = EVENT_TYPES.includes(row.type as EventType) ? (row.type as EventType) : 'Workshop';
  return {
    id: String(row.id),
    host_id: String(row.host_id),
    title: asString(row.title, 'Untitled event'),
    description: asString(row.description),
    type,
    event_date: asString(row.event_date),
    event_time: asString(row.event_time),
    duration: Number(row.duration) || 60,
    link: asNullableString(row.link),
    target_years: asNumberArray(row.target_years),
    created_at: asString(row.created_at, new Date().toISOString()),
    host_name: host?.name ?? 'CSE host',
    host_usn: host?.usn ?? '',
    host_avatar: host?.avatar_url ?? null,
    host_role: host?.role ?? 'student',
    host_year: host?.year ?? null,
    rsvp_count: countFromEmbed(row.event_rsvps) || Number(row.rsvp_count) || 0,
  };
}

/* ----------------------------- announcements ----------------------------- */

export const ANNOUNCEMENT_REACTIONS: readonly {
  type: AnnouncementReaction;
  emoji: string;
  label: string;
}[] = [
  { type: 'thumbs_up', emoji: '👍', label: 'Thumbs up' },
  { type: 'heart', emoji: '❤️', label: 'Love' },
  { type: 'party', emoji: '🎉', label: 'Celebrate' },
  { type: 'clap', emoji: '👏', label: 'Applause' },
];

export function isAnnouncementReaction(value: unknown): value is AnnouncementReaction {
  return ANNOUNCEMENT_REACTIONS.some((reaction) => reaction.type === value);
}

/**
 * A member has at most one reaction per announcement. Legacy rows may contain
 * more than one, so keep the latest row per user before counting.
 */
export function normalizeReactionRows(value: unknown): AnnouncementReactionRow[] {
  if (!Array.isArray(value)) return [];
  const byUser = new Map<string, AnnouncementReactionRow>();
  const order: string[] = [];

  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Row;
    const userId = typeof row.user_id === 'string' ? row.user_id : '';
    if (!userId || !isAnnouncementReaction(row.reaction)) continue;
    const candidate: AnnouncementReactionRow = {
      user_id: userId,
      reaction: row.reaction,
      created_at: typeof row.created_at === 'string' ? row.created_at : undefined,
    };
    const current = byUser.get(userId);
    if (!current) {
      byUser.set(userId, candidate);
      order.push(userId);
      continue;
    }
    const candidateTime = Date.parse(candidate.created_at ?? '');
    const currentTime = Date.parse(current.created_at ?? '');
    if (Number.isFinite(candidateTime) && Number.isFinite(currentTime) && candidateTime < currentTime) {
      continue;
    }
    byUser.set(userId, candidate);
  }

  return order.map((userId) => byUser.get(userId)!);
}

export function summarizeReactions(
  rows: readonly {
    user_id?: string | null;
    reaction?: string | null;
    created_at?: string | null;
  }[] | null | undefined,
  viewerId?: string | null
): { counts: Record<AnnouncementReaction, number>; mine: AnnouncementReaction[] } {
  const counts: Record<AnnouncementReaction, number> = {
    thumbs_up: 0,
    heart: 0,
    party: 0,
    clap: 0,
  };
  const mine: AnnouncementReaction[] = [];

  for (const row of normalizeReactionRows(rows)) {
    counts[row.reaction] += 1;
    if (viewerId && row.user_id === viewerId) mine.push(row.reaction);
  }

  return { counts, mine };
}

export function mapAnnouncement(row: Row): Announcement {
  const author = embeddedProfile(row.author ?? row.profiles);
  const images = Array.isArray(row.image_urls)
    ? row.image_urls.filter(
        (item): item is string => typeof item === 'string' && /^https?:\/\//i.test(item.trim())
      )
    : [];

  return {
    id: String(row.id),
    author_id: String(row.author_id ?? ''),
    title: asString(row.title, 'Untitled announcement'),
    body: asString(row.body),
    image_urls: images.slice(0, 4),
    created_at: asString(row.created_at, new Date().toISOString()),
    updated_at: asString(row.updated_at ?? row.created_at, new Date().toISOString()),
    author_name: author?.name,
    author_avatar: author?.avatar_url ?? null,
    author_designation: author?.designation ?? null,
    reactions: normalizeReactionRows(row.reactions),
  };
}

/* ------------------------------- pins ----------------------------------- */

export function mapDiscussionPin(row: Row): DiscussionPin | null {
  const id = asNullableString(row.id);
  const postId = asNullableString(row.post_id);
  const pinnedBy = asNullableString(row.pinned_by);
  const pinnedAt = asNullableString(row.pinned_at);
  const expiresAt = asNullableString(row.pin_expires_at);
  if (!id || !postId || !pinnedBy || !pinnedAt || !expiresAt) return null;
  return {
    id,
    post_id: postId,
    pinned_by: pinnedBy,
    pinned_at: pinnedAt,
    pin_expires_at: expiresAt,
    unpinned_at: asNullableString(row.unpinned_at),
    unpinned_by: asNullableString(row.unpinned_by),
  };
}

export function isPinActive(
  pin: Pick<DiscussionPin, 'unpinned_at' | 'pin_expires_at'>,
  now: number = Date.now()
): boolean {
  if (pin.unpinned_at) return false;
  const expires = Date.parse(pin.pin_expires_at);
  return Number.isFinite(expires) && expires > now;
}

/** Active pins only, newest first, capped at the community limit. */
export function selectActivePins(
  pins: DiscussionPin[],
  now: number = Date.now(),
  limit = 3
): DiscussionPin[] {
  return pins
    .filter((pin) => isPinActive(pin, now))
    .sort((a, b) => Date.parse(b.pinned_at) - Date.parse(a.pinned_at))
    .slice(0, limit);
}

/* -------------------------------- dates ---------------------------------- */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function formatRelativeTime(iso: string): string {
  const timestamp = new Date(iso).getTime();
  if (!Number.isFinite(timestamp)) return '';
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 45) return 'just now';
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h`;
  if (seconds < 604_800) return `${Math.round(seconds / 86_400)}d`;

  const date = new Date(timestamp);
  const now = new Date();
  const sameYear = date.getFullYear() === now.getFullYear();
  return `${MONTHS[date.getMonth()]} ${date.getDate()}${sameYear ? '' : `, ${date.getFullYear()}`}`;
}

/** Parses the database's `date` + `time` (both local wall-clock) safely. */
export function eventStart(event: Pick<Event, 'event_date' | 'event_time'>): Date | null {
  if (!event.event_date) return null;
  const time = event.event_time || '00:00:00';
  const parsed = new Date(`${event.event_date}T${time}`);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

export function eventEnd(event: Pick<Event, 'event_date' | 'event_time' | 'duration'>): Date | null {
  const start = eventStart(event);
  if (!start) return null;
  return new Date(start.getTime() + Math.max(1, event.duration) * 60_000);
}

/** Mirrors the web's shared upcoming rule: end instant must still be ahead. */
export function isEventUpcoming(
  event: Pick<Event, 'event_date' | 'event_time' | 'duration'>,
  now: Date = new Date()
): boolean {
  const end = eventEnd(event);
  return end ? end.getTime() > now.getTime() : false;
}

export function formatEventDate(event: Pick<Event, 'event_date'>): string {
  const start = eventStart({ event_date: event.event_date, event_time: '00:00:00' });
  if (!start) return event.event_date || 'Date TBA';
  return `${WEEKDAYS[start.getDay()]}, ${MONTHS[start.getMonth()]} ${start.getDate()}`;
}

export function formatEventTime(time: string): string {
  const match = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!match) return time || 'Time TBA';
  const hours = Number(match[1]);
  const minutes = match[2];
  const suffix = hours >= 12 ? 'PM' : 'AM';
  const twelve = hours % 12 || 12;
  return `${twelve}:${minutes} ${suffix}`;
}

export function eventDateParts(event: Pick<Event, 'event_date'>): { day: string; month: string } {
  const start = eventStart({ event_date: event.event_date, event_time: '00:00:00' });
  if (!start) return { day: '--', month: '---' };
  return { day: String(start.getDate()), month: MONTHS[start.getMonth()] };
}

export function getYearLabel(year: number | null | undefined): string {
  if (!year) return 'CSE';
  return `${year}${year === 1 ? 'st' : year === 2 ? 'nd' : year === 3 ? 'rd' : 'th'} year`;
}

export function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'U';
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return `${parts[0].charAt(0)}${parts[parts.length - 1].charAt(0)}`.toUpperCase();
}

export function sanitizeText(value: string, max = 8000): string {
  return value.replace(/\u0000/g, '').trim().slice(0, max);
}

export function parseTags(value: string, max = 6): string[] {
  const seen = new Set<string>();
  return value
    .split(',')
    .map((item) => item.trim().replace(/^#/, ''))
    .filter((item) => {
      if (!item) return false;
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, max)
    .map((item) => item.slice(0, 30));
}
