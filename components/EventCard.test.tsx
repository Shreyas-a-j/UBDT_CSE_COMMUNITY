import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import EventCard from './EventCard'
import type { Event, Profile } from '@/lib/types'

const routerMock = vi.hoisted(() => ({ push: vi.fn() }))
const useCommunityMock = vi.hoisted(() => vi.fn())
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))

vi.mock('next/navigation', () => ({ useRouter: () => routerMock }))
vi.mock('@/contexts/CommunityContext', () => ({
  useCommunity: () => useCommunityMock(),
}))
vi.mock('react-hot-toast', () => ({ default: toastMock }))

function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: 'event-1',
    host_id: 'host-1',
    host_name: 'Host Name',
    host_avatar: null,
    host_usn: '4UB24CS001',
    title: 'Systems workshop',
    description: 'A hands-on workshop.',
    type: 'Workshop',
    event_date: '2099-10-24',
    event_time: '18:00',
    duration: 60,
    link: null,
    target_years: [1, 2, 3, 4],
    created_at: '2026-10-01T00:00:00.000Z',
    rsvp_count: 4,
    ...overrides,
  } as Event
}

const host = { id: 'host-1', name: 'Host Name', role: 'faculty' } as unknown as Profile
const other = { id: 'user-2', name: 'Other', role: 'student' } as unknown as Profile

function makeContext(currentUser: Profile | null, deleteEvent: ReturnType<typeof vi.fn>) {
  return {
    rsvpedEventIds: new Set<string>(),
    toggleRsvpEvent: vi.fn(),
    currentUser,
    updateEvent: vi.fn(),
    deleteEvent,
  }
}

beforeEach(() => {
  routerMock.push.mockReset()
  toastMock.success.mockClear()
  toastMock.error.mockClear()
  useCommunityMock.mockReset()
  vi.spyOn(window, 'confirm').mockImplementation(() => true)
})

describe('EventCard delete control', () => {
  it('shows Edit and Delete to the host and deletes after confirmation', async () => {
    const deleteEvent = vi.fn().mockResolvedValue(true)
    useCommunityMock.mockReturnValue(makeContext(host, deleteEvent))

    render(<EventCard event={makeEvent()} />)

    expect(screen.getByRole('button', { name: 'Edit event' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Delete event' }))

    expect(window.confirm).toHaveBeenCalledWith('Delete this event? This cannot be undone.')
    await waitFor(() => expect(deleteEvent).toHaveBeenCalledWith('event-1'))
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith('Event deleted'))
  })

  it('hides both host controls from a non-host', () => {
    const deleteEvent = vi.fn().mockResolvedValue(true)
    useCommunityMock.mockReturnValue(makeContext(other, deleteEvent))

    render(<EventCard event={makeEvent()} />)

    expect(screen.queryByRole('button', { name: 'Delete event' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit event' })).not.toBeInTheDocument()
    expect(deleteEvent).not.toHaveBeenCalled()
  })

  it('does not delete when the confirmation is declined', () => {
    const deleteEvent = vi.fn().mockResolvedValue(true)
    useCommunityMock.mockReturnValue(makeContext(host, deleteEvent))
    ;(window.confirm as ReturnType<typeof vi.spyOn>).mockImplementation(() => false)

    render(<EventCard event={makeEvent()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete event' }))

    expect(deleteEvent).not.toHaveBeenCalled()
  })

  it('ignores a second click while the first delete is in flight', async () => {
    let resolveDelete!: (value: boolean) => void
    const gate = new Promise<boolean>(resolve => {
      resolveDelete = resolve
    })
    const deleteEvent = vi.fn().mockReturnValue(gate)
    useCommunityMock.mockReturnValue(makeContext(host, deleteEvent))

    render(<EventCard event={makeEvent()} />)
    const button = screen.getByRole('button', { name: 'Delete event' })
    fireEvent.click(button)
    await waitFor(() => expect(button).toBeDisabled())
    fireEvent.click(button)

    resolveDelete(true)
    await waitFor(() => expect(deleteEvent).toHaveBeenCalledTimes(1))
  })

  it('keeps the card and does not claim success when the delete fails', async () => {
    const deleteEvent = vi.fn().mockResolvedValue(false)
    useCommunityMock.mockReturnValue(makeContext(host, deleteEvent))

    render(<EventCard event={makeEvent()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete event' }))

    await waitFor(() => expect(deleteEvent).toHaveBeenCalledTimes(1))
    expect(toastMock.success).not.toHaveBeenCalled()
    expect(screen.getByText('Systems workshop')).toBeInTheDocument()
  })

  it('still renders the existing event fields', () => {
    useCommunityMock.mockReturnValue(makeContext(other, vi.fn()))

    render(<EventCard event={makeEvent()} />)

    expect(screen.getByText('Systems workshop')).toBeInTheDocument()
    expect(screen.getByText('A hands-on workshop.')).toBeInTheDocument()
    expect(screen.getByText('Workshop')).toBeInTheDocument()
    expect(screen.getByText('60 min')).toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument()
  })
})

describe('EventCard host alumni identity', () => {
  it('shows the alumni badge for a persisted alumni host', () => {
    useCommunityMock.mockReturnValue(makeContext(other, vi.fn()))

    render(<EventCard event={makeEvent({
      host_member_type: 'alumni',
      host_graduation_year: 2024,
    })} />)

    expect(screen.getByText("Alumni '24")).toBeInTheDocument()
  })

  it('does not tag a student host who merely has a graduation year', () => {
    useCommunityMock.mockReturnValue(makeContext(other, vi.fn()))

    render(<EventCard event={makeEvent({
      host_member_type: 'student',
      host_graduation_year: 2028,
    })} />)

    expect(screen.queryByText(/^Alumni/)).not.toBeInTheDocument()
  })

  it('never tags faculty as alumni, even if the row carries a stale alumni value', () => {
    useCommunityMock.mockReturnValue(makeContext(other, vi.fn()))

    render(<EventCard event={makeEvent({
      host_role: 'faculty',
      host_member_type: 'alumni',
      host_graduation_year: 2018,
    })} />)

    expect(screen.queryByText(/^Alumni/)).not.toBeInTheDocument()
  })
})
