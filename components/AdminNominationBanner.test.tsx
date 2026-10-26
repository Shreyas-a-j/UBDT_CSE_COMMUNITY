import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import AdminNominationBanner from './AdminNominationBanner'

const mocks = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  profile: { id: 'fac-1', name: 'Dr Rao', role: 'faculty' },
  refreshProfile: vi.fn(async () => {}),
  nomination: null as null | Record<string, unknown>,
  rpcError: null as null | { message: string },
  rpc: vi.fn(),
}))

function builder() {
  const result = { data: mocks.nomination, error: null }
  const chain: Record<string, unknown> = {}
  for (const method of ['select', 'eq']) chain[method] = vi.fn(() => chain)
  chain.maybeSingle = vi.fn(async () => result)
  chain.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
  return chain
}

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => builder(),
    rpc: (...args: unknown[]) => mocks.rpc(...args),
  }),
}))

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    profile: mocks.profile,
    refreshProfile: mocks.refreshProfile,
  }),
}))

vi.mock('react-hot-toast', () => ({
  default: { success: mocks.toastSuccess, error: vi.fn() },
}))

const nomination = {
  id: 'nom-1',
  nominated_by: 'admin-1',
  nominee_id: 'fac-1',
  status: 'pending',
  note: 'Please take over next term.',
  created_at: '2026-10-20T09:00:00.000Z',
  nominator: { name: 'Admin' },
}

beforeEach(() => {
  mocks.nomination = nomination
  mocks.rpc.mockReset()
  mocks.rpc.mockResolvedValue({ error: null })
  mocks.refreshProfile.mockClear()
  mocks.toastSuccess.mockClear()
  vi.spyOn(window, 'confirm').mockImplementation(() => true)
})

describe('AdminNominationBanner', () => {
  it('renders nothing without a pending nomination', async () => {
    mocks.nomination = null

    const { container } = render(<AdminNominationBanner />)
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it('accepts only after confirmation and refreshes the profile', async () => {
    render(<AdminNominationBanner />)

    expect(await screen.findByText(/nominated you as administrator/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))

    expect(window.confirm).toHaveBeenCalledWith(
      'Accept the administrator nomination? You will become the only administrator.'
    )
    await waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith('accept_admin_nomination', { p_id: 'nom-1' })
    )
    await waitFor(() => expect(mocks.refreshProfile).toHaveBeenCalledTimes(1))
    expect(mocks.toastSuccess).toHaveBeenCalledWith('You are now the administrator')
  })

  it('declines only after confirmation and keeps the current admin', async () => {
    render(<AdminNominationBanner />)

    fireEvent.click(await screen.findByRole('button', { name: 'Decline' }))

    expect(window.confirm).toHaveBeenCalledWith(
      'Decline this nomination? The current administrator stays in place.'
    )
    await waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith('decline_admin_nomination', { p_id: 'nom-1' })
    )
    await waitFor(() => expect(mocks.refreshProfile).toHaveBeenCalledTimes(1))
  })

  it('does not call the RPC when confirmation is declined', async () => {
    vi.spyOn(window, 'confirm').mockImplementation(() => false)

    render(<AdminNominationBanner />)

    fireEvent.click(await screen.findByRole('button', { name: 'Accept' }))

    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.refreshProfile).not.toHaveBeenCalled()
  })

  it('keeps the banner and shows the RPC error verbatim', async () => {
    mocks.rpc.mockResolvedValue({ error: { message: 'This nomination is no longer pending.' } })

    render(<AdminNominationBanner />)

    fireEvent.click(await screen.findByRole('button', { name: 'Accept' }))

    expect(await screen.findByText('This nomination is no longer pending.')).toBeInTheDocument()
    expect(screen.getByText(/nominated you as administrator/i)).toBeInTheDocument()
    expect(mocks.refreshProfile).not.toHaveBeenCalled()
  })
})
