import { beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import AlumniSignUpForm from './AlumniSignUpForm'

/**
 * Alumni registration must succeed without a USN. This pins the contract the
 * database trigger relies on: the signUp metadata carries intent='alumni' and
 * no `usn` key, so handle_new_user() provisions a USN-less alumni profile.
 */

const mocks = vi.hoisted(() => ({
  signUp: vi.fn(),
  signIn: vi.fn(),
}))

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { signUp: mocks.signUp, signInWithPassword: mocks.signIn },
  }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/components/AuthFormShell', () => ({
  default: ({ children, title }: { children: React.ReactNode; title: string }) => (
    <div>
      <h1>{title}</h1>
      {children}
    </div>
  ),
}))

beforeEach(() => {
  mocks.signUp.mockReset()
  mocks.signIn.mockReset()
})

describe('alumni signup', () => {
  it('submits without a USN and asks the trigger for an alumni profile', async () => {
    // No user/session means email confirmation is required → success screen.
    mocks.signUp.mockResolvedValue({ data: { user: null }, error: null })

    render(<AlumniSignUpForm />)

    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Asha Rao' } })
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'asha.rao@example.com' },
    })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret1' } })
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'secret1' } })

    expect(screen.queryByLabelText(/USN/i)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Create profile/i }))

    await waitFor(() => expect(mocks.signUp).toHaveBeenCalledTimes(1))

    const payload = mocks.signUp.mock.calls[0][0]
    expect(payload.email).toBe('asha.rao@example.com')
    expect(payload.password).toBe('secret1')
    expect(payload.options.data).not.toHaveProperty('usn')
    expect(payload.options.data).toMatchObject({
      name: 'Asha Rao',
      department: 'CSE',
      intent: 'alumni',
    })
    expect(typeof payload.options.data.graduation_year).toBe('number')

    expect(await screen.findByText('Check your email')).toBeInTheDocument()
  })

  it('blocks submission on a mismatched confirmation', async () => {
    render(<AlumniSignUpForm />)

    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Asha Rao' } })
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'asha.rao@example.com' },
    })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret1' } })
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'secret2' } })

    expect(screen.getByText(/passwords do not match/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Create profile/i })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: /Create profile/i }))
    expect(mocks.signUp).not.toHaveBeenCalled()
  })
})
