/**
 * Feed selection, batch attribution, ranking and announcement presentation —
 * ports of the website's `lib/logic/{feed,batch,ranking,events,announcements}.ts`
 * so the mobile app applies exactly the same rules as the web.
 *
 * Everything here is pure and framework-free; the screens only render the
 * result. The website queries a 40-row posts window, so the caller passes that
 * window in and these helpers select what is visible.
 */

import type {
  Announcement,
  AnnouncementReaction,
  Event,
  FeedFilter,
  Post,
  DiscussionPin,
} from './types';

/* ------------------------------- batches --------------------------------- */

export const ALL_BATCHES = 0;
export const BATCH_YEARS = [1, 2, 3, 4] as const;
export type BatchYear = (typeof BATCH_YEARS)[number];
export type BatchFilter = 0 | BatchYear;

export interface BatchAttribution {
  authorBatch: number | null;
  targetYears: number[] | null | undefined;
}

function isBatchYear(value: unknown): value is BatchYear {
  return typeof value === 'number' && (BATCH_YEARS as readonly number[]).includes(value);
}

export function normalizeBatch(value: unknown): BatchFilter {
  const numeric =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim().length > 0
        ? Number(value)
        : Number.NaN;
  return isBatchYear(numeric) ? numeric : ALL_BATCHES;
}

export function batchOfYear(value: unknown): BatchYear | null {
  const numeric = typeof value === 'string' && value.trim().length > 0 ? Number(value) : value;
  return isBatchYear(numeric) ? numeric : null;
}

export function deliberateAudience(targetYears: number[] | null | undefined): BatchYear[] | null {
  if (!Array.isArray(targetYears)) return null;
  const unique = Array.from(
    new Set(targetYears.filter((year): year is BatchYear => isBatchYear(year)))
  ).sort((a, b) => a - b);
  if (unique.length === 0 || unique.length >= BATCH_YEARS.length) return null;
  return unique;
}

export function matchesBatch(attribution: BatchAttribution, batch: BatchFilter): boolean {
  const selected = normalizeBatch(batch);
  if (selected === ALL_BATCHES) return true;

  const authorBatch = batchOfYear(attribution.authorBatch);
  const audience = deliberateAudience(attribution.targetYears);

  if (authorBatch === null) {
    return audience === null ? true : audience.includes(selected);
  }
  if (authorBatch === selected) return true;
  return audience !== null && audience.includes(selected);
}

export function postAttribution(post: {
  author_year?: number | null;
  target_years?: number[] | null;
}): BatchAttribution {
  return { authorBatch: post.author_year ?? null, targetYears: post.target_years ?? null };
}

export function eventAttribution(event: {
  host_year?: number | null;
  target_years?: number[] | null;
}): BatchAttribution {
  return { authorBatch: event.host_year ?? null, targetYears: event.target_years ?? null };
}

export function filterPostsByBatch<T extends { author_year?: number | null; target_years?: number[] | null }>(
  posts: T[],
  batch: BatchFilter
): T[] {
  return posts.filter((post) => matchesBatch(postAttribution(post), batch));
}

export function filterEventsByBatch<T extends { host_year?: number | null; target_years?: number[] | null }>(
  events: T[],
  batch: BatchFilter
): T[] {
  return events.filter((event) => matchesBatch(eventAttribution(event), batch));
}

/* ------------------------------- selection ------------------------------- */

export interface FeedSelection {
  feedFilter: FeedFilter;
  batch: BatchFilter;
  searchQuery: string;
}

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase();
}

export function postMatchesSearch(post: Post, query: string): boolean {
  const needle = normalizeQuery(query);
  if (!needle) return true;
  return [
    post.title,
    post.body,
    post.author_name ?? '',
    post.author_usn ?? '',
    ...(post.tags ?? []),
    ...(post.tech_stack ?? []),
  ].some((value) => value.toLowerCase().includes(needle));
}

export function eventMatchesSearch(event: Event, query: string): boolean {
  const needle = normalizeQuery(query);
  if (!needle) return true;
  return [event.title, event.description, event.host_name ?? '', event.type].some((value) =>
    value.toLowerCase().includes(needle)
  );
}

export function announcementMatchesSearch(announcement: Announcement, query: string): boolean {
  const needle = normalizeQuery(query);
  if (!needle) return true;
  return [announcement.title, announcement.body, announcement.author_name ?? ''].some((value) =>
    value.toLowerCase().includes(needle)
  );
}

export function sortPostsNewestFirst(posts: Post[]): Post[] {
  return [...posts].sort((a, b) => {
    const timeA = Date.parse(a.created_at);
    const timeB = Date.parse(b.created_at);
    const safeA = Number.isFinite(timeA) ? timeA : 0;
    const safeB = Number.isFinite(timeB) ? timeB : 0;
    if (safeB !== safeA) return safeB - safeA;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

export function filterFeedPosts(posts: Post[], selection: FeedSelection): Post[] {
  const { feedFilter, batch, searchQuery } = selection;
  if (feedFilter === 'events' || feedFilter === 'announcements') return [];

  const typed = posts.filter((post) => {
    if (feedFilter === 'discussions') return post.type === 'discussion';
    if (feedFilter === 'showcases') return post.type === 'showcase';
    return true;
  });

  const batched = filterPostsByBatch(typed, batch);
  return sortPostsNewestFirst(batched.filter((post) => postMatchesSearch(post, searchQuery)));
}

export function filterFeedEvents(
  events: Event[],
  selection: FeedSelection,
  now: Date = new Date()
): Event[] {
  const { feedFilter, batch, searchQuery } = selection;
  if (
    feedFilter === 'discussions' ||
    feedFilter === 'showcases' ||
    feedFilter === 'announcements'
  ) {
    return [];
  }
  return filterActiveEvents(events, now)
    .filter((event) => matchesBatch(eventAttribution(event), batch))
    .filter((event) => eventMatchesSearch(event, searchQuery));
}

export function filterFeedAnnouncements(
  announcements: Announcement[],
  selection: FeedSelection
): Announcement[] {
  const { feedFilter, searchQuery } = selection;
  if (
    feedFilter === 'events' ||
    feedFilter === 'discussions' ||
    feedFilter === 'showcases'
  ) {
    return [];
  }
  return announcements.filter((announcement) =>
    announcementMatchesSearch(announcement, searchQuery)
  );
}

/* -------------------------------- ranking -------------------------------- */

const MAX_POPULAR_SHOWCASES = 2;

function asUpvotes(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return value > 0 ? value : 0;
}

function createdAtMs(post: { created_at: string }): number {
  const parsed = Date.parse(post.created_at);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Up to two showcases with at least one upvote: upvotes desc, newest, id. */
export function rankPopularShowcases<T extends { id: string; type?: string; upvote_count?: number | null; created_at: string }>(
  posts: T[]
): T[] {
  return posts
    .filter((post) => post.type === 'showcase' && asUpvotes(post.upvote_count) > 0)
    .sort((a, b) => {
      const upvotesA = asUpvotes(a.upvote_count);
      const upvotesB = asUpvotes(b.upvote_count);
      if (upvotesB !== upvotesA) return upvotesB - upvotesA;
      const timeA = createdAtMs(a);
      const timeB = createdAtMs(b);
      if (timeB !== timeA) return timeB - timeA;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    })
    .slice(0, MAX_POPULAR_SHOWCASES);
}

/* --------------------------------- events -------------------------------- */

export const EVENT_TIME_OFFSET = '+05:30';
export type EventPhase = 'upcoming' | 'live' | 'ended';

function startInstant(event: Pick<Event, 'event_date' | 'event_time'>): Date | null {
  const date = event.event_date?.trim();
  const time = event.event_time?.trim();
  if (!date || !time) return null;
  const timePart = time.length === 8 ? time : `${time}:00`;
  const parsed = new Date(`${date}T${timePart}${EVENT_TIME_OFFSET}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function getEventTimes(
  event: Pick<Event, 'event_date' | 'event_time' | 'duration'>
): { start: Date; end: Date } | null {
  const start = startInstant(event);
  if (!start) return null;
  const minutes = Number.isFinite(event.duration) && event.duration > 0 ? event.duration : 60;
  return { start, end: new Date(start.getTime() + minutes * 60_000) };
}

export function getEventPhase(event: Pick<Event, 'event_date' | 'event_time' | 'duration'>, now: Date = new Date()): EventPhase {
  const times = getEventTimes(event);
  if (!times) return 'upcoming';
  if (now.getTime() < times.start.getTime()) return 'upcoming';
  if (now.getTime() < times.end.getTime()) return 'live';
  return 'ended';
}

export function isEventUpcoming(
  event: Pick<Event, 'event_date' | 'event_time' | 'duration'>,
  now: Date = new Date()
): boolean {
  return getEventPhase(event, now) !== 'ended';
}

/**
 * Every mobile listing surface uses this filter. Ended events stay in the
 * database and in host-management views, but never appear in a feed, calendar,
 * search result or discovery list.
 *
 * Registration closing is not part of the event row, so it can never hide a
 * future event here: only the computed start + duration can.
 */
export function filterActiveEvents<T extends Pick<Event, 'event_date' | 'event_time' | 'duration'>>(
  events: readonly T[],
  now: Date = new Date()
): T[] {
  return events.filter((event) => isEventUpcoming(event, now));
}

/** Ascending start time; events without a parseable date sort last. */
export function sortEventsByStart<T extends Pick<Event, 'event_date' | 'event_time'>>(
  events: readonly T[]
): T[] {
  return [...events].sort((a, b) => {
    const at = startInstant(a)?.getTime() ?? Number.POSITIVE_INFINITY;
    const bt = startInstant(b)?.getTime() ?? Number.POSITIVE_INFINITY;
    return at - bt;
  });
}

/* ----------------------------- announcements ----------------------------- */

/**
 * Mirrors the announcements DELETE policy (author or admin). UI affordance
 * only; the server route and RLS decide the write.
 */
export function canDeleteAnnouncement(
  viewer: { id?: string | null; role?: string | null } | null | undefined,
  authorId: string
): boolean {
  if (!viewer?.id) return false;
  return viewer.id === authorId || viewer.role === 'admin';
}

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

export interface AnnouncementDayGroup {
  key: string;
  label: string;
  announcements: Announcement[];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;
}

function dayLabel(date: Date, now: Date): string {
  if (localDayKey(date) === localDayKey(now)) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (localDayKey(date) === localDayKey(yesterday)) return 'Yesterday';
  return date.getFullYear() === now.getFullYear()
    ? `${WEEKDAYS[date.getDay()]}, ${MONTHS[date.getMonth()]} ${date.getDate()}`
    : `${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

export function groupAnnouncementsByDay(
  announcements: Announcement[],
  now: Date = new Date()
): AnnouncementDayGroup[] {
  const groups = new Map<string, AnnouncementDayGroup>();

  for (const announcement of announcements) {
    const parsed = new Date(announcement.created_at);
    const valid = !Number.isNaN(parsed.getTime());
    const key = valid ? localDayKey(parsed) : 'unknown';
    const label = valid ? dayLabel(parsed, now) : 'Earlier';
    const existing = groups.get(key);
    if (existing) existing.announcements.push(announcement);
    else groups.set(key, { key, label, announcements: [announcement] });
  }

  return Array.from(groups.values());
}

/* ---------------------------------- pins --------------------------------- */

export const MAX_ACTIVE_DISCUSSION_PINS = 3;
export const PIN_LIMIT_MESSAGE =
  'The community already has 3 active pinned discussions. Wait for a pin to expire or unpin one first.';
export const PIN_PERMISSION_MESSAGE =
  'Only admins and verified faculty can pin or unpin discussions.';
export const PIN_SLOTS_FULL_MESSAGE =
  'All 3 pin slots are in use. Unpin a discussion or wait for one to expire.';

/** Formats the remaining pin lifetime; the server clock owns expiry. */
export function formatPinCountdown(expiresAt: string, now: Date = new Date()): string {
  const expires = Date.parse(expiresAt);
  const nowMs = now.getTime();
  if (!Number.isFinite(expires) || expires <= nowMs) return 'Expired';

  const totalSeconds = Math.floor((expires - nowMs) / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) return `Expires in ${days}d ${hours}h`;
  if (hours > 0) return `Expires in ${hours}h ${minutes}m`;
  if (minutes > 0) return `Expires in ${minutes}m ${seconds}s`;
  return `Expires in ${seconds}s`;
}

export function pinErrorMessage(message: string | null | undefined): string {
  const raw = (message ?? '').trim();
  const lower = raw.toLowerCase();

  if (lower.includes('community already has 3 active pinned discussions')) return PIN_LIMIT_MESSAGE;
  if (lower.includes('only admins and verified faculty') || lower.includes('only verified faculty')) {
    return PIN_PERMISSION_MESSAGE;
  }
  if (lower.includes('already pinned')) return 'This discussion is already pinned.';
  if (lower.includes('already expired')) return 'This pin has already expired.';
  if (lower.includes('not pinned')) return 'This discussion is no longer pinned.';
  if (lower.includes('only discussions')) return 'Only discussions can be pinned.';
  if (lower.includes('discussion not found')) return 'This discussion no longer exists.';
  if (lower.includes('a discussion id is required')) return 'Choose a discussion to pin.';
  return raw || 'Could not update the pin. Please try again.';
}

/** Adds active pin fields to posts without changing their order. */
export function applyActivePinsToPosts(posts: Post[], pins: DiscussionPin[], now: number = Date.now()): Post[] {
  const activeByPost = new Map<string, DiscussionPin>();
  for (const pin of pins) {
    if (pin.unpinned_at) continue;
    const expires = Date.parse(pin.pin_expires_at);
    if (!Number.isFinite(expires) || expires <= now) continue;
    const current = activeByPost.get(pin.post_id);
    if (!current || Date.parse(pin.pinned_at) > Date.parse(current.pinned_at)) {
      activeByPost.set(pin.post_id, pin);
    }
  }

  return posts.map((post) => {
    const pin = activeByPost.get(post.id);
    return {
      ...post,
      pinned_by: pin?.pinned_by ?? null,
      pinned_at: pin?.pinned_at ?? null,
      pin_expires_at: pin?.pin_expires_at ?? null,
    };
  });
}

/* --------------------------------- links --------------------------------- */

export type LinkToken =
  | { type: 'text'; value: string }
  | { type: 'link'; href: string; label: string };

const URL_PATTERN = /(?:https?:\/\/|www\.)[^\s<>]+/gi;
const TRAILING_PUNCTUATION = ',;:!?.';
const BRACKET_PAIRS: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
const WORD_CHAR = /[\w-]/;

function countChar(haystack: string, needle: string): number {
  let count = 0;
  for (const char of haystack) if (char === needle) count += 1;
  return count;
}

function trimTrailingPunctuation(raw: string): string {
  let url = raw;
  for (;;) {
    const last = url.charAt(url.length - 1);
    if (!last) return url;
    if (TRAILING_PUNCTUATION.includes(last)) {
      url = url.slice(0, -1);
      continue;
    }
    const opener = BRACKET_PAIRS[last];
    if (opener) {
      if (countChar(url, last) > countChar(url, opener)) {
        url = url.slice(0, -1);
        continue;
      }
      return url;
    }
    if (last === '"' || last === "'") {
      if (countChar(url, last) % 2 === 1) {
        url = url.slice(0, -1);
        continue;
      }
      return url;
    }
    return url;
  }
}

function safeHref(raw: string): string | null {
  if (!raw) return null;
  const candidate = /^www\./i.test(raw) ? `https://${raw}` : raw;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (!parsed.hostname.includes('.')) return null;
  return candidate;
}

/** Splits text into plain-text and validated http(s) link tokens. */
export function parseLinks(text: string): LinkToken[] {
  if (!text) return [];

  const tokens: LinkToken[] = [];
  const pattern = new RegExp(URL_PATTERN.source, 'gi');
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const start = match.index;
    if (start > 0 && WORD_CHAR.test(text.charAt(start - 1))) continue;

    const label = trimTrailingPunctuation(match[0]);
    const href = safeHref(label);
    if (!href) continue;

    if (start > cursor) tokens.push({ type: 'text', value: text.slice(cursor, start) });
    tokens.push({ type: 'link', href, label });
    cursor = start + label.length;
  }

  if (cursor < text.length) tokens.push({ type: 'text', value: text.slice(cursor) });
  return tokens;
}
