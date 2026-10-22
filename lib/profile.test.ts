import { describe, it, expect } from 'vitest'
import {
  normalizeProfile,
  normalizeProfileLinks,
  fallbackProfileFromAuth,
  normalizeProfileContact,
  profileWritableFields,
  displayName,
  isVerifiedFaculty,
  alumniTag,
} from './profile'

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

  it('sets member_type from intent=alumni without granting any privilege', () => {
    const profile = fallbackProfileFromAuth({
      ...baseUser,
      user_metadata: {
        intent: 'alumni',
        graduation_year: 2021,
        portfolio_url: ' https://me.dev/alumni ',
        github_url: 'https://github.com/alumni-dev',
        linkedin_url: 'https://www.linkedin.com/in/alumni-dev',
      },
    })
    expect(profile.role).toBe('student')
    expect(profile.faculty_status).toBe('none')
    expect(profile.member_type).toBe('alumni')
    expect(profile.graduation_year).toBe(2021)
    expect(profile.portfolio_url).toBe('https://me.dev/alumni')
    expect(profile.github_url).toBe('https://github.com/alumni-dev')
    expect(profile.linkedin_url).toBe('https://www.linkedin.com/in/alumni-dev')
  })

  it('normalises alumni intent before interpreting it (casing/whitespace)', () => {
    const profile = fallbackProfileFromAuth({
      ...baseUser,
      user_metadata: { intent: '  AlUmNi  ', graduation_year: '2019' },
    })
    expect(profile.member_type).toBe('alumni')
    expect(profile.graduation_year).toBe(2019)
  })

  it('keeps non-alumni/faculty intents on the nonprivileged student default', () => {
    const profile = fallbackProfileFromAuth({
      ...baseUser,
      user_metadata: { intent: 'visitor' },
    })
    expect(profile.member_type).toBe('student')
    expect(profile.role).toBe('student')
    expect(profile.faculty_status).toBe('none')
  })

  it('faculty intent stays a student with member_type=student, only faculty_status=pending', () => {
    const profile = fallbackProfileFromAuth({
      ...baseUser,
      user_metadata: { intent: 'faculty' },
    })
    expect(profile.member_type).toBe('student')
    expect(profile.role).toBe('student')
    expect(profile.faculty_status).toBe('pending')
  })

  it('does not derive member_type or privileges from claimed metadata', () => {
    const profile = fallbackProfileFromAuth({
      ...baseUser,
      user_metadata: {
        member_type: 'faculty',
        role: 'admin',
        faculty_status: 'verified',
        graduation_year: 3000,
      },
    })
    expect(profile.member_type).toBe('student')
    expect(profile.role).toBe('student')
    expect(profile.faculty_status).toBe('none')
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

  it('defaults member_type sensibly from role for legacy rows without one', () => {
    expect(normalizeProfile({ id: 'p1' } as any)!.member_type).toBe('student')
    expect(normalizeProfile({ id: 'p1', role: 'student' } as any)!.member_type).toBe('student')
    expect(normalizeProfile({ id: 'p1', role: 'faculty' } as any)!.member_type).toBe('faculty')
    expect(normalizeProfile({ id: 'p1', role: 'admin' } as any)!.member_type).toBe('faculty')
    // Invalid member_type values fall back to the role-based default, are never trusted.
    expect(normalizeProfile({ id: 'p1', member_type: 'alumni-admin' } as any)!.member_type).toBe('student')
    expect(normalizeProfile({ id: 'p1', member_type: 'alumni' } as any)!.member_type).toBe('alumni')
  })

  it('rejects out-of-range graduation years', () => {
    const p = normalizeProfile({ id: 'p1', graduation_year: 1949 } as any)
    const p2 = normalizeProfile({ id: 'p1', graduation_year: 2201 } as any)
    const p3 = normalizeProfile({ id: 'p1', graduation_year: 'x' } as any)
    expect(p!.graduation_year).toBeNull()
    expect(p2!.graduation_year).toBeNull()
    expect(p3!.graduation_year).toBeNull()
  })

  it('accepts graduation year inside the 1950-2200 range', () => {
    const p = normalizeProfile({ id: 'p1', graduation_year: 2024 } as any)
    expect(p!.graduation_year).toBe(2024)
  })

  it('normalises portfolio_url, invalid scheme is dropped', () => {
    expect(normalizeProfile({ id: 'p1', portfolio_url: ' https://me.dev ' } as any)!.portfolio_url).toBe('https://me.dev')
    expect(normalizeProfile({ id: 'p1', portfolio_url: 'ftp://me.dev' } as any)!.portfolio_url).toBeNull()
    expect(normalizeProfile({ id: 'p1', portfolio_url: 'http://a b.com' } as any)!.portfolio_url).toBeNull()
  })

  it('normalises github_url and linkedin_url with domain checks', () => {
    const validGithub = normalizeProfile({ id: 'p1', github_url: ' https://github.com/ubdt-dev ' } as any)!
    expect(validGithub.github_url).toBe('https://github.com/ubdt-dev')
    expect(normalizeProfile({ id: 'p1', github_url: 'https://gitlab.com/ubdt-dev' } as any)!.github_url).toBeNull()
    // Common copy/paste input without a scheme is upgraded to HTTPS.
    expect(normalizeProfile({ id: 'p1', github_url: 'github.com/ubdt-dev' } as any)!.github_url).toBe('https://github.com/ubdt-dev')
    expect(normalizeProfile({ id: 'p1', github_url: 'https://github.com' } as any)!.github_url).toBeNull()

    const validLinked = normalizeProfile({ id: 'p1', linkedin_url: 'https://linkedin.com/in/nikhil-x' } as any)!
    expect(validLinked.linkedin_url).toBe('https://linkedin.com/in/nikhil-x')
    expect(normalizeProfile({ id: 'p1', linkedin_url: 'https://x.com/in/nikhil-x' } as any)!.linkedin_url).toBeNull()
    expect(normalizeProfile({ id: 'p1', linkedin_url: 'www.linkedin.com/in/nikhil-x' } as any)!.linkedin_url).toBe('https://www.linkedin.com/in/nikhil-x')
  })

  it('rejects unsafe and unsupported URL schemes', () => {
    const unsafe = [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      'ftp://example.com/profile',
      'mailto:someone@example.com',
    ]

    for (const value of unsafe) {
      expect(normalizeProfile({ id: 'p1', portfolio_url: value } as any)!.portfolio_url).toBeNull()
      expect(normalizeProfile({ id: 'p1', github_url: value } as any)!.github_url).toBeNull()
      expect(normalizeProfile({ id: 'p1', linkedin_url: value } as any)!.linkedin_url).toBeNull()
    }
  })

  it('rejects malformed and over-long URLs', () => {
    expect(normalizeProfile({ id: 'p1', portfolio_url: 'https://' } as any)!.portfolio_url).toBeNull()
    expect(normalizeProfile({ id: 'p1', portfolio_url: 'not a url' } as any)!.portfolio_url).toBeNull()
    expect(normalizeProfile({ id: 'p1', portfolio_url: `https://me.dev/${'a'.repeat(600)}` } as any)!.portfolio_url).toBeNull()
    expect(normalizeProfile({ id: 'p1', github_url: `https://github.com/${'a'.repeat(400)}` } as any)!.github_url).toBeNull()
    expect(normalizeProfile({ id: 'p1', linkedin_url: 'https://linkedin.com/' } as any)!.linkedin_url).toBeNull()
  })

  it('treats empty links as missing rather than invalid', () => {
    const profile = normalizeProfile({
      id: 'p1',
      portfolio_url: '',
      github_url: '   ',
      linkedin_url: null,
    } as any)!
    expect(profile.portfolio_url).toBeNull()
    expect(profile.github_url).toBeNull()
    expect(profile.linkedin_url).toBeNull()
  })

  it('never includes private contact data in the public profile', () => {
    const row = {
      id: 'p1',
      contact_email: 'secret@example.com',
      phone: '+91 9876543210',
      contact_visibility: 'public',
    }
    const profile = normalizeProfile(row as any)!
    expect('contact_email' in profile).toBe(false)
    expect('phone' in profile).toBe(false)
    expect('contact_visibility' in profile).toBe(false)
  })
})

describe('normalizeProfileLinks', () => {
  it('normalizes bare domains and leaves missing links empty', () => {
    const result = normalizeProfileLinks({
      portfolio_url: 'me.dev',
      github_url: 'github.com/ubdt-dev',
      linkedin_url: '',
    })

    expect(result.errors).toEqual({})
    expect(result.values).toEqual({
      portfolio_url: 'https://me.dev',
      github_url: 'https://github.com/ubdt-dev',
      linkedin_url: null,
    })
  })

  it('reports an error only for non-empty invalid links', () => {
    const result = normalizeProfileLinks({
      portfolio_url: 'javascript:alert(1)',
      github_url: 'https://gitlab.com/ubdt-dev',
      linkedin_url: 'https://linkedin.com/',
    })

    expect(result.values).toEqual({
      portfolio_url: null,
      github_url: null,
      linkedin_url: null,
    })
    expect(Object.keys(result.errors).sort()).toEqual([
      'github_url',
      'linkedin_url',
      'portfolio_url',
    ])

    const empty = normalizeProfileLinks({
      portfolio_url: '',
      github_url: null,
      linkedin_url: undefined,
    })
    expect(empty.errors).toEqual({})
  })
})

describe('profileWritableFields', () => {
  it('includes UCC 2.0 public link fields', () => {
    const fields = profileWritableFields({
      portfolio_url: 'https://me.dev',
      github_url: 'https://github.com/u',
      linkedin_url: 'https://linkedin.com/in/u',
    })
    expect(fields.portfolio_url).toBe('https://me.dev')
    expect(fields.github_url).toBe('https://github.com/u')
    expect(fields.linkedin_url).toBe('https://linkedin.com/in/u')
    expect(fields.updated_at).toBeTruthy()
  })

  it('normalizes bare links and drops unsafe links at the write boundary', () => {
    const bare = profileWritableFields({ github_url: 'github.com/u' })
    expect(bare.github_url).toBe('https://github.com/u')

    const unsafe = profileWritableFields({
      portfolio_url: 'javascript:alert(1)',
      linkedin_url: 'data:text/html,boom',
    })
    expect(unsafe.portfolio_url).toBeNull()
    expect(unsafe.linkedin_url).toBeNull()
  })

  it('never exposes protected identity or privilege fields', () => {
    const fields = profileWritableFields({
      id: 'someone-else',
      role: 'admin' as any,
      faculty_status: 'verified' as any,
      usn: '4UB24CS001',
      member_type: 'alumni',
      graduation_year: 2020,
      employee_id: 'EMP-01',
      designation: 'Professor',
    })
    expect('id' in fields).toBe(false)
    expect('role' in fields).toBe(false)
    expect('faculty_status' in fields).toBe(false)
    expect('usn' in fields).toBe(false)
    expect('member_type' in fields).toBe(false)
    expect('graduation_year' in fields).toBe(false)
    expect('employee_id' in fields).toBe(false)
    expect('designation' in fields).toBe(false)
  })
})

describe('normalizeProfileContact', () => {
  it('returns null for missing rows or missing profile_id', () => {
    expect(normalizeProfileContact(null)).toBeNull()
    expect(normalizeProfileContact(undefined as any)).toBeNull()
    expect(normalizeProfileContact({ contact_email: 'x@y.com' } as any)).toBeNull()
  })

  it('normalises a full contact row', () => {
    const row = {
      profile_id: 'p1',
      contact_email: ' Nikhil@example.com ',
      phone: '+91 98765 43210',
      contact_visibility: 'members',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: null,
    }
    const contact = normalizeProfileContact(row as any)
    expect(contact).not.toBeNull()
    expect(contact!.profile_id).toBe('p1')
    expect(contact!.contact_email).toBe('Nikhil@example.com')
    expect(contact!.phone).toBe('+91 98765 43210')
    expect(contact!.contact_visibility).toBe('members')
  })

  it('drops invalid contact emails instead of passing them through', () => {
    expect(normalizeProfileContact({ profile_id: 'p1', contact_email: 'not-an-email' } as any)!.contact_email).toBeNull()
    expect(normalizeProfileContact({ profile_id: 'p1', contact_email: 'ok@example.com' } as any)!.contact_email).toBe('ok@example.com')
    expect(normalizeProfileContact({ profile_id: 'p1', contact_email: '' } as any)!.contact_email).toBeNull()
  })

  it('drops invalid phone numbers', () => {
    expect(normalizeProfileContact({ profile_id: 'p1', phone: 'abc123' } as any)!.phone).toBeNull()
    expect(normalizeProfileContact({ profile_id: 'p1', phone: '12' } as any)!.phone).toBeNull()
    expect(normalizeProfileContact({ profile_id: 'p1', phone: '+91 98765 43210' } as any)!.phone).toBe('+91 98765 43210')
  })

  it('defaults unknown visibility to private and keeps supported values', () => {
    expect(normalizeProfileContact({ profile_id: 'p1' } as any)!.contact_visibility).toBe('private')
    expect(
      normalizeProfileContact({ profile_id: 'p1', contact_visibility: 'public' } as any)!.contact_visibility
    ).toBe('public')
    expect(
      normalizeProfileContact({ profile_id: 'p1', contact_visibility: 'everyone' } as any)!.contact_visibility
    ).toBe('private')
  })

  it('keeps created_at/updated_at strings nullable', () => {
    const contact = normalizeProfileContact({ profile_id: 'p1', created_at: '2026-02-02T00:00:00Z' } as any)
    expect(contact!.created_at).toBe('2026-02-02T00:00:00Z')
    expect(contact!.updated_at).toBeNull()
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

describe('alumniTag', () => {
  it('formats a graduation year as a two-digit alumni tag', () => {
    expect(alumniTag(2024)).toBe("Alumni '24")
    expect(alumniTag(1999)).toBe("Alumni '99")
  })

  it('falls back to Alumni when the graduation year is missing', () => {
    expect(alumniTag(null)).toBe('Alumni')
    expect(alumniTag(undefined)).toBe('Alumni')
  })

  it('falls back to Alumni for a non-integer year', () => {
    expect(alumniTag(2024.5)).toBe('Alumni')
  })
})

describe('isVerifiedFaculty', () => {
  it('true for admin', () => {
    expect(isVerifiedFaculty({ role: 'admin', faculty_status: 'none' } as any)).toBe(true)
  })
  it('true for verified faculty', () => {
    expect(isVerifiedFaculty({ role: 'faculty', faculty_status: 'verified' } as any)).toBe(true)
  })
  it('true for approved faculty (the live database vocabulary)', () => {
    expect(isVerifiedFaculty({ role: 'faculty', faculty_status: 'approved' } as any)).toBe(true)
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

describe('normalizeProfile faculty status', () => {
  it('preserves approved faculty status instead of coercing it to none', () => {
    const profile = normalizeProfile({
      id: 'f1',
      name: 'Dr. Approved',
      role: 'faculty',
      faculty_status: 'approved',
    })

    expect(profile?.role).toBe('faculty')
    expect(profile?.faculty_status).toBe('approved')
    expect(isVerifiedFaculty(profile)).toBe(true)
  })
})
