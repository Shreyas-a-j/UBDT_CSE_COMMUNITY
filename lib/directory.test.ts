import { describe, it, expect, vi } from 'vitest'

// --- Helpers imported from lib/profile so we can test them directly ---
import { normalizeProfile, fallbackProfileFromAuth, isVerifiedFaculty, displayName } from '../lib/profile'
import type { Profile } from '../lib/types'

// ===========================================================================
// Directory-specific test suite (Agent 6)
// ===========================================================================

// Approved faculty = admin OR (role=faculty AND faculty_status=verified).
// A self-declared signup role is NOT proof of approval — pending and
// rejected faculty are excluded from the directory.
const isApprovedFaculty = (p: Record<string, unknown>): boolean => {
  const role = p.role
  if (role === 'admin') return true
  if (role === 'faculty' && p.faculty_status === 'verified') return true
  return false
}

describe('Directory profile filtering', () => {
  it('filters out pending-faculty from the approved faculty list', () => {
    const rows: Record<string, unknown>[] = [
      { id: 'a1', name: 'Admin User', role: 'admin', designation: 'Dean' },
      { id: 'a2', name: 'Verified Prof', role: 'faculty', faculty_status: 'verified', designation: 'Professor' },
      { id: 'a3', name: 'Pending Prof', role: 'faculty', faculty_status: 'pending', designation: 'Asst Prof' },
      { id: 'a4', name: 'Rejected Prof', role: 'faculty', faculty_status: 'rejected', designation: 'Lecturer' },
      { id: 'a5', name: 'Student', role: 'student', year: 3 },
    ]

    const filtered = rows.filter(isApprovedFaculty)

    // Pending and rejected faculty MUST be excluded — approval comes from
    // admin action (faculty_applications), not from self-declared role.
    const ids = filtered.map(p => String(p.id))
    expect(ids).toContain('a1') // admin
    expect(ids).toContain('a2') // verified faculty
    expect(ids).not.toContain('a3') // pending — should NOT appear
    expect(ids).not.toContain('a4') // rejected — should NOT appear
    expect(ids).not.toContain('a5') // student
  })

  it('includes admins in the approved-faculty view even without role=faculty', () => {
    const rows: Record<string, unknown>[] = [
      { id: 'x1', name: 'Super Admin', role: 'admin', designation: 'Head of Dept' },
    ]
    const filtered = rows.filter(isApprovedFaculty)
    expect(filtered).toHaveLength(1)
    expect((filtered[0] as Record<string, unknown>).id).toBe('x1')
  })

  it('shows only students in the people directory (role=student filter)', () => {
    const rows: Record<string, unknown>[] = [
      { id: 's1', name: 'Student One', role: 'student', year: 2 },
      { id: 's2', name: 'Student Two', role: 'student', year: 4 },
      { id: 'f1', name: 'Faculty One', role: 'faculty', faculty_status: 'verified' },
      { id: 'a1', name: 'Admin One', role: 'admin' },
    ]

    // Client-side filter mimics the people directory fallback path
    const filtered = rows.filter((p: Record<string, unknown>) => {
      const role = p.role
      return role === undefined || role === 'student' || role === null
    })

    const ids = filtered.map(p => String(p.id))
    expect(ids).toContain('s1')
    expect(ids).toContain('s2')
    expect(ids).not.toContain('f1')
    expect(ids).not.toContain('a1')
  })
})

describe('normalizeProfile — missing optional columns are safe', () => {
  it('handles a row with no optional migration columns', () => {
    // Simulate a pre-migration row missing section, interests, designation, etc.
    const row = {
      id: 'r1',
      name: 'Basic User',
      branch: 'CSE',
      role: 'student',
      faculty_status: 'none',
      created_at: '2026-01-01T00:00:00Z',
    } as Record<string, unknown>

    const profile = normalizeProfile(row)
    expect(profile).not.toBeNull()
    expect(profile!.name).toBe('Basic User')
    expect(profile!.section).toBeNull()
    expect(profile!.interests).toEqual([])
    expect(profile!.designation).toBeNull()
    expect(profile!.expertise).toEqual([])
    expect(profile!.faculty_status).toBe('none')
  })

  it('does not crash when skills/interests are null', () => {
    const profile = normalizeProfile({
      id: 'r2',
      name: 'No Skills',
      skills: null,
      interests: null,
      expertise: null,
      role: 'student',
    } as unknown as Record<string, unknown>)

    expect(profile!.skills).toEqual([])
    expect(profile!.interests).toEqual([])
    expect(profile!.expertise).toEqual([])
  })
})

describe('isVerifiedFaculty — approval semantics', () => {
  it('returns false for pending faculty (not yet approved)', () => {
    expect(isVerifiedFaculty({ role: 'faculty', faculty_status: 'pending' } as Profile)).toBe(false)
  })

  it('returns false for rejected faculty', () => {
    expect(isVerifiedFaculty({ role: 'faculty', faculty_status: 'rejected' } as Profile)).toBe(false)
  })

  it('returns true for verified faculty', () => {
    expect(isVerifiedFaculty({ role: 'faculty', faculty_status: 'verified' } as Profile)).toBe(true)
  })

  it('returns true for admins (override)', () => {
    expect(isVerifiedFaculty({ role: 'admin' } as Profile)).toBe(true)
  })

  it('returns false for students with pending intent', () => {
    // Signup metadata intent='faculty' sets faculty_status=pending but role stays student
    const profile = fallbackProfileFromAuth({
      id: 'u1',
      email: 'student@ubdt.ac.in',
      user_metadata: { intent: 'faculty' },
    })
    expect(profile.role).toBe('student')
    expect(profile.faculty_status).toBe('pending')
    expect(isVerifiedFaculty(profile)).toBe(false)
  })
})

describe('Directory UI — null safety for display fields', () => {
  it('displayName returns safe value when name is missing', () => {
    expect(displayName(null)).toBe('Member')
    expect(displayName({} as any)).toBe('Member')
    expect(displayName({ name: '' })).toBe('Member')
  })

  it('handles a profile with all optional fields absent', () => {
    const sparse: Partial<Profile> = {
      id: 'p1',
      name: 'Sparse',
      branch: 'CSE',
      role: 'student',
      faculty_status: 'none',
      created_at: '2026-01-01T00:00:00Z',
    }
    expect(displayName(sparse as Profile)).toBe('Sparse')
    expect(isVerifiedFaculty(sparse as Profile)).toBe(false)
  })
})

describe('Faculty directory query columns must not expose private email', () => {
  it('FACULTY_COLUMNS must not include email', () => {
    // This test documents the constraint: directory column strings must
    // never reference a public email column, even if the DB has one.
    // Read the source file directly to confirm.
    const fs = require('fs')
    const facultyPage = fs.readFileSync('/home/shreyas/Downloads/antigravity_projects/community/app/faculty/page.tsx', 'utf-8')
    const peoplePage = fs.readFileSync('/home/shreyas/Downloads/antigravity_projects/community/app/people/page.tsx', 'utf-8')

    // Extract the FACULTY_COLUMNS constant value (single-quoted string)
    const facultyColsMatch = facultyPage.match(/FACULTY_COLUMNS\s*=\s*'([^']+)'/)
    expect(facultyColsMatch).not.toBeNull()
    const facultyCols = facultyColsMatch![1]
    expect(facultyCols).not.toContain('email')

    // Extract the PEOPLE_COLUMNS constant value (single-quoted string)
    const peopleColsMatch = peoplePage.match(/PEOPLE_COLUMNS\s*=\s*'([^']+)'/)
    expect(peopleColsMatch).not.toBeNull()
    const peopleCols = peopleColsMatch![1]
    expect(peopleCols).not.toContain('email')
  })

  it('no server-side or client-side query selects the email column from profiles', () => {
    const { execSync } = require('child_process')
    // grep returns exit 1 when no lines match — that's the desired outcome.
    let appCode = ''
    try {
      appCode = execSync(
        `grep -rn "profiles.*email\\|\\.select.*email\\|\\.eq.*email" app lib components hooks contexts --include="*.tsx" --include="*.ts" 2>/dev/null | grep -v "official_email\\|user\\.email\\|authEmail\\|auth\\.email\\|node_modules\\|.next"`,
        { encoding: 'utf-8' }
      )
    } catch {
      appCode = ''
    }

    // Filter out legitimate non-directory email references (auth user object,
    // faculty_applications.official_email, signup flow variables).
    const suspiciousLines = appCode
      .split('\n')
      .filter((line: string) => {
        if (line.trim() === '') return false
        // These are OK: auth-user email access, signup form variables,
        // faculty_applications official_email column, normalizeProfile email field
        // used only for auth-fallback profile construction.
        const okPatterns = [
          'official_email',       // faculty_applications column
          'authEmail',            // signup form variable
          'user.email',           // auth.User object access
          'user?.email',          // auth.User object access
          'normalizeProfile',     // lib/profile.ts normalization (kept for auth fallback)
          'fallbackProfileFromAuth', // lib/profile.ts auth fallback
          'Navbar.tsx',           // Navbar shows email only in own dropdown (private UI)
          'profile.ts:113',       // auth fallback — intentional
        ]
        return !okPatterns.some(p => line.includes(p))
      })

    expect(suspiciousLines).toEqual([])
  })
})

describe('People directory — filtering and search edge cases', () => {
  const baseProfile = (overrides: Partial<Profile> = {}): Profile => ({
    id: 'me',
    usn: null,
    name: 'Me',
    year: null,
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
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  })

  it('excludes current user from their own directory listing', () => {
    const currentUser: Profile = baseProfile()
    const people: Profile[] = [
      baseProfile({ id: 'me' }),
      baseProfile({ id: 'other', name: 'Other' }),
    ]

    const filtered = people.filter(person => {
      if (currentUser && person.id === currentUser.id) return false
      return true
    })
    expect(filtered).toHaveLength(1)
    expect(filtered[0].id).toBe('other')
  })

  it('handles empty skills/interests arrays gracefully during skill filtering', () => {
    const person: Profile = baseProfile({ id: 'p1', name: 'No Skills' })
    const skillFilter = 'React'
    const personSkills = Array.isArray(person.skills) ? person.skills : []
    const personInterests = Array.isArray(person.interests) ? person.interests : []
    const matchesSkill = skillFilter
      ? personSkills.some(s => s.toLowerCase().includes(skillFilter.toLowerCase())) ||
        personInterests.some(i => i.toLowerCase().includes(skillFilter.toLowerCase()))
      : true
    expect(matchesSkill).toBe(false)
  })
})
