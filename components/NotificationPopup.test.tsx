import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

import NotificationPopup from './NotificationPopup'
import type { Notification } from '@/lib/types'

const mocks = vi.hoisted(() => ({
  currentUser: { id: 'user-1' } as { id: string } | null,
  notifications: [] as Array<{
    id: string
    user_id: string
    type: string
    title: string
    body: string | null
    link: string | null
    read: boolean
    created_at: string
  }>,
  notificationsLoaded: true,
  markNotificationAsRead: vi.fn(),
  push: vi.fn(),
}))

vi.mock('@/contexts/CommunityContext', () => ({
  useCommunity: () => ({
    currentUser: mocks.currentUser,
    notifications: mocks.notifications as Notification[],
    notificationsLoaded: mocks.notificationsLoaded,
    markNotificationAsRead: mocks.markNotificationAsRead,
  }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
}))

function notification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: 'n1',
    user_id: 'user-1',
    type: 'comment',
    title: 'New reply',
    body: 'Someone replied to your discussion.',
    link: '/post/abc',
    read: false,
    created_at: '2026-10-25T10:00:00.000Z',
    ...overrides,
  }
}

function visible() {
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

beforeEach(() => {
  mocks.currentUser = { id: 'user-1' }
  mocks.notifications = []
  mocks.notificationsLoaded = true
  mocks.markNotificationAsRead.mockReset()
  mocks.push.mockReset()
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: 'visible',
  })
})

describe('NotificationPopup', () => {
  it('shows only the newest eligible unread notification', async () => {
    mocks.notifications = [
      notification({ id: 'older', title: 'Older reply', created_at: '2026-10-25T09:00:00.000Z' }),
      notification({ id: 'newest', title: 'Newest reply', created_at: '2026-10-25T12:00:00.000Z' }),
      notification({
        id: 'read',
        title: 'Already read',
        read: true,
        created_at: '2026-10-25T13:00:00.000Z',
      }),
      notification({
        id: 'hidden',
        title: 'Hidden message',
        type: 'message',
        created_at: '2026-10-25T14:00:00.000Z',
      }),
    ]

    render(<NotificationPopup />)

    expect(await screen.findByText('Newest reply')).toBeInTheDocument()
    expect(screen.queryByText('Older reply')).not.toBeInTheDocument()
    expect(screen.queryByText('Already read')).not.toBeInTheDocument()
    expect(screen.queryByText('Hidden message')).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'View' })).toHaveLength(1)
  })

  it('waits for the notification list to load before consuming the launch check', async () => {
    mocks.notificationsLoaded = false
    mocks.notifications = [notification({ id: 'later', title: 'Arrives later' })]

    const { rerender } = render(<NotificationPopup />)
    expect(screen.queryByText('Arrives later')).not.toBeInTheDocument()

    mocks.notificationsLoaded = true
    rerender(<NotificationPopup />)

    expect(await screen.findByText('Arrives later')).toBeInTheDocument()
  })

  it('renders nothing for a loaded but empty list', () => {
    render(<NotificationPopup />)

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('dismisses without marking read and suppresses the same row on the next foreground', async () => {
    mocks.notifications = [notification({ id: 'n1', title: 'Dismiss me' })]
    const { rerender } = render(<NotificationPopup />)

    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss' }))

    expect(mocks.markNotificationAsRead).not.toHaveBeenCalled()
    expect(screen.queryByText('Dismiss me')).not.toBeInTheDocument()

    visible()
    await waitFor(() => expect(screen.queryByText('Dismiss me')).not.toBeInTheDocument())

    mocks.notifications = [
      notification({ id: 'n2', title: 'A newer row', created_at: '2026-10-25T11:00:00.000Z' }),
      ...mocks.notifications,
    ]
    rerender(<NotificationPopup />)
    expect(screen.queryByText('A newer row')).not.toBeInTheDocument()

    visible()
    expect(await screen.findByText('A newer row')).toBeInTheDocument()
  })

  it('marks read once and navigates to a safe internal link on View', async () => {
    mocks.notifications = [notification({ id: 'n1', title: 'Open me', link: '/post/abc' })]
    render(<NotificationPopup />)

    fireEvent.click(await screen.findByRole('button', { name: 'View' }))

    expect(mocks.markNotificationAsRead).toHaveBeenCalledTimes(1)
    expect(mocks.markNotificationAsRead).toHaveBeenCalledWith('n1')
    expect(mocks.push).toHaveBeenCalledWith('/post/abc')
    expect(screen.queryByText('Open me')).not.toBeInTheDocument()
  })

  it('falls back to home when the link is unsafe', async () => {
    mocks.notifications = [
      notification({ id: 'n1', title: 'Unsafe link', link: 'https://evil.example/post' }),
    ]
    render(<NotificationPopup />)

    fireEvent.click(await screen.findByRole('button', { name: 'View' }))

    expect(mocks.push).toHaveBeenCalledWith('/')
  })

  it('does not open a popup for a realtime insert while the user is active', async () => {
    const { rerender } = render(<NotificationPopup />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    mocks.notifications = [notification({ id: 'live', title: 'Live insert' })]
    rerender(<NotificationPopup />)
    expect(screen.queryByText('Live insert')).not.toBeInTheDocument()

    visible()
    expect(await screen.findByText('Live insert')).toBeInTheDocument()
  })

  it('closes a candidate that was marked read elsewhere without marking it again', async () => {
    mocks.notifications = [notification({ id: 'n1', title: 'Read elsewhere' })]
    const { rerender } = render(<NotificationPopup />)

    expect(await screen.findByText('Read elsewhere')).toBeInTheDocument()

    mocks.notifications = [notification({ id: 'n1', title: 'Read elsewhere', read: true })]
    rerender(<NotificationPopup />)

    await waitFor(() => expect(screen.queryByText('Read elsewhere')).not.toBeInTheDocument())
    expect(mocks.markNotificationAsRead).not.toHaveBeenCalled()
  })

  it('clears the seen set on sign-out so the next account can see its own row', async () => {
    mocks.notifications = [notification({ id: 'n1', title: 'Account one' })]
    const { rerender } = render(<NotificationPopup />)

    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss' }))

    mocks.currentUser = null
    rerender(<NotificationPopup />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    mocks.currentUser = { id: 'user-2' }
    mocks.notifications = [notification({ id: 'n1', title: 'Account one', user_id: 'user-2' })]
    rerender(<NotificationPopup />)

    expect(await screen.findByText('Account one')).toBeInTheDocument()
  })
})
