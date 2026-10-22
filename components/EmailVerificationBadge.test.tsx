import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import EmailVerificationBadge from './EmailVerificationBadge'

describe('EmailVerificationBadge', () => {
  it('shows an explicit unverified state and never a verified tick', () => {
    render(<EmailVerificationBadge verified={false} />)

    expect(screen.getByText('Email not verified')).toBeInTheDocument()
    expect(screen.queryByText('Email verified')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Email verified')).not.toBeInTheDocument()
  })

  it('shows the verified state only for a true value', () => {
    render(<EmailVerificationBadge verified />)

    expect(screen.getByText('Email verified')).toBeInTheDocument()
    expect(screen.getByLabelText('Email verified')).toBeInTheDocument()
    expect(screen.queryByText('Email not verified')).not.toBeInTheDocument()
  })

  it('renders nothing when the status is unknown', () => {
    const { container } = render(<EmailVerificationBadge verified={undefined} />)

    expect(container).toBeEmptyDOMElement()
  })
})
