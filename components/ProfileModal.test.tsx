import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import ProfileModal from './ProfileModal'
import { Profile } from '@/lib/types'

const useCommunityMock = vi.hoisted(() => vi.fn())
const supabaseMock = vi.hoisted(() => ({ from: vi.fn() }))

vi.mock('@/contexts/CommunityContext', () => ({
  useCommunity: (props?: unknown) => useCommunityMock(props),
}))
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => supabaseMock,
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
    linkStudentUsn: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  }
}

function mockAdmissionQuery(result: { data: unknown; error: unknown }) {
  const maybeSingle = vi.fn().mockResolvedValue(result)
  const eq = vi.fn(() => ({ maybeSingle }))
  const select = vi.fn(() => ({ eq }))
  supabaseMock.from.mockReturnValue({ select })
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
  supabaseMock.from.mockReset()
  mockAdmissionQuery({ data: null, error: null })
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

describe('ProfileModal academic year', () => {
  it('shows the year select to students and saves the chosen year', async () => {
    const context = makeContext({
      currentUser: makeProfile({ member_type: 'student', year: 2 }),
    })
    useCommunityMock.mockReturnValue(context)

    render(<ProfileModal />)
    await flushTurns()
    fireEvent.click(screen.getByRole('button', { name: /Edit profile/i }))

    const select = screen.getByLabelText('Academic year')
    expect(select).toHaveValue('2')
    fireEvent.change(select, { target: { value: '4' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(context.updateProfile).toHaveBeenCalledWith(
      expect.objectContaining({ year: 4 }),
    )
  })

  it('rejects a missing student year without saving', async () => {
    const context = makeContext({
      currentUser: makeProfile({ member_type: 'student', year: null }),
    })
    useCommunityMock.mockReturnValue(context)

    render(<ProfileModal />)
    await flushTurns()
    fireEvent.click(screen.getByRole('button', { name: /Edit profile/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(screen.getByText('Select a valid academic year.')).toBeInTheDocument()
    expect(context.updateProfile).not.toHaveBeenCalled()
  })

  it('keeps alumni graduation year separate and hides the student select', async () => {
    const context = makeContext({
      currentUser: makeProfile({
        member_type: 'alumni',
        role: 'student',
        year: null,
        usn: null,
        graduation_year: 2024,
      }),
    })
    useCommunityMock.mockReturnValue(context)

    render(<ProfileModal />)
    await flushTurns()

    expect(screen.getByText(/Class of 2024/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Edit profile/i }))
    expect(screen.queryByLabelText('Academic year')).not.toBeInTheDocument()
  })

  it('hides the student select from faculty', async () => {
    const context = makeContext({
      currentUser: makeProfile({
        member_type: 'faculty',
        role: 'faculty',
        faculty_status: 'approved',
        year: null,
        usn: null,
      }),
    })
    useCommunityMock.mockReturnValue(context)

    render(<ProfileModal />)
    await flushTurns()
    fireEvent.click(screen.getByRole('button', { name: /Edit profile/i }))

    expect(screen.queryByLabelText('Academic year')).not.toBeInTheDocument()
  })
})

describe('ProfileModal USN linking and admission number', () => {
  it('offers the one-time USN field to a student without a USN', async () => {
    useCommunityMock.mockReturnValue(
      makeContext({ currentUser: makeProfile({ member_type: 'student', usn: null }) }),
    )

    render(<ProfileModal />)
    await flushTurns()
    fireEvent.click(screen.getByRole('button', { name: /Edit profile/i }))

    expect(screen.getByLabelText('Add your USN')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Link' })).toBeInTheDocument()
  })

  it('shows an existing USN read-only and no link control', async () => {
    useCommunityMock.mockReturnValue(
      makeContext({ currentUser: makeProfile({ member_type: 'student', usn: '4UB24CS045' }) }),
    )

    render(<ProfileModal />)
    await flushTurns()
    fireEvent.click(screen.getByRole('button', { name: /Edit profile/i }))

    expect(screen.getByLabelText('USN')).toHaveValue('4UB24CS045')
    expect(screen.getByLabelText('USN')).toHaveAttribute('readonly')
    expect(screen.queryByLabelText('Add your USN')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Link' })).not.toBeInTheDocument()
  })

  it('does not offer USN linking to alumni or faculty', async () => {
    useCommunityMock.mockReturnValue(
      makeContext({
        currentUser: makeProfile({
          member_type: 'alumni',
          role: 'student',
          usn: null,
          year: null,
          graduation_year: 2024,
        }),
      }),
    )

    const { unmount } = render(<ProfileModal />)
    await flushTurns()
    fireEvent.click(screen.getByRole('button', { name: /Edit profile/i }))
    expect(screen.queryByLabelText('Add your USN')).not.toBeInTheDocument()
    unmount()

    useCommunityMock.mockReturnValue(
      makeContext({
        currentUser: makeProfile({
          member_type: 'faculty',
          role: 'faculty',
          faculty_status: 'approved',
          usn: null,
          year: null,
        }),
      }),
    )
    render(<ProfileModal />)
    await flushTurns()
    fireEvent.click(screen.getByRole('button', { name: /Edit profile/i }))
    expect(screen.queryByLabelText('Add your USN')).not.toBeInTheDocument()
  })

  it('links a USN once and clears the field after success', async () => {
    const linkStudentUsn = vi.fn().mockResolvedValue({ ok: true })
    useCommunityMock.mockReturnValue(
      makeContext({
        currentUser: makeProfile({ member_type: 'student', usn: null }),
        linkStudentUsn,
      }),
    )

    render(<ProfileModal />)
    await flushTurns()
    fireEvent.click(screen.getByRole('button', { name: /Edit profile/i }))
    const field = screen.getByLabelText('Add your USN')
    fireEvent.change(field, { target: { value: '4ub24cs045' } })
    fireEvent.click(screen.getByRole('button', { name: 'Link' }))
    await flushTurns()

    expect(linkStudentUsn).toHaveBeenCalledWith('4UB24CS045')
    expect(field).toHaveValue('')
  })

  it('shows the admission number on file only to the owner when a row exists', async () => {
    mockAdmissionQuery({ data: { admission_number: 'ADM-2026-001' }, error: null })
    useCommunityMock.mockReturnValue(
      makeContext({ currentUser: makeProfile({ member_type: 'student', usn: null }) }),
    )

    const { unmount } = render(<ProfileModal />)
    await flushTurns()
    expect(screen.getByText('Admission number on file')).toBeInTheDocument()
    expect(screen.getByText('ADM-2026-001')).toBeInTheDocument()
    unmount()

    const other = makeProfile({ id: 'other-2', name: 'Bob', member_type: 'student' })
    useCommunityMock.mockReturnValue(
      makeContext({ selectedProfileForView: other, currentUser: makeProfile() }),
    )
    render(<ProfileModal />)
    await flushTurns()
    expect(screen.queryByText('Admission number on file')).not.toBeInTheDocument()
    expect(screen.queryByText('ADM-2026-001')).not.toBeInTheDocument()
  })

  it('hides the admission row when the migration is not applied', async () => {
    mockAdmissionQuery({ data: null, error: { code: '42P01', message: 'does not exist' } })
    useCommunityMock.mockReturnValue(
      makeContext({ currentUser: makeProfile({ member_type: 'student', usn: null }) }),
    )

    render(<ProfileModal />)
    await flushTurns()

    expect(screen.queryByText('Admission number on file')).not.toBeInTheDocument()
  })
})
