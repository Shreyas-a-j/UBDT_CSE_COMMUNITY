import { describe, it, expect } from 'vitest'
import { normalizeProfile, fallbackProfileFromAuth, displayName, isVerifiedFaculty } from './profile'

describe('fallbackProfileFromAuth', () => {
  const baseUser = {
    id: 'test-user-id',
    email: 'test@example.com',
    user_metadata: {},
  }

  it('creates a student profile with sensible defaults', () => {
    const profile = fallbackProfileFromAuth(baseUser)
    expect(profile.id).toBe('test-user-id')
    expect(profile.email).toBe('test@example.com')
    expect(profile.role).toBe('student')
    expect(profile.faculty_status).toBe('none')
    expect(profile.name).toBe('test') // derived from email
    expect(profile.branch).toBe('CSE')
    expect(profile.usn).toBeNull()
    expect(profile.year).toBeNull()
  })

  it('populates faculty intent as pending status but NOT as faculty role', () => {
    const profile = fallbackProfileFromAuth({
      ...baseUser,
      user_metadata: { intent: 'faculty', name: 'Dr. Smith' },
    })
    expect(profile.role).toBe('student') // signup metadata does NOT grant faculty role
    expect(profile.faculty_status).toBe('pending')
    expect(profile.name).toBe('Dr. Smith')
  })

  it('populates student fields from metadata', () => {
    const profile = fallbackProfileFromAuth({
      ...baseUser,
      user_metadata: {
        name: 'Alice',
        usn: '4UB24CS001',
        year: 3,
        department: 'ECE',
        section: 'A',
        skills: ['React', 'Node'],
        interests: ['AI', 'ML'],
      },
    })
    expect(profile.usn).toBe('4UB24CS001')
    expect(profile.year).toBe(3)
    expect(profile.branch).toBe('ECE')
    expect(profile.section).toBe('A')
    expect(profile.skills).toEqual(['React', 'Node'])
    expect(profile.interests).toEqual(['AI', 'ML'])
  })

  it('handles missing user_metadata gracefully', () => {
    const profile = fallbackProfileFromAuth({ id: 'u1', email: 'u@x.com' } as any)
    expect(profile.name).toBe('u')
    expect(profile.role).toBe('student')
    expect(profile.faculty_status).toBe('none')
  })

  it('does not trust signup metadata for approved faculty privileges', () => {
    // Even if a user signs up with intent=faculty AND a pre-claimed role,
    // the fallback must still be 'student' — role activation is separate.
    const profile = fallbackProfileFromAuth({
      id: 'u2',
      email: 'prof@uni.edu',
      user_metadata: { intent: 'faculty', role: 'faculty', designation: 'Professor' },
    })
    expect(profile.role).toBe('student')
    expect(profile.faculty_status).toBe('pending')
    // designation should be preserved from metadata but role stays student
    expect(profile.designation).toBe('Professor')
  })
})

describe('normalizeProfile', () => {
  it('returns null for null/undefined input', () => {
    expect(normalizeProfile(null)).toBeNull()
    expect(normalizeProfile(undefined as any)).toBeNull()
  })

  it('returns null when row has no id', () => {
    expect(normalizeProfile({ name: 'Alice' })).toBeNull()
  })

  it('normalises a full profile row', () => {
    const row = {
      id: 'p1',
      email: 'alice@ubdt.ac.in',
      usn: ' 4ub24cs001 ',
      name: 'Alice',
      year: 3,
      branch: 'CSE',
      section: 'A',
      bio: 'Hello',
      avatar_url: 'https://img.com/a.webp',
      skills: ['React', 'TypeScript'],
      interests: ['AI', 'ML'],
      role: 'student',
      faculty_status: 'none',
      designation: null,
      employee_id: null,
      expertise: [],
      created_at: '2026-01-01T00:00:00Z',
      updated_at: null,
    }
    const profile = normalizeProfile(row)
    expect(profile).not.toBeNull()
    expect(profile!.id).toBe('p1')
    expect(profile!.usn).toBe('4ub24cs001') // asNullableString trims but does not upper
    expect(profile!.year).toBe(3)
    expect(profile!.branch).toBe('CSE')
    expect(profile!.role).toBe('student')
    expect(profile!.faculty_status).toBe('none')
  })

  it('coerces invalid year to null', () => {
    const p = normalizeProfile({ id: 'p1', year: 'invalid' } as any)
    expect(p!.year).toBeNull()
  })

  it('coerces out-of-range year to null', () => {
    const p = normalizeProfile({ id: 'p1', year: 99 } as any)
    expect(p!.year).toBeNull()
  })

  it('defaults role to student', () => {
    const p = normalizeProfile({ id: 'p1' } as any)
    expect(p!.role).toBe('student')
  })

  it('defaults faculty_status to none', () => {
    const p = normalizeProfile({ id: 'p1' } as any)
    expect(p!.faculty_status).toBe('none')
  })

  it('preserves verified faculty role', () => {
    const p = normalizeProfile({ id: 'p1', role: 'faculty', faculty_status: 'verified' } as any)
    expect(p!.role).toBe('faculty')
    expect(p!.faculty_status).toBe('verified')
  })
})

describe('displayName', () => {
  it('returns name when present', () => {
    expect(displayName({ name: 'Alice' })).toBe('Alice')
  })
  it('returns Member when name is empty', () => {
    expect(displayName({ name: '' })).toBe('Member')
  })
  it('returns Member for undefined', () => {
    expect(displayName(undefined)).toBe('Member')
  })
})

describe('isVerifiedFaculty', () => {
  it('true for admin', () => {
    expect(isVerifiedFaculty({ role: 'admin', faculty_status: 'none' } as any)).toBe(true)
  })
  it('true for verified faculty', () => {
    expect(isVerifiedFaculty({ role: 'faculty', faculty_status: 'verified' } as any)).toBe(true)
  })
  it('false for pending faculty', () => {
    expect(isVerifiedFaculty({ role: 'faculty', faculty_status: 'pending' } as any)).toBe(false)
  })
  it('false for student', () => {
    expect(isVerifiedFaculty({ role: 'student', faculty_status: 'none' } as any)).toBe(false)
  })
  it('false for null', () => {
    expect(isVerifiedFaculty(null)).toBe(false)
  })
})
