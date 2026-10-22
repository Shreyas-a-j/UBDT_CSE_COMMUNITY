import { beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { render, screen } from '@testing-library/react'

/**
 * The canonical authentication page is a single URL that renders one of four
 * views based on query params. These tests pin that routing contract — the
 * whole point of consolidating every entry point onto /signin.
 */

const state = vi.hoisted(() => ({ query: new URLSearchParams() }))

vi.mock('next/navigation', () => ({
  useSearchParams: () => state.query,
}))

vi.mock('@/components/AuthFormShell', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/components/auth/SignInForm', () => ({ default: () => <div>signin-view</div> }))
vi.mock('@/components/auth/StudentSignUpForm', () => ({ default: () => <div>student-view</div> }))
vi.mock('@/components/auth/AlumniSignUpForm', () => ({ default: () => <div>alumni-view</div> }))
vi.mock('@/components/auth/FacultySignUpForm', () => ({ default: () => <div>faculty-view</div> }))

import CanonicalAuthPage from './page'

beforeEach(() => {
  state.query = new URLSearchParams()
})

describe('canonical authentication page', () => {
  it('renders Sign In by default', () => {
    render(<CanonicalAuthPage />)
    expect(screen.getByText('signin-view')).toBeInTheDocument()
  })

  it('renders student registration for mode=signup', () => {
    state.query = new URLSearchParams('mode=signup')
    render(<CanonicalAuthPage />)
    expect(screen.getByText('student-view')).toBeInTheDocument()
  })

  it('renders alumni registration for role=alumni', () => {
    state.query = new URLSearchParams('mode=signup&role=alumni')
    render(<CanonicalAuthPage />)
    expect(screen.getByText('alumni-view')).toBeInTheDocument()
  })

  it('renders the faculty request for role=faculty', () => {
    state.query = new URLSearchParams('mode=signup&role=faculty')
    render(<CanonicalAuthPage />)
    expect(screen.getByText('faculty-view')).toBeInTheDocument()
  })

  it('ignores an unknown role and falls back to student registration', () => {
    state.query = new URLSearchParams('mode=signup&role=admin')
    render(<CanonicalAuthPage />)
    expect(screen.getByText('student-view')).toBeInTheDocument()
  })
})
