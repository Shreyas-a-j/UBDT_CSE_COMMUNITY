/**
 * Feed selection rules — UCC 2.0 Phase 6
 *
 * The feed, the sidebar widgets and the batch counters all derive what they
 * show from these pure functions, so a batch selection changes every section
 * from one rule instead of each surface keeping its own copy.
 *
 * Sections:
 *   - Latest posts  → type + batch + search, newest first
 *   - Popular       → ranked Project Showcases taken from the *filtered* posts
 *   - Trending      → the same ranking for the sidebar, batch-filtered
 *   - Events        → batch + search (an event is batch-scoped by its host or
 *                     by a deliberately narrowed audience)
 *   - Announcements → search only: faculty announcements are institutional and
 *                     batch-agnostic, so they stay visible in every batch view
 */
import type { Announcement, Event, FeedFilter, Post, YearFilter } from '@/lib/types'
import { filterEventsByBatch, filterPostsByBatch } from '@/lib/logic/batch'
import { rankPopularShowcases } from '@/lib/logic/ranking'

export interface FeedSelection {
  feedFilter: FeedFilter
  batch: YearFilter
  searchQuery: string
}

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase()
}

export function postMatchesSearch(post: Post, query: string): boolean {
  const needle = normalizeQuery(query)
  if (!needle) return true

  const haystack = [
    post.title,
    post.body,
    post.author_name ?? '',
    post.author_usn ?? '',
    ...(post.tags ?? []),
    ...(post.tech_stack ?? []),
  ]

  return haystack.some(value => value.toLowerCase().includes(needle))
}

export function eventMatchesSearch(event: Event, query: string): boolean {
  const needle = normalizeQuery(query)
  if (!needle) return true

  return [event.title, event.description, event.host_name ?? '', event.type].some(value =>
    value.toLowerCase().includes(needle)
  )
}

export function announcementMatchesSearch(announcement: Announcement, query: string): boolean {
  const needle = normalizeQuery(query)
  if (!needle) return true

  return [announcement.title, announcement.body, announcement.author_name ?? ''].some(value =>
    value.toLowerCase().includes(needle)
  )
}

/** Newest first; an unparseable timestamp sorts last, id breaks exact ties. */
export function sortPostsNewestFirst(posts: Post[]): Post[] {
  return [...posts].sort((a, b) => {
    const timeA = Date.parse(a.created_at)
    const timeB = Date.parse(b.created_at)
    const safeA = Number.isFinite(timeA) ? timeA : 0
    const safeB = Number.isFinite(timeB) ? timeB : 0
    if (safeB !== safeA) return safeB - safeA
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}

/** The "Latest posts" section: type filter, then batch, then search. */
export function filterFeedPosts(posts: Post[], selection: FeedSelection): Post[] {
  const { feedFilter, batch, searchQuery } = selection
  if (feedFilter === 'events' || feedFilter === 'announcements') return []

  const typed = posts.filter(post => {
    if (feedFilter === 'discussions') return post.type === 'discussion'
    if (feedFilter === 'showcases') return post.type === 'showcase'
    return true
  })

  const batched = filterPostsByBatch(typed, batch)
  return sortPostsNewestFirst(batched.filter(post => postMatchesSearch(post, searchQuery)))
}

/** The "Upcoming events" section. */
export function filterFeedEvents(events: Event[], selection: FeedSelection): Event[] {
  const { feedFilter, batch, searchQuery } = selection
  if (
    feedFilter === 'discussions' ||
    feedFilter === 'showcases' ||
    feedFilter === 'announcements'
  ) {
    return []
  }

  const batched = filterEventsByBatch(events, batch)
  return batched.filter(event => eventMatchesSearch(event, searchQuery))
}

/**
 * The "Announcements" section. Deliberately ignores the batch: announcements
 * come from faculty and are addressed to the whole department.
 */
export function filterFeedAnnouncements(
  announcements: Announcement[],
  selection: FeedSelection
): Announcement[] {
  const { feedFilter, searchQuery } = selection
  if (
    feedFilter === 'events' ||
    feedFilter === 'discussions' ||
    feedFilter === 'showcases'
  ) {
    return []
  }

  return announcements.filter(announcement => announcementMatchesSearch(announcement, searchQuery))
}

/**
 * Popular section: at most two qualifying Project Showcases ranked by upvote
 * count (lib/logic/ranking.ts). It is fed the already-filtered posts, so the
 * section honors the active type, batch and search filters.
 */
export function selectPopularShowcases(posts: Post[]): Post[] {
  return rankPopularShowcases(posts)
}

/**
 * Sidebar "Trending posts": the same ranking, batch-filtered. Search is a
 * feed-scoped affordance and intentionally does not reach the widgets.
 */
export function selectTrendingShowcases(posts: Post[], batch: YearFilter): Post[] {
  return rankPopularShowcases(filterPostsByBatch(posts, batch))
}
