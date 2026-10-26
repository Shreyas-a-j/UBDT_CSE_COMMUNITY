import { beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import FacultyDashboardPage from './page'

/**
 * Dashboard regressions:
 *  - "New event" opens the same composer as the feed.
 *  - A deleted (or already-gone) announcement disappears from this page's own
 *    state immediately, even when the follow-up refresh fails. The dashboard
 *    keeps a host-scoped list separate from CommunityContext, so it must not
 *    rely only on a refetch to hide a deleted row's Delete button.
 *  - A failed delete leaves the row and reports the error.
 *  - Focus / pageshow refresh catches deletions made elsewhere.
 */

const announcementRow = {
  id: 'ann-1',
  title: 'To delete',
  body: 'Body',
  author_id: 'faculty-1',
  image_urls: [] as string[],
  created_at: '2026-10-20T09:00:00.000Z',
  updated_at: '2026-10-20T09:00:00.000Z',
}

const mocks = vi.hoisted(() => ({
  openCreateEvent: vi.fn(),
  deleteAnnouncement: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  announcements: [] as Array<Record<string, unknown>>,
  events: [] as Array<Record<string, unknown>>,
  announcementError: null as null | { message: string },
  profile: {
    id: 'faculty-1',
    name: 'Dr Rao',
    usn: null,
    email: 'rao@example.edu',
    role: 'faculty',
    faculty_status: 'verified',
  },
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}))

vi.mock('@/lib/supabase/client', () => {
  const makeChain = (table: string) => {
    const chain: Record<string, unknown> = {}
    chain.select = () => chain
    chain.eq = () => chain
    chain.order = () => chain
    chain.limit = () =>
      Promise.resolve(
        table === 'announcements'
          ? {
              data: mocks.announcementError ? null : mocks.announcements,
              error: mocks.announcementError,
            }
          : { data: mocks.events, error: null }
      )
    return chain
  }
  return {
    createClient: () => ({
      from: (table: string) => makeChain(table),
    }),
  }
})

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ profile: mocks.profile }),
}))

vi.mock('@/contexts/CommunityContext', () => ({
  useCommunity: () => ({
    openCreateEvent: mocks.openCreateEvent,
    deleteAnnouncement: mocks.deleteAnnouncement,
  }),
}))

vi.mock('@/components/AppShell', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/components/CommunityActivityExport', () => ({
  default: () => null,
}))

vi.mock('react-hot-toast', () => ({
  default: { success: mocks.toastSuccess, error: mocks.toastError },
}))

beforeEach(() => {
  mocks.openCreateEvent.mockReset()
  mocks.deleteAnnouncement.mockReset()
  mocks.deleteAnnouncement.mockResolvedValue({ ok: true })
  mocks.toastSuccess.mockClear()
  mocks.toastError.mockClear()
  mocks.announcements = [{ ...announcementRow }]
  mocks.events = []
  mocks.announcementError = null
  vi.spyOn(window, 'confirm').mockImplementation(() => true)
})

describe('faculty dashboard event action', () => {
  it('opens the same event composer as the community feed', () => {
    render(<FacultyDashboardPage />)

    fireEvent.click(screen.getByRole('button', { name: /New event/i }))

    expect(mocks.openCreateEvent).toHaveBeenCalledTimes(1)
  })
})

describe('faculty dashboard announcement deletion', () => {
  it('removes the row immediately even when the refresh afterwards fails', async () => {
    mocks.deleteAnnouncement.mockImplementation(async () => {
      // The delete succeeded, but the follow-up read does not.
      mocks.announcementError = { message: 'refresh failed' }
      return { ok: true }
    })

    render(<FacultyDashboardPage />)
    expect(await screen.findByText('To delete')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Delete/i }))

    await waitFor(() => expect(screen.queryByText('To delete')).not.toBeInTheDocument())
    expect(mocks.deleteAnnouncement).toHaveBeenCalledWith('ann-1')
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Announcement deleted')
  })

  it('removes an already-deleted announcement from local state', async () => {
    mocks.deleteAnnouncement.mockResolvedValue({ ok: true, alreadyGone: true })

    render(<FacultyDashboardPage />)
    expect(await screen.findByText('To delete')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Delete/i }))

    await waitFor(() => expect(screen.queryByText('To delete')).not.toBeInTheDocument())
    expect(mocks.toastSuccess).toHaveBeenCalledWith('The announcement was already gone.')
  })

  it('keeps the row and reports the error when the delete is rejected', async () => {
    mocks.deleteAnnouncement.mockResolvedValue({ ok: false, error: 'Not allowed.' })

    render(<FacultyDashboardPage />)
    expect(await screen.findByText('To delete')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Delete/i }))

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('Not allowed.'))
    expect(screen.getByText('To delete')).toBeInTheDocument()
  })

  it('refreshes on focus so a deletion made elsewhere disappears', async () => {
    render(<FacultyDashboardPage />)
    expect(await screen.findByText('To delete')).toBeInTheDocument()

    mocks.announcements = []
    window.dispatchEvent(new Event('focus'))

    await waitFor(() => expect(screen.queryByText('To delete')).not.toBeInTheDocument())
  })

  it('refreshes on pageshow (bfcache return) as well', async () => {
    render(<FacultyDashboardPage />)
    expect(await screen.findByText('To delete')).toBeInTheDocument()

    mocks.announcements = []
    window.dispatchEvent(new Event('pageshow'))

    await waitFor(() => expect(screen.queryByText('To delete')).not.toBeInTheDocument())
  })
})
