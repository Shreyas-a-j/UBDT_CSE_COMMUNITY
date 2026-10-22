import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import CommunitySidebar from './CommunitySidebar'

/**
 * Phase 6.1: the three announcement entry points (top navbar, left menu and
 * the right-hand announcements widget) must all open the same canonical
 * announcement page. This pins the left-menu entry to that route.
 */
const contextMock = vi.hoisted(() => ({
  currentUser: null,
  posts: [],
  events: [],
  announcements: [],
  feedFilter: 'all',
  setFeedFilter: vi.fn(),
  yearFilter: 0,
  setYearFilter: vi.fn(),
  searchQuery: '',
  setSearchQuery: vi.fn(),
  setIsAuthModalOpen: vi.fn(),
  setIsProfileModalOpen: vi.fn(),
  setSelectedProfileForView: vi.fn(),
}))

vi.mock('@/contexts/CommunityContext', () => ({
  useCommunity: () => contextMock,
}))

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn() }),
}))

describe('CommunitySidebar announcements entry', () => {
  it('navigates to the canonical announcements page', () => {
    render(<CommunitySidebar />)

    const entry = screen.getByRole('link', { name: /Announcements/i })
    expect(entry).toHaveAttribute('href', '/announcements')
  })

  it('does not filter the feed in place', () => {
    render(<CommunitySidebar />)

    expect(screen.queryByRole('button', { name: /^Announcements/i })).toBeNull()
  })
})
