/**
 * Feed selection rules (UCC 2.0 Phase 6)
 *
 * These are the sections a batch selection must actually change: Popular,
 * Latest and the sidebar's Trending. The tests drive the same pure selectors
 * the page and sidebar render from.
 */
import { describe, it, expect } from 'vitest'
import type { Announcement, Event, Post } from '@/lib/types'
import {
  eventMatchesSearch,
  filterFeedAnnouncements,
  filterFeedEvents,
  filterFeedPosts,
  selectPopularShowcases,
  selectTrendingShowcases,
} from './feed'

function makePost(overrides: Partial<Post> = {}): Post {
  return {
    id: 'post-1',
    author_id: 'author-1',
    type: 'discussion',
    title: 'Post title',
    body: 'Post body',
    image_url: null,
    github_url: null,
    demo_url: null,
    tech_stack: [],
    tags: [],
    target_years: [1, 2, 3, 4],
    created_at: '2026-10-20T10:00:00.000Z',
    author_name: 'Alice',
    author_usn: '4UB24CS001',
    author_avatar: null,
    author_year: 2,
    author_role: 'student',
    like_count: 0,
    upvote_count: 0,
    comment_count: 0,
    ...overrides,
  }
}

function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: 'event-1',
    host_id: 'author-1',
    title: 'Workshop',
    description: 'A workshop',
    type: 'Workshop',
    event_date: '2026-11-01',
    event_time: '10:00',
    duration: 60,
    link: null,
    target_years: [1, 2, 3, 4],
    created_at: '2026-10-01T00:00:00.000Z',
    host_name: 'Alice',
    host_year: 2,
    ...overrides,
  }
}

function makeAnnouncement(overrides: Partial<Announcement> = {}): Announcement {
  return {
    id: 'announcement-1',
    author_id: 'faculty-1',
    title: 'Mid-sem deadline',
    body: 'Submit by Friday.',
    image_urls: [],
    created_at: '2026-10-21T09:00:00.000Z',
    updated_at: '2026-10-21T09:00:00.000Z',
    author_name: 'Dr Rao',
    author_avatar: null,
    author_designation: 'Professor',
    reactions: [],
    ...overrides,
  }
}

const selection = (overrides: Partial<Parameters<typeof filterFeedPosts>[1]> = {}) => ({
  feedFilter: 'all' as const,
  batch: 0 as const,
  searchQuery: '',
  ...overrides,
})

const yearPosts = [
  makePost({ id: 'y1', title: 'First year notes', author_year: 1 }),
  makePost({ id: 'y2', title: 'Second year notes', author_year: 2 }),
  makePost({ id: 'y3', title: 'Third year notes', author_year: 3 }),
  makePost({ id: 'y4', title: 'Fourth year notes', author_year: 4 }),
  makePost({ id: 'staff', title: 'Faculty guidance', author_year: null }),
]

describe('filterFeedPosts', () => {
  it('keeps only the selected batch (plus batch-agnostic faculty content)', () => {
    const result = filterFeedPosts(yearPosts, selection({ batch: 3 }))

    expect(result.map(post => post.id).sort()).toEqual(['staff', 'y3'])
  })

  it('restores the complete feed for All batches', () => {
    const result = filterFeedPosts(yearPosts, selection({ batch: 0 }))

    expect(result.map(post => post.id).sort()).toEqual(['staff', 'y1', 'y2', 'y3', 'y4'])
  })

  it('treats an invalid batch value as All batches', () => {
    const result = filterFeedPosts(yearPosts, selection({ batch: Number.NaN as never }))

    expect(result).toHaveLength(yearPosts.length)
  })

  it('still applies the feed tab on top of the batch', () => {
    const posts = [
      makePost({ id: 'disc', type: 'discussion', author_year: 3 }),
      makePost({ id: 'show', type: 'showcase', author_year: 3 }),
      makePost({ id: 'other', type: 'showcase', author_year: 2 }),
    ]

    expect(
      filterFeedPosts(posts, selection({ feedFilter: 'showcases', batch: 3 })).map(post => post.id)
    ).toEqual(['show'])
    expect(filterFeedPosts(posts, selection({ feedFilter: 'discussions' })).map(post => post.id)).toEqual([
      'disc',
    ])
  })

  it('hides posts when an unrelated section is selected', () => {
    expect(filterFeedPosts(yearPosts, selection({ feedFilter: 'events' }))).toEqual([])
    expect(filterFeedPosts(yearPosts, selection({ feedFilter: 'announcements' }))).toEqual([])
  })

  it('searches title, body, author, tags and tech stack', () => {
    const posts = [
      makePost({ id: 'title', title: 'Rust ownership' }),
      makePost({ id: 'body', body: 'We used Next.js for this' }),
      makePost({ id: 'tag', tags: ['Placements'] }),
      makePost({ id: 'tech', tech_stack: ['Supabase'] }),
      makePost({ id: 'author', author_name: 'Meera' }),
    ]

    for (const [query, id] of [
      ['rust', 'title'],
      ['next.js', 'body'],
      ['placements', 'tag'],
      ['supabase', 'tech'],
      ['meera', 'author'],
    ] as const) {
      expect(filterFeedPosts(posts, selection({ searchQuery: query })).map(post => post.id)).toEqual([id])
    }
  })

  it('sorts newest first with a deterministic id tie-break', () => {
    const posts = [
      makePost({ id: 'b', created_at: '2026-10-20T10:00:00.000Z' }),
      makePost({ id: 'a', created_at: '2026-10-20T10:00:00.000Z' }),
      makePost({ id: 'new', created_at: '2026-10-22T10:00:00.000Z' }),
    ]

    expect(filterFeedPosts(posts, selection()).map(post => post.id)).toEqual(['new', 'a', 'b'])
  })
})

describe('Popular and Trending', () => {
  const posts = [
    makePost({ id: 'y1-show', type: 'showcase', author_year: 1, upvote_count: 9 }),
    makePost({ id: 'y2-show', type: 'showcase', author_year: 2, upvote_count: 8 }),
    makePost({ id: 'y2-top', type: 'showcase', author_year: 2, upvote_count: 12 }),
    makePost({ id: 'y3-show', type: 'showcase', author_year: 3, upvote_count: 5 }),
    makePost({ id: 'y3-talk', type: 'discussion', author_year: 3, upvote_count: 40 }),
  ]

  it('ranks the filtered batch by upvotes and caps the section at two', () => {
    const filtered = filterFeedPosts(posts, selection({ batch: 2, feedFilter: 'showcases' }))

    expect(selectPopularShowcases(filtered).map(post => post.id)).toEqual(['y2-top', 'y2-show'])
  })

  it('never lets a discussion fill a Popular slot', () => {
    const filtered = filterFeedPosts(posts, selection({ batch: 3, feedFilter: 'showcases' }))

    expect(selectPopularShowcases(filtered).map(post => post.id)).toEqual(['y3-show'])
  })

  it('makes the sidebar Trending batch-aware (it previously ignored the filter)', () => {
    expect(selectTrendingShowcases(posts, 3).map(post => post.id)).toEqual(['y3-show'])
    expect(selectTrendingShowcases(posts, 2).map(post => post.id)).toEqual(['y2-top', 'y2-show'])
    expect(selectTrendingShowcases(posts, 0)).toHaveLength(2)
  })
})

describe('filterFeedEvents', () => {
  it('filters events by the host batch', () => {
    const events = [
      makeEvent({ id: 'y2', host_year: 2 }),
      makeEvent({ id: 'y4', host_year: 4 }),
      makeEvent({ id: 'staff', host_year: null }),
    ]

    expect(filterFeedEvents(events, selection({ batch: 4 })).map(event => event.id)).toEqual(['y4', 'staff'])
  })

  it('keeps an event in its host batch and honors a deliberately narrowed audience', () => {
    const events = [
      // Hosted by a 2nd-year, aimed at everyone: belongs to the 2nd-year view.
      makeEvent({ id: 'own', host_year: 2, target_years: [1, 2, 3, 4] }),
      // Hosted by a 2nd-year but deliberately aimed at 1st-years as well.
      makeEvent({ id: 'narrow', host_year: 2, target_years: [1] }),
    ]

    expect(filterFeedEvents(events, selection({ batch: 2 })).map(event => event.id)).toEqual([
      'own',
      'narrow',
    ])
    expect(filterFeedEvents(events, selection({ batch: 1 })).map(event => event.id)).toEqual(['narrow'])
    expect(filterFeedEvents(events, selection({ batch: 3 }))).toEqual([])
  })

  it('searches events and hides them in post-only tabs', () => {
    const events = [makeEvent({ id: 'ai', title: 'AI workshop' })]

    expect(filterFeedEvents(events, selection({ searchQuery: 'ai' })).map(event => event.id)).toEqual(['ai'])
    expect(filterFeedEvents(events, selection({ searchQuery: 'blockchain' }))).toEqual([])
    expect(filterFeedEvents(events, selection({ feedFilter: 'showcases' }))).toEqual([])
  })

  it('matches event search on title, description, host and type', () => {
    const event = makeEvent({ title: 'Systems', description: 'Kernel deep dive', host_name: 'Dr Rao', type: 'Seminar' })

    expect(eventMatchesSearch(event, 'kernel')).toBe(true)
    expect(eventMatchesSearch(event, 'dr rao')).toBe(true)
    expect(eventMatchesSearch(event, 'seminar')).toBe(true)
    expect(eventMatchesSearch(event, 'nothing')).toBe(false)
  })
})

describe('filterFeedAnnouncements', () => {
  const announcements = [makeAnnouncement({ id: 'a1' }), makeAnnouncement({ id: 'a2', body: 'Library hours' })]

  it('stays visible across batch selections (announcements are department-wide)', () => {
    expect(filterFeedAnnouncements(announcements, selection({ batch: 1 }))).toHaveLength(2)
    expect(filterFeedAnnouncements(announcements, selection({ batch: 4 }))).toHaveLength(2)
  })

  it('searches announcements and hides them in other tabs', () => {
    expect(
      filterFeedAnnouncements(announcements, selection({ searchQuery: 'library' })).map(item => item.id)
    ).toEqual(['a2'])
    expect(filterFeedAnnouncements(announcements, selection({ feedFilter: 'events' }))).toEqual([])
    expect(filterFeedAnnouncements(announcements, selection({ feedFilter: 'discussions' }))).toEqual([])
    expect(filterFeedAnnouncements(announcements, selection({ feedFilter: 'showcases' }))).toEqual([])
  })
})
