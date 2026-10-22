import { describe, expect, it } from 'vitest'
import {
  emailVerificationLabel,
  emailVerificationState,
  normalizeEmailVerificationRows,
  uniqueVerificationIds,
} from './emailVerification'

describe('normalizeEmailVerificationRows', () => {
  it('indexes valid rows by user id', () => {
    const status = normalizeEmailVerificationRows([
      { user_id: 'u1', email_verified: true },
      { user_id: 'u2', email_verified: false },
    ])

    expect(status).toEqual({ u1: true, u2: false })
  })

  it('never coerces a non-boolean into verified', () => {
    const status = normalizeEmailVerificationRows([
      { user_id: 'string-true', email_verified: 'true' },
      { user_id: 'one', email_verified: 1 },
      { user_id: 'null', email_verified: null },
      { user_id: 'missing' },
    ])

    expect(status).toEqual({})
  })

  it('drops malformed rows without discarding valid ones', () => {
    const status = normalizeEmailVerificationRows([
      null,
      'nope',
      { user_id: '', email_verified: true },
      { user_id: '  u1  ', email_verified: false },
      { user_id: 'u2', email_verified: true },
    ])

    expect(status).toEqual({ u1: false, u2: true })
  })

  it('returns an empty map for a non-array response', () => {
    expect(normalizeEmailVerificationRows(null)).toEqual({})
    expect(normalizeEmailVerificationRows({ user_id: 'u1', email_verified: true })).toEqual({})
  })
})

describe('emailVerificationState / label', () => {
  it('distinguishes verified, unverified and unknown', () => {
    expect(emailVerificationState(true)).toBe('verified')
    expect(emailVerificationState(false)).toBe('unverified')
    expect(emailVerificationState(undefined)).toBe('unknown')
    expect(emailVerificationState(null)).toBe('unknown')
  })

  it('never labels unknown as either state', () => {
    expect(emailVerificationLabel(true)).toBe('Email verified')
    expect(emailVerificationLabel(false)).toBe('Email not verified')
    expect(emailVerificationLabel(undefined)).toBeNull()
  })
})

describe('uniqueVerificationIds', () => {
  it('trims, removes blanks and duplicates, and sorts', () => {
    expect(uniqueVerificationIds([' b ', 'a', '', 'a', '  '])).toEqual(['a', 'b'])
  })

  it('ignores non-string input defensively', () => {
    expect(uniqueVerificationIds(['a', null as unknown as string])).toEqual(['a'])
  })
})
