import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import AdminHandover from './AdminHandover'

const mocks = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  profile: { id: 'admin-1', name: 'Admin', role: 'admin' },
  rpcError: null as null | { message: string },
  nominees: [
    { id: 'fac-1', name: 'Dr Rao', usn: null, designation: 'Professor', avatar_url: null },
    { id: 'fac-2', name: 'Dr Iyer', usn: null, designation: 'Assistant Professor', avatar_url: null },
  ] as Record<string, unknown>[],
  pending: null as null | Record<string, unknown>,
  audit: [
    {
      id: 'audit-1',
      action: 'nomination_created',
      actor_name: 'Admin',
      target_name: 'Dr Rao',
      outcome: 'pending',
      detail: 'Handover requested',
      created_at: '2026-10-20T09:00:00.000Z',
    },
  ] as Record<string, unknown>[],
  rpc: vi.fn(),
  neq: vi.fn(),
  eqCalls: [] as Array<{ table: string; args: unknown[] }>,
}))

function makeBuilder(result: { data: unknown; error: unknown }, table = '') {
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'in', 'neq', 'order', 'limit']) {
    builder[method] = vi.fn(() => builder)
  }
  builder.eq = vi.fn((...args: unknown[]) => {
    mocks.eqCalls.push({ table, args })
    return builder
  })
  builder.neq = vi.fn((...args: unknown[]) => {
    mocks.neq(...args)
    return builder
  })
  builder.maybeSingle = vi.fn(async () => result)
  builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
  return builder
}

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table === 'profiles') return makeBuilder({ data: mocks.nominees, error: null }, table)
      if (table === 'admin_nominations') return makeBuilder({ data: mocks.pending, error: null }, table)
      if (table === 'admin_audit_log') return makeBuilder({ data: mocks.audit, error: null }, table)
      throw new Error(`Unexpected table ${table}`)
    },
    rpc: (...args: unknown[]) => mocks.rpc(...args),
  }),
}))

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ profile: mocks.profile }),
}))

vi.mock('react-hot-toast', () => ({
  default: { success: mocks.toastSuccess, error: mocks.toastError },
}))

beforeEach(() => {
  mocks.rpc.mockReset()
  mocks.rpc.mockResolvedValue({ error: null })
  mocks.rpcError = null
  mocks.pending = null
  mocks.nominees = [
    { id: 'fac-1', name: 'Dr Rao', usn: null, designation: 'Professor', avatar_url: null },
    { id: 'fac-2', name: 'Dr Iyer', usn: null, designation: 'Assistant Professor', avatar_url: null },
  ]
  mocks.neq.mockClear()
  mocks.eqCalls = []
  mocks.toastSuccess.mockClear()
  mocks.toastError.mockClear()
  vi.spyOn(window, 'confirm').mockImplementation(() => true)
})

describe('AdminHandover', () => {
  it('loads eligible nominees and excludes the current administrator', async () => {
    render(<AdminHandover />)

    expect(await screen.findByText('Dr Rao — Professor')).toBeInTheDocument()
    expect(screen.getByText('Dr Iyer — Assistant Professor')).toBeInTheDocument()
    expect(mocks.neq).toHaveBeenCalledWith('id', 'admin-1')
    expect(screen.getByText(/operator recovery is required/i)).toBeInTheDocument()
  })

  it('does not filter nominees by member_type', async () => {
    render(<AdminHandover />)

    await screen.findByLabelText('Eligible nominee')
    const profileFilters = mocks.eqCalls
      .filter(call => call.table === 'profiles')
      .map(call => call.args[0])

    // role and the approved/verified status are the eligibility rule; the
    // descriptive member_type must not exclude legacy approved faculty.
    expect(profileFilters).toContain('role')
    expect(profileFilters).not.toContain('member_type')
  })

  it('calls nominate_admin with the selected id and trimmed note', async () => {
    render(<AdminHandover />)

    const select = await screen.findByLabelText('Eligible nominee')
    fireEvent.change(select, { target: { value: 'fac-1' } })
    fireEvent.change(screen.getByLabelText('Optional note'), {
      target: { value: '  Please take over.  ' },
    })
    fireEvent.click(screen.getByRole('button', { name: /nominate successor/i }))

    expect(window.confirm).toHaveBeenCalledWith(
      'Nominate Dr Rao as administrator? They must accept before the role transfers.'
    )
    await waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith('nominate_admin', {
        p_nominee: 'fac-1',
        p_note: 'Please take over.',
      })
    )
    await waitFor(() =>
      expect(mocks.toastSuccess).toHaveBeenCalledWith('Nomination sent to Dr Rao')
    )
  })

  it('shows the RPC error verbatim and keeps the form', async () => {
    mocks.rpc.mockResolvedValue({ error: { message: 'A nomination is already pending.' } })

    render(<AdminHandover />)

    const select = await screen.findByLabelText('Eligible nominee')
    fireEvent.change(select, { target: { value: 'fac-1' } })
    fireEvent.click(screen.getByRole('button', { name: /nominate successor/i }))

    expect(await screen.findByText('A nomination is already pending.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /nominate successor/i })).toBeEnabled()
    expect(mocks.toastSuccess).not.toHaveBeenCalled()
  })

  it('cancels the pending nomination by id', async () => {
    mocks.pending = {
      id: 'nom-1',
      nominated_by: 'admin-1',
      nominee_id: 'fac-1',
      status: 'pending',
      note: 'Please take over.',
      created_at: '2026-10-20T09:00:00.000Z',
      nominee: { id: 'fac-1', name: 'Dr Rao', usn: null },
      nominator: { id: 'admin-1', name: 'Admin' },
    }

    render(<AdminHandover />)

    expect(await screen.findByText('Awaiting nominee response')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel nomination' }))

    expect(window.confirm).toHaveBeenCalledWith('Cancel the pending nomination for Dr Rao?')
    await waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith('cancel_admin_nomination', { p_id: 'nom-1' })
    )
  })

  it('shows the empty nominee and audit states', async () => {
    mocks.nominees = []
    mocks.audit = []

    render(<AdminHandover />)

    expect(await screen.findByText('No approved faculty are eligible yet.')).toBeInTheDocument()
    expect(screen.getByText('No succession activity yet.')).toBeInTheDocument()
  })
})
