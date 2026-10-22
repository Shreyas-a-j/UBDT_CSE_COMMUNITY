import { describe, it, expect } from 'vitest'
import {
  CANONICAL_AUTH_PATH,
  DEFAULT_SIGNUP_ROLE,
  canonicalAuthHref,
  isSignupRole,
  resolveAuthView,
  safeNextPath,
} from './auth'

describe('resolveAuthView', () => {
  it('defaults to Sign In with a student sign-up role', () => {
    expect(resolveAuthView({})).toEqual({ mode: 'signin', role: 'student' })
    expect(resolveAuthView({ mode: null, role: null })).toEqual({
      mode: 'signin',
      role: 'student',
    })
  })

  it('selects Sign Up only for mode=signup', () => {
    expect(resolveAuthView({ mode: 'signup' }).mode).toBe('signup')
    expect(resolveAuthView({ mode: 'SIGNUP' }).mode).toBe('signin')
    expect(resolveAuthView({ mode: 'register' }).mode).toBe('signin')
  })

  it('accepts known roles and rejects unknown ones', () => {
    expect(resolveAuthView({ mode: 'signup', role: 'alumni' }).role).toBe('alumni')
    expect(resolveAuthView({ mode: 'signup', role: 'faculty' }).role).toBe('faculty')
    expect(resolveAuthView({ mode: 'signup', role: 'admin' }).role).toBe(DEFAULT_SIGNUP_ROLE)
    expect(resolveAuthView({ mode: 'signup', role: '' }).role).toBe(DEFAULT_SIGNUP_ROLE)
  })
})

describe('isSignupRole', () => {
  it('narrows only the three registration roles', () => {
    expect(isSignupRole('student')).toBe(true)
    expect(isSignupRole('alumni')).toBe(true)
    expect(isSignupRole('faculty')).toBe(true)
    expect(isSignupRole('admin')).toBe(false)
    expect(isSignupRole(undefined)).toBe(false)
  })
})

describe('canonicalAuthHref', () => {
  it('points Sign In at the bare canonical path', () => {
    expect(canonicalAuthHref()).toBe(CANONICAL_AUTH_PATH)
    expect(canonicalAuthHref({ mode: 'signin' })).toBe(CANONICAL_AUTH_PATH)
  })

  it('encodes the mode and role for sign-up', () => {
    expect(canonicalAuthHref({ mode: 'signup', role: 'alumni' })).toBe(
      '/signin?mode=signup&role=alumni',
    )
    expect(canonicalAuthHref({ mode: 'signup' })).toBe('/signin?mode=signup&role=student')
  })

  it('preserves a post-login next target', () => {
    expect(canonicalAuthHref({ mode: 'signin', next: '/messages?conv=1' })).toBe(
      '/signin?next=%2Fmessages%3Fconv%3D1',
    )
    expect(canonicalAuthHref({ mode: 'signup', role: 'faculty', next: '/admin' })).toBe(
      '/signin?mode=signup&role=faculty&next=%2Fadmin',
    )
  })

  it('ignores an invalid role on sign-up', () => {
    // @ts-expect-error deliberately passing an unknown role
    expect(canonicalAuthHref({ mode: 'signup', role: 'admin' })).toBe(
      '/signin?mode=signup&role=student',
    )
  })
})

describe('safeNextPath', () => {
  it('keeps same-origin absolute paths', () => {
    expect(safeNextPath('/messages')).toBe('/messages')
    expect(safeNextPath('/people/abc?tab=posts')).toBe('/people/abc?tab=posts')
  })

  it('falls back for empty, protocol-relative and absolute URLs', () => {
    expect(safeNextPath(null)).toBe('/')
    expect(safeNextPath(undefined)).toBe('/')
    expect(safeNextPath('')).toBe('/')
    expect(safeNextPath('//evil.example')).toBe('/')
    expect(safeNextPath('https://evil.example')).toBe('/')
    expect(safeNextPath('messages')).toBe('/')
    expect(safeNextPath(null, '/fallback')).toBe('/fallback')
  })
})
