import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import ProfileModal from './ProfileModal'
import { Profile } from '@/lib/types'

const useCommunityMock = vi.hoisted(() => vi.fn())

vi.mock('@/contexts/CommunityContext', () => ({
  useCommunity: (props?: unknown) => useCommunityMock(props),
}))
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({}),
}))
vi.mock('@/lib/imageProcessing', () => ({
  compressAndTokenize: vi.fn(),
}))
vi.mock('@/lib/r2Upload', () => ({
  uploadToR2: vi.fn(),
}))

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: 'self-1',
    usn: '4UB24CS001',
    name: 'Alice',
    year: 3,
    branch: 'CSE',
    section: null,
    bio: 'Hello',
    avatar_url: null,
    skills: [],
    interests: [],
    role: 'student',
    faculty_status: 'none',
    designation: null,
    employee_id: null,
    expertise: [],
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeContext(overrides: Record<string, unknown> = {}) {
  return {
    isProfileModalOpen: true,
    setIsProfileModalOpen: vi.fn(),
    selectedProfileForView: null,
    currentUser: makeProfile(),
    updateProfile: vi.fn(),
    ...overrides,
  }
}

function flushTurns() {
  return act(() => new Promise(resolve => setTimeout(resolve, 0)))
}

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) =>
    setTimeout(() => cb(performance.now()), 0),
  )
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
  useCommunityMock.mockReset()
})

describe('ProfileModal link fields', () => {
  it('does not offer profile editing when viewing another member', async () => {
    const other = makeProfile({ id: 'other-2', name: 'Bob' })
    useCommunityMock.mockReturnValue(
      makeContext({ currentUser: makeProfile(), selectedProfileForView: other }),
    )

    render(<ProfileModal />)
    await flushTurns()

    expect(screen.queryByRole('button', { name: /Edit profile/i })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('GitHub URL')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('LinkedIn URL')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Portfolio URL')).not.toBeInTheDocument()
  })

  it('normalizes and saves the member’s own public links', async () => {
    const context = makeContext()
    useCommunityMock.mockReturnValue(context)

    render(<ProfileModal />)
    await flushTurns()

    fireEvent.click(screen.getByRole('button', { name: /Edit profile/i }))
    fireEvent.change(screen.getByLabelText('Portfolio URL'), { target: { value: 'me.dev' } })
    fireEvent.change(screen.getByLabelText('GitHub URL'), { target: { value: 'github.com/alice' } })
    fireEvent.change(screen.getByLabelText('LinkedIn URL'), {
      target: { value: 'linkedin.com/in/alice' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(context.updateProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        portfolio_url: 'https://me.dev',
        github_url: 'https://github.com/alice',
        linkedin_url: 'https://linkedin.com/in/alice',
      }),
    )
  })

  it('blocks saving an unsafe portfolio scheme and shows a field error', async () => {
    const context = makeContext()
    useCommunityMock.mockReturnValue(context)

    render(<ProfileModal />)
    await flushTurns()

    fireEvent.click(screen.getByRole('button', { name: /Edit profile/i }))
    const portfolio = screen.getByLabelText('Portfolio URL')
    fireEvent.change(portfolio, { target: { value: 'javascript:alert(1)' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(context.updateProfile).not.toHaveBeenCalled()
    expect(screen.getByText(/valid portfolio URL/i)).toBeInTheDocument()
    expect(portfolio).toHaveAttribute('aria-invalid', 'true')
  })

  it('blocks saving a malformed GitHub URL', async () => {
    const context = makeContext()
    useCommunityMock.mockReturnValue(context)

    render(<ProfileModal />)
    await flushTurns()

    fireEvent.click(screen.getByRole('button', { name: /Edit profile/i }))
    fireEvent.change(screen.getByLabelText('GitHub URL'), {
      target: { value: 'https://gitlab.com/alice' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(context.updateProfile).not.toHaveBeenCalled()
    expect(screen.getByText(/valid GitHub URL/i)).toBeInTheDocument()
  })

  it('shows existing links as safe anchors in view mode', async () => {
    useCommunityMock.mockReturnValue(
      makeContext({
        currentUser: makeProfile({
          github_url: 'https://github.com/alice',
          linkedin_url: 'https://linkedin.com/in/alice',
          portfolio_url: 'https://me.dev',
        }),
      }),
    )

    render(<ProfileModal />)
    await flushTurns()

    const github = screen.getByRole('link', { name: 'GitHub (opens in a new tab)' })
    expect(github).toHaveAttribute('href', 'https://github.com/alice')
    expect(github).toHaveAttribute('target', '_blank')
    expect(github).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('does not render unsafe legacy link values', async () => {
    useCommunityMock.mockReturnValue(
      makeContext({
        currentUser: makeProfile({
          portfolio_url: 'javascript:alert(1)',
          github_url: 'data:text/html,boom',
        }),
      }),
    )

    render(<ProfileModal />)
    await flushTurns()

    expect(screen.queryByRole('link', { name: /Portfolio/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /GitHub/ })).not.toBeInTheDocument()
  })
})
