import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import AdminPage from './page'

/**
 * Regression: the admin page used to send `approved` / `rejected`, while the
 * database RPC accepts the imperative `approve` / `reject`. Both buttons hit
 * the shared handler, so both failed with the same validation error.
 */

const mocks = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  profile: {
    id: 'admin-1',
    name: 'Admin',
    usn: null,
    email: 'admin@example.test',
    role: 'admin',
    faculty_status: 'none',
  },
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}))

vi.mock('@/lib/supabase/client', () => {
  const channel = {
    on: () => channel,
    subscribe: () => channel,
  }
  return {
    createClient: () => ({
      channel: () => channel,
      removeChannel: vi.fn(),
    }),
  }
})

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ profile: mocks.profile, loading: false }),
}))

vi.mock('@/components/AppShell', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/components/CommunityActivityExport', () => ({
  default: () => null,
}))

vi.mock('react-hot-toast', () => ({
  default: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
}))

interface Row {
  id: string
  user_id: string
  full_name: string
  official_email: string
  department: string
  designation: string
  employee_id: string | null
  status: 'pending' | 'approved' | 'rejected'
  reviewed_by: string | null
  reviewed_at: string | null
  review_notes: string | null
  created_at: string
  updated_at: string | null
}

const rows: Row[] = [
  {
    id: 'app-approve',
    user_id: 'u1',
    full_name: 'Applicant One',
    official_email: 'one@example.test',
    department: 'CSE',
    designation: 'Professor',
    employee_id: null,
    status: 'pending',
    reviewed_by: null,
    reviewed_at: null,
    review_notes: null,
    created_at: '2026-10-20T00:00:00.000Z',
    updated_at: null,
  },
  {
    id: 'app-reject',
    user_id: 'u2',
    full_name: 'Applicant Two',
    official_email: 'two@example.test',
    department: 'CSE',
    designation: 'Assistant Professor',
    employee_id: null,
    status: 'pending',
    reviewed_by: null,
    reviewed_at: null,
    review_notes: null,
    created_at: '2026-10-20T00:00:00.000Z',
    updated_at: null,
  },
]

let posts: Array<{ url: string; body: { decision: string; notes?: string } }> = []

function applicationsResponse() {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      applications: rows,
      profiles: [],
      emailVerified: {},
      emailVerificationError: null,
    }),
  } as Response
}

function installFetch() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)

    if (!init || init.method !== 'POST') {
      return applicationsResponse()
    }

    const body = JSON.parse(String(init.body)) as { decision: string; notes?: string }
    posts.push({ url, body })
    const row = rows.find(candidate => url.endsWith(candidate.id))
    if (!row) {
      return { ok: false, status: 404, json: async () => ({ error: 'Application not found.' }) } as Response
    }

    row.status = body.decision === 'approve' ? 'approved' : 'rejected'
    row.review_notes = body.decision === 'reject' ? body.notes ?? null : null
    return {
      ok: true,
      status: 200,
      json: async () => ({
        outcome: body.decision === 'approve' ? 'approved' : 'rejected',
        status: row.status,
        application: row,
      }),
    } as Response
  })

  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  rows[0].status = 'pending'
  rows[1].status = 'pending'
  rows[0].review_notes = null
  rows[1].review_notes = null
  posts = []
  mocks.toastSuccess.mockClear()
  mocks.toastError.mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('admin faculty review buttons', () => {
  it('sends approve for one pending application and reject for another', async () => {
    installFetch()
    render(<AdminPage />)

    const first = (await screen.findByText('Applicant One')).closest('li')
    const second = (await screen.findByText('Applicant Two')).closest('li')
    expect(first).not.toBeNull()
    expect(second).not.toBeNull()

    fireEvent.click(within(first as HTMLElement).getByRole('button', { name: /Approve/i }))
    await waitFor(() => expect(posts).toHaveLength(1))

    fireEvent.click(within(second as HTMLElement).getByRole('button', { name: /Reject/i }))
    await waitFor(() => expect(posts).toHaveLength(2))

    expect(posts[0].body).toMatchObject({ decision: 'approve' })
    expect(posts[1].body).toMatchObject({ decision: 'reject' })
    expect(posts[0].body.decision).not.toBe('approved')
    expect(posts[1].body.decision).not.toBe('rejected')

    expect(rows[0].status).toBe('approved')
    expect(rows[1].status).toBe('rejected')
    expect(rows[1].review_notes).toBe('Application not approved')
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('disables both action buttons while a review request is in progress', async () => {
    let resolvePost!: (value: Response) => void
    const pendingPost = new Promise<Response>(resolve => {
      resolvePost = resolve
    })

    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (!init || init.method !== 'POST') return applicationsResponse()
        return pendingPost
      }),
    )

    render(<AdminPage />)

    const row = (await screen.findByText('Applicant One')).closest('li') as HTMLElement
    const approve = within(row).getByRole('button', { name: /Approve/i })
    const reject = within(row).getByRole('button', { name: /Reject/i })

    fireEvent.click(approve)

    await waitFor(() => {
      expect(approve).toBeDisabled()
      expect(reject).toBeDisabled()
    })

    rows[0].status = 'approved'
    resolvePost({
      ok: true,
      status: 200,
      json: async () => ({ status: 'approved', application_id: rows[0].id }),
    } as Response)

    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalled())
  })

  it('shows the API error and leaves the row retryable when the review is not confirmed', async () => {
    const errorMessage =
      'The review result could not be confirmed. The application is still pending. You can retry.'

    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (!init || init.method !== 'POST') return applicationsResponse()
        return {
          ok: false,
          status: 502,
          json: async () => ({ error: errorMessage, status: 'pending' }),
        } as Response
      }),
    )

    render(<AdminPage />)

    const row = (await screen.findByText('Applicant One')).closest('li') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: /Approve/i }))

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith(errorMessage))

    expect(rows[0].status).toBe('pending')
    await waitFor(() =>
      expect(within(row).getByRole('button', { name: /Approve/i })).not.toBeDisabled(),
    )
  })
})
