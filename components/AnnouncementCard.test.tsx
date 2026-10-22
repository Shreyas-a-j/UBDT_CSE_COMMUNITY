import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import AnnouncementCard from './AnnouncementCard'
import type { Announcement, Profile } from '@/lib/types'

const contextMock = vi.hoisted(() => ({
  currentUser: null as Profile | null,
  toggleAnnouncementReaction: vi.fn(),
  setIsAuthModalOpen: vi.fn(),
}))

vi.mock('@/contexts/CommunityContext', () => ({
  useCommunity: () => contextMock,
}))

const announcement: Announcement = {
  id: 'a1',
  author_id: 'f1',
  title: 'Project submission deadline extended',
  body: 'The deadline is now Friday, 5 PM.',
  image_urls: ['https://cdn.test/one.png', 'https://cdn.test/two.png'],
  created_at: '2026-10-20T09:00:00.000Z',
  updated_at: '2026-10-20T09:00:00.000Z',
  author_name: 'Dr Rao',
  author_avatar: null,
  author_designation: 'Professor',
  reactions: [
    { user_id: 'u1', reaction: 'thumbs_up' },
    { user_id: 'u2', reaction: 'thumbs_up' },
  ],
}

const viewer = { id: 'u1', name: 'Alice', role: 'student' } as unknown as Profile

beforeEach(() => {
  contextMock.currentUser = viewer
  contextMock.toggleAnnouncementReaction.mockClear()
  contextMock.setIsAuthModalOpen.mockClear()
})

describe('AnnouncementCard', () => {
  it('renders the author, title, message, designation and images', () => {
    render(<AnnouncementCard announcement={announcement} />)

    expect(screen.getByText('Dr Rao')).toBeInTheDocument()
    expect(screen.getByText('Professor')).toBeInTheDocument()
    expect(screen.getByText('Faculty')).toBeInTheDocument()
    expect(screen.getByText('Project submission deadline extended')).toBeInTheDocument()
    expect(screen.getByText('The deadline is now Friday, 5 PM.')).toBeInTheDocument()

    expect(screen.getByAltText('Project submission deadline extended — attachment 1 of 2')).toHaveAttribute(
      'src',
      'https://cdn.test/one.png'
    )
    expect(screen.getByAltText('Project submission deadline extended — attachment 2 of 2')).toBeInTheDocument()
  })

  it('shows accurate reaction counts and marks exactly one of the viewer’s reactions', () => {
    render(<AnnouncementCard announcement={announcement} />)

    const thumbs = screen.getByRole('button', { name: /Thumbs up, 2 reactions, you reacted/i })
    const heart = screen.getByRole('button', { name: /Love, no reactions yet/i })
    const party = screen.getByRole('button', { name: /Celebrate, no reactions yet/i })

    expect(thumbs).toHaveTextContent('2')
    expect(thumbs).toHaveAttribute('aria-pressed', 'true')
    expect(heart).toHaveAttribute('aria-pressed', 'false')
    expect(party).toHaveAttribute('aria-pressed', 'false')
    expect(party).not.toHaveTextContent('0')
    expect(screen.getAllByRole('button', { pressed: true })).toHaveLength(1)
  })

  it('selects only the latest reaction when legacy rows hold more than one', () => {
    render(
      <AnnouncementCard
        announcement={{
          ...announcement,
          reactions: [
            { user_id: 'u1', reaction: 'thumbs_up', created_at: '2026-10-20T10:00:00.000Z' },
            { user_id: 'u1', reaction: 'heart', created_at: '2026-10-21T10:00:00.000Z' },
          ],
        }}
      />
    )

    expect(screen.getByRole('button', { name: /Thumbs up/i })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: /Love/i })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getAllByRole('button', { pressed: true })).toHaveLength(1)
  })

  it('toggles a reaction through the context', () => {
    render(<AnnouncementCard announcement={announcement} />)

    fireEvent.click(screen.getByRole('button', { name: /Applause/i }))

    expect(contextMock.toggleAnnouncementReaction).toHaveBeenCalledWith('a1', 'clap')
  })

  it('sends signed-out visitors to the auth modal instead of toggling', () => {
    contextMock.currentUser = null
    render(<AnnouncementCard announcement={announcement} />)

    fireEvent.click(screen.getByRole('button', { name: /Love/i }))

    expect(contextMock.setIsAuthModalOpen).toHaveBeenCalledWith(true)
    expect(contextMock.toggleAnnouncementReaction).not.toHaveBeenCalled()
  })

  it('offers no comment, reply or messaging controls', () => {
    render(<AnnouncementCard announcement={announcement} />)

    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByText(/reply/i)).toBeNull()
    expect(screen.queryByText(/comment/i)).toBeNull()
  })

  it('renders the channel variant without the feed card chrome', () => {
    const { container } = render(<AnnouncementCard announcement={announcement} variant="message" />)

    const article = container.querySelector('article')
    expect(article).not.toBeNull()
    expect(article?.className).not.toContain('card')
  })
})
