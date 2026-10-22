import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import FacultyDashboardPage from './page'

/**
 * Navigation regression: the dashboard's "New event" action used to stop at
 * a "coming soon" toast while the feed's "Host event" action opened the real
 * CreateEventModal. Both entry points must invoke the same context action so
 * there is exactly one event-hosting form.
 */

const mocks = vi.hoisted(() => ({
  openCreateEvent: vi.fn(),
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
  const result = { data: [], error: null }
  const chain: Record<string, unknown> = {}
  chain.select = () => chain
  chain.eq = () => chain
  chain.order = () => chain
  chain.limit = () => Promise.resolve(result)
  return { createClient: () => ({ from: () => chain }) }
})

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ profile: mocks.profile }),
}))

vi.mock('@/contexts/CommunityContext', () => ({
  useCommunity: () => ({ openCreateEvent: mocks.openCreateEvent }),
}))

vi.mock('@/components/AppShell', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/components/CommunityActivityExport', () => ({
  default: () => null,
}))

describe('faculty dashboard event action', () => {
  it('opens the same event composer as the community feed', () => {
    render(<FacultyDashboardPage />)

    fireEvent.click(screen.getByRole('button', { name: /New event/i }))

    expect(mocks.openCreateEvent).toHaveBeenCalledTimes(1)
  })
})
