import { beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import FacultySignUpForm from './FacultySignUpForm'

/**
 * The faculty signup form is an untrusted client. These tests cover the two
 * behaviours that keep it safe:
 *   * it sends only identity/application metadata (never role or approval);
 *   * it treats the database trigger's pending row as success and does not
 *     attempt an RLS-protected insert when signup returned no session.
 *
 * The form now lives on the canonical authentication page
 * (/signin?mode=signup&role=faculty); the legacy /signup/faculty URL redirects
 * to it. The real authorisation proof is in supabase/test-faculty-onboarding.sql.
 */

const mocks = vi.hoisted(() => ({
  signUp: vi.fn(),
  insert: vi.fn(),
}))

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { signUp: mocks.signUp },
    from: () => ({ insert: mocks.insert }),
  }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/signin',
}))

vi.mock('@/components/AuthFormShell', () => ({
  default: ({ children, title }: { children: React.ReactNode; title: string }) => (
    <div>
      <h1>{title}</h1>
      {children}
    </div>
  ),
}))

function fillForm(overrides: Partial<Record<'name' | 'email' | 'department' | 'designation' | 'employeeId' | 'password' | 'confirm', string>> = {}) {
  const values = {
    name: 'Dr. Anita Sharma',
    email: 'anita.sharma@ubdt.ac.in',
    department: 'CSE',
    designation: 'Assistant Professor',
    employeeId: 'UBDT-FAC-042',
    password: 'secret123',
    confirm: 'secret123',
    ...overrides,
  }

  fireEvent.change(screen.getByLabelText('Full name'), { target: { value: values.name } })
  fireEvent.change(screen.getByLabelText('Official institutional email'), {
    target: { value: values.email },
  })
  fireEvent.change(screen.getByLabelText('Department'), { target: { value: values.department } })
  fireEvent.change(screen.getByLabelText('Designation'), {
    target: { value: values.designation },
  })
  fireEvent.change(screen.getByLabelText(/Employee ID/), { target: { value: values.employeeId } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: values.password } })
  fireEvent.change(screen.getByLabelText('Confirm password'), {
    target: { value: values.confirm },
  })
  fireEvent.click(screen.getByRole('button', { name: /Submit application/i }))
}

beforeEach(() => {
  mocks.signUp.mockReset()
  mocks.insert.mockReset()
})

describe('faculty signup', () => {
  it('shows the pending state without a browser insert when email confirmation returns no session', async () => {
    mocks.signUp.mockResolvedValue({
      data: { user: { id: 'user-1', identities: [{ id: 'identity-1' }] }, session: null },
      error: null,
    })

    render(<FacultySignUpForm />)
    fillForm()

    expect(await screen.findByText('Your account is under review')).toBeInTheDocument()

    // The trigger created the application atomically during signUp. There is
    // no session for an RLS-protected fallback insert, so none was attempted.
    expect(mocks.insert).not.toHaveBeenCalled()

    const metadata = mocks.signUp.mock.calls[0][0].options.data
    expect(metadata).toEqual({
      name: 'Dr. Anita Sharma',
      department: 'CSE',
      designation: 'Assistant Professor',
      employee_id: 'UBDT-FAC-042',
      intent: 'faculty',
    })
    expect(metadata).not.toHaveProperty('role')
    expect(metadata).not.toHaveProperty('faculty_status')
    expect(metadata).not.toHaveProperty('status')
    expect(metadata).not.toHaveProperty('member_type')
  })

  it('does not report success for an obfuscated existing-email signup', async () => {
    // Supabase returns no error and no session for a registered address when
    // email confirmation is enabled, but the identities array is empty.
    mocks.signUp.mockResolvedValue({
      data: { user: { id: 'user-1', identities: [] }, session: null },
      error: null,
    })

    render(<FacultySignUpForm />)
    fillForm()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/already registered/i)
    expect(screen.queryByText('Your account is under review')).toBeNull()
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it('inserts a pending fallback row with a session and no reviewer fields', async () => {
    mocks.signUp.mockResolvedValue({
      data: { user: { id: 'user-1' }, session: { access_token: 'token' } },
      error: null,
    })
    mocks.insert.mockResolvedValue({ error: null })

    render(<FacultySignUpForm />)
    fillForm()

    expect(await screen.findByText('Your account is under review')).toBeInTheDocument()
    expect(mocks.insert).toHaveBeenCalledTimes(1)
    expect(mocks.insert).toHaveBeenCalledWith({
      user_id: 'user-1',
      full_name: 'Dr. Anita Sharma',
      official_email: 'anita.sharma@ubdt.ac.in',
      department: 'CSE',
      designation: 'Assistant Professor',
      employee_id: 'UBDT-FAC-042',
      status: 'pending',
    })
  })

  it('treats the trigger winning the race (23505) as success', async () => {
    mocks.signUp.mockResolvedValue({
      data: { user: { id: 'user-1' }, session: { access_token: 'token' } },
      error: null,
    })
    mocks.insert.mockResolvedValue({
      error: { code: '23505', message: 'duplicate key value violates unique constraint' },
    })

    render(<FacultySignUpForm />)
    fillForm()

    expect(await screen.findByText('Your account is under review')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('surfaces a non-duplicate insert failure and stays on the form', async () => {
    mocks.signUp.mockResolvedValue({
      data: { user: { id: 'user-1' }, session: { access_token: 'token' } },
      error: null,
    })
    mocks.insert.mockResolvedValue({
      error: { code: '42501', message: 'permission denied' },
    })

    render(<FacultySignUpForm />)
    fillForm()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/saving your application failed/i)
    expect(screen.queryByText('Your account is under review')).toBeNull()
  })

  it('rejects a faculty signup without a designation before calling auth', async () => {
    render(<FacultySignUpForm />)
    fillForm({ designation: '   ' })

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/designation/i)
    expect(mocks.signUp).not.toHaveBeenCalled()
  })
})
