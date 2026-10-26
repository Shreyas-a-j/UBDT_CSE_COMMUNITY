import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, within } from '@testing-library/react'
import Home from './page'
import type { Post } from '@/lib/types'
import { normalizeBatch } from '@/lib/logic/batch'

/**
 * Batch-selection regression (UCC 2.0 Phase 6).
 *
 * The bug: `posts.target_years` defaults to [1,2,3,4], so the old predicate
 * matched every post in every batch (and posts with no author year skipped the
 * check entirely). Choosing a batch changed nothing in Popular or Latest while
 * the sidebar ignored the batch altogether. This test renders the real feed
 * with the real cards and asserts on what a member actually sees.
 */

const routerMock = vi.hoisted(() => ({
  push: vi.fn(),
  back: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  prefetch: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => routerMock,
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/components/AppShell', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/contexts/CommunityContext', async () => {
  const ReactModule = await vi.importActual<typeof import('react')>('react')
  return {
    useCommunity: () =>
      ReactModule.useContext(
        (
          CommunityModule as unknown as {
            __testContext: React.Context<Record<string, unknown> | null>
          }
        ).__testContext
      ),
    __testContext: ReactModule.createContext<Record<string, unknown> | null>(null),
  }
})

import * as CommunityModule from '@/contexts/CommunityContext'

const TestContext = (
  CommunityModule as unknown as { __testContext: React.Context<Record<string, unknown> | null> }
).__testContext

function makePost(overrides: Partial<Post> & Pick<Post, 'id' | 'title'>): Post {
  return {
    author_id: `author-${overrides.id}`,
    type: 'showcase',
    body: `Body for ${overrides.title}`,
    image_url: null,
    github_url: null,
    demo_url: null,
    tech_stack: ['React'],
    tags: ['Project'],
    target_years: [1, 2, 3, 4], // the database/composer default
    created_at: '2026-10-20T10:00:00.000Z',
    author_name: 'Alice',
    author_usn: '4UB24CS001',
    author_avatar: null,
    author_year: null,
    author_role: 'student',
    like_count: 0,
    upvote_count: 0,
    comment_count: 0,
    ...overrides,
  }
}

const posts: Post[] = [
  makePost({ id: 'p1', title: 'Year 1 project', author_year: 1, upvote_count: 9 }),
  makePost({ id: 'p2', title: 'Year 2 project', author_year: 2, upvote_count: 8 }),
  makePost({ id: 'p3', title: 'Year 3 project', author_year: 3, upvote_count: 5 }),
  makePost({ id: 'p4', title: 'Year 4 project', author_year: 4, upvote_count: 4 }),
  makePost({
    id: 'p5',
    title: 'Year 3 discussion',
    type: 'discussion',
    author_year: 3,
    like_count: 12,
    upvote_count: 0,
  }),
  // Faculty content has no batch: it must not be hidden by a batch selection
  // and must not be invented into one either.
  makePost({ id: 'staff', title: 'Faculty guidance', author_year: null, author_role: 'faculty' }),
]

const openCreateEventMock = vi.fn()

const baseValue: Record<string, unknown> = {
  currentUser: null,
  posts,
  pinnedPosts: [],
  pinnedPostIds: new Set<string>(),
  pinPendingIds: new Set<string>(),
  pinDiscussion: vi.fn(),
  unpinDiscussion: vi.fn(),
  events: [],
  announcements: [],
  feedLoading: false,
  feedError: null,
  likedPostIds: new Set<string>(),
  upvotedPostIds: new Set<string>(),
  rsvpedEventIds: new Set<string>(),
  comments: [],
  notifications: [],
  toggleLikePost: vi.fn(),
  toggleUpvotePost: vi.fn(),
  deletePost: vi.fn(),
  updatePost: vi.fn(),
  addComment: vi.fn(),
  deleteComment: vi.fn(),
  toggleCommentLike: vi.fn(),
  deleteEvent: vi.fn(),
  updateEvent: vi.fn(),
  toggleRsvpEvent: vi.fn(),
  toggleAnnouncementReaction: vi.fn(),
  createAnnouncement: vi.fn(),
  setIsCreatePostOpen: vi.fn(),
  setIsCreateEventOpen: vi.fn(),
  openCreateEvent: openCreateEventMock,
  setIsAuthModalOpen: vi.fn(),
  setIsProfileModalOpen: vi.fn(),
  setSelectedProfileForView: vi.fn(),
  markNotificationAsRead: vi.fn(),
  markAllNotificationsAsRead: vi.fn(),
  signOut: vi.fn(),
}

function Harness({ overrides = {} }: { overrides?: Record<string, unknown> }) {
  const [yearFilter, setYearFilterState] = React.useState(0)
  const [feedFilter, setFeedFilter] = React.useState<'all' | 'events' | 'discussions' | 'showcases' | 'announcements'>('all')
  const [searchQuery, setSearchQuery] = React.useState('')

  // Mirrors the provider: anything invalid normalizes to All batches.
  const setYearFilter = (value: unknown) => setYearFilterState(normalizeBatch(value))

  return (
    <TestContext.Provider
      value={{
        ...baseValue,
        ...overrides,
        yearFilter,
        setYearFilter,
        feedFilter,
        setFeedFilter,
        searchQuery,
        setSearchQuery,
      }}
    >
      <button type="button" onClick={() => setYearFilter(99)}>
        corrupt batch
      </button>
      <Home />
    </TestContext.Provider>
  )
}

const selectBatch = (label: string) => {
  fireEvent.change(screen.getByLabelText('Batch'), { target: { value: label } })
}

const popularTitles = () => {
  const region = screen.getByRole('region', { name: /Popular/i })
  return within(region)
    .queryAllByText(/^Year \d project$/)
    .map(node => node.textContent)
}

const trendingTitles = () => {
  const aside = screen.getByRole('complementary', { name: /Community highlights/i })
  return within(aside)
    .queryAllByText(/^Year \d project$/)
    .map(node => node.textContent)
}

describe('batch selection filters the real feed', () => {
  it('shows everything for All batches', () => {
    render(<Harness />)

    expect(screen.getAllByText('Year 1 project').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Year 2 project').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Year 3 project').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Year 4 project').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Faculty guidance').length).toBeGreaterThan(0)
  })

  it('removes other batches from Latest and Popular when a batch is selected', () => {
    render(<Harness />)

    selectBatch('3')

    expect(screen.queryByText('Year 1 project')).toBeNull()
    expect(screen.queryByText('Year 2 project')).toBeNull()
    expect(screen.queryByText('Year 4 project')).toBeNull()
    expect(screen.getAllByText('Year 3 project').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Year 3 discussion').length).toBeGreaterThan(0)

    // Popular is ranked from the filtered posts, so only the 3rd-year showcase
    // can occupy a slot — and discussions never fill one.
    expect(popularTitles()).toEqual(['Year 3 project'])
  })

  it('keeps faculty (batch-agnostic) content visible without assigning it a batch', () => {
    render(<Harness />)

    selectBatch('2')

    expect(screen.getAllByText('Faculty guidance').length).toBeGreaterThan(0)
    expect(screen.queryByText('Year 3 project')).toBeNull()
  })

  it('restores the full feed when All batches is chosen again', () => {
    render(<Harness />)

    selectBatch('2')
    expect(screen.queryByText('Year 1 project')).toBeNull()

    selectBatch('0')

    expect(screen.getAllByText('Year 1 project').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Year 4 project').length).toBeGreaterThan(0)
  })

  it('makes the sidebar Trending widget honor the batch (it used to ignore it)', () => {
    render(<Harness />)

    // All batches: the top two showcases by upvotes are 1st and 2nd year.
    expect(trendingTitles().sort()).toEqual(['Year 1 project', 'Year 2 project'])

    selectBatch('3')

    expect(trendingTitles()).toEqual(['Year 3 project'])
  })

  it('treats a corrupted batch value as All batches instead of blanking the feed', () => {
    render(<Harness />)

    fireEvent.click(screen.getByRole('button', { name: 'corrupt batch' }))

    expect(screen.getAllByText('Year 1 project').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Year 4 project').length).toBeGreaterThan(0)
  })
})

describe('pinned discussions', () => {
  it('renders an active pin once, in the Pinned section', () => {
    const pinned = posts.find(post => post.id === 'p5')!
    render(
      <Harness
        overrides={{
          pinnedPosts: [pinned],
          pinnedPostIds: new Set(['p5']),
        }}
      />
    )

    const region = screen.getByRole('region', { name: /Pinned/i })
    expect(within(region).getByText('Year 3 discussion')).toBeInTheDocument()
    // Not duplicated in Latest: the same discussion is shown exactly once.
    expect(screen.getAllByText('Year 3 discussion')).toHaveLength(1)
  })

  it('keeps the regular feed unchanged when nothing is pinned', () => {
    render(<Harness />)

    expect(screen.queryByRole('region', { name: /Pinned/i })).not.toBeInTheDocument()
    expect(screen.getByText('Year 3 discussion')).toBeInTheDocument()
  })

  it('tells an authorized admin when all three pin slots are occupied', () => {
    const pinned = [1, 2, 3].map(index =>
      makePost({
        id: `pinned-${index}`,
        title: `Pinned discussion ${index}`,
        type: 'discussion',
      })
    )

    render(
      <Harness
        overrides={{
          currentUser: { id: 'admin-1', role: 'admin', faculty_status: 'none' },
          pinnedPosts: pinned,
          pinnedPostIds: new Set(pinned.map(post => post.id)),
        }}
      />
    )

    expect(screen.getByRole('status')).toHaveTextContent(/All 3 pin slots are in use/)
  })

  it('does not show the slot message to a student', () => {
    const pinned = [1, 2, 3].map(index =>
      makePost({
        id: `pinned-${index}`,
        title: `Pinned discussion ${index}`,
        type: 'discussion',
      })
    )

    render(
      <Harness
        overrides={{
          currentUser: { id: 'student-1', role: 'student', faculty_status: 'none' },
          pinnedPosts: pinned,
          pinnedPostIds: new Set(pinned.map(post => post.id)),
        }}
      />
    )

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})

describe('event entry points', () => {
  it('opens the shared event composer from the community feed', () => {
    render(<Harness />)

    fireEvent.click(screen.getByRole('button', { name: /^Host event$/i }))

    expect(openCreateEventMock).toHaveBeenCalledTimes(1)
  })
})
