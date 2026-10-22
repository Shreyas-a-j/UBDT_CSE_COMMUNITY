/**
 * Supabase row mapping + presentation helpers for the community surfaces.
 *
 * The web app remains the source of truth for the schema (see
 * `lib/types.ts` and `contexts/CommunityContext.tsx`). These helpers are
 * intentionally defensive: a partially provisioned profile or an older row
 * must never crash a list.
 */

import type { Event, EventType, Post, PostType, Profile, UserRole } from './types';

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
  host:profiles!host_id (id, name, usn, avatar_url, role),
  event_rsvps (count)
`;

export const COMMENT_SELECT = `
  id, post_id, author_id, body, parent_id, created_at,
  author:profiles!author_id (id, name, usn, avatar_url)
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
    rsvp_count: countFromEmbed(row.event_rsvps) || Number(row.rsvp_count) || 0,
  };
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
