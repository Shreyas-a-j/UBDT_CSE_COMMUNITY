import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import ProfileLinks from './ProfileLinks'
import { Profile } from '@/lib/types'

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: 'profile-1',
    usn: '4UB24CS001',
    name: 'Alice',
    year: 3,
    branch: 'CSE',
    section: null,
    bio: null,
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

describe('ProfileLinks', () => {
  it('renders safe links that open in a new tab without window.opener access', () => {
    render(
      <ProfileLinks
        profile={makeProfile({
          portfolio_url: 'https://me.dev',
          github_url: 'https://github.com/alice',
          linkedin_url: 'https://linkedin.com/in/alice',
        })}
      />,
    )

    const github = screen.getByRole('link', { name: 'GitHub (opens in a new tab)' })
    expect(github).toHaveAttribute('href', 'https://github.com/alice')
    expect(github).toHaveAttribute('target', '_blank')
    expect(github).toHaveAttribute('rel', 'noopener noreferrer')

    const linkedin = screen.getByRole('link', { name: 'LinkedIn (opens in a new tab)' })
    expect(linkedin).toHaveAttribute('href', 'https://linkedin.com/in/alice')
    expect(linkedin).toHaveAttribute('target', '_blank')
    expect(linkedin).toHaveAttribute('rel', 'noopener noreferrer')

    const portfolio = screen.getByRole('link', { name: 'Portfolio (opens in a new tab)' })
    expect(portfolio).toHaveAttribute('href', 'https://me.dev')
    expect(portfolio).toHaveAttribute('target', '_blank')
    expect(portfolio).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('normalizes common bare-domain input before rendering', () => {
    render(
      <ProfileLinks
        profile={makeProfile({
          github_url: 'github.com/alice',
          linkedin_url: 'www.linkedin.com/in/alice',
        })}
      />,
    )

    expect(screen.getByRole('link', { name: /GitHub/ })).toHaveAttribute(
      'href',
      'https://github.com/alice',
    )
    expect(screen.getByRole('link', { name: /LinkedIn/ })).toHaveAttribute(
      'href',
      'https://www.linkedin.com/in/alice',
    )
  })

  it('renders nothing when all links are missing', () => {
    const { container } = render(<ProfileLinks profile={makeProfile()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('never renders unsafe or malformed URLs as links', () => {
    const { container } = render(
      <ProfileLinks
        profile={makeProfile({
          portfolio_url: 'javascript:alert(1)',
          github_url: 'data:text/html,boom',
          linkedin_url: 'https://not-linkedin.example/alice',
        })}
      />,
    )

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('keeps only the valid links when some are unsafe', () => {
    render(
      <ProfileLinks
        profile={makeProfile({
          portfolio_url: 'javascript:alert(1)',
          github_url: 'https://github.com/alice',
          linkedin_url: 'not a url',
        })}
      />,
    )

    expect(screen.getByRole('link', { name: /GitHub/ })).toHaveAttribute(
      'href',
      'https://github.com/alice',
    )
    expect(screen.getAllByRole('link')).toHaveLength(1)
    expect(screen.queryByRole('link', { name: /Portfolio/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /LinkedIn/ })).not.toBeInTheDocument()
  })
})
