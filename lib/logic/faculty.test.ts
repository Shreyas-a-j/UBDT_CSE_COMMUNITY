import { describe, expect, it } from 'vitest'
import {
  buildFacultyApplicationRow,
  buildFacultySignupMetadata,
  canReviewFacultyApplications,
  classifyFacultyApplicationInsert,
  facultyOnboardingState,
} from './faculty'

/**
 * These tests pin the onboarding rules that the UI relies on. They do not
 * replace the database tests: RLS and the transition trigger remain the only
 * authorisation boundary. What they protect here is that the client never
 * describes a pending/rejected account as approved and never sends privileged
 * columns to the database.
 */

const student = { role: 'student', faculty_status: 'none', member_type: 'student' } as const
const alumni = { role: 'student', faculty_status: 'none', member_type: 'alumni' } as const
const pending = { role: 'student', faculty_status: 'pending', member_type: 'student' } as const
const rejected = { role: 'student', faculty_status: 'rejected', member_type: 'student' } as const
const approved = { role: 'faculty', faculty_status: 'approved', member_type: 'faculty' } as const
const legacyApproved = {
  role: 'faculty',
  faculty_status: 'verified',
  member_type: 'faculty',
} as const
const admin = { role: 'admin', faculty_status: 'none', member_type: 'faculty' } as const

describe('facultyOnboardingState', () => {
  it('reports no state for a missing profile', () => {
    expect(facultyOnboardingState(null)).toBe('none')
    expect(facultyOnboardingState(undefined)).toBe('none')
  })

  it('keeps students and alumni distinct', () => {
    expect(facultyOnboardingState(student)).toBe('student')
    expect(facultyOnboardingState(alumni)).toBe('alumni')
  })

  it('reports pending and rejected applications before member type', () => {
    // An alumnus who applies for faculty is waiting on the application, not
    // simply browsing as an alumnus.
    expect(facultyOnboardingState(pending)).toBe('pending')
    expect(facultyOnboardingState({ ...pending, member_type: 'alumni' })).toBe('pending')
    expect(facultyOnboardingState(rejected)).toBe('rejected')
  })

  it('reports approved for both approval vocabularies', () => {
    expect(facultyOnboardingState(approved)).toBe('approved')
    expect(facultyOnboardingState(legacyApproved)).toBe('approved')
    expect(facultyOnboardingState(admin)).toBe('approved')
  })

  it('never treats a self-declared faculty member type as approved', () => {
    expect(
      facultyOnboardingState({
        role: 'student',
        faculty_status: 'none',
        member_type: 'faculty',
      }),
    ).toBe('student')
  })
})

describe('canReviewFacultyApplications', () => {
  it('allows only administrators', () => {
    expect(canReviewFacultyApplications(admin as never)).toBe(true)
    expect(canReviewFacultyApplications(approved as never)).toBe(false)
    expect(canReviewFacultyApplications(pending as never)).toBe(false)
    expect(canReviewFacultyApplications(null)).toBe(false)
  })
})

describe('buildFacultySignupMetadata', () => {
  it('sends identity fields and the faculty intent only', () => {
    const metadata = buildFacultySignupMetadata({
      name: '  Dr. Anita Sharma  ',
      department: ' CSE ',
      designation: ' Assistant Professor ',
      employeeId: '  UBDT-FAC-042  ',
    })

    expect(metadata).toEqual({
      name: 'Dr. Anita Sharma',
      department: 'CSE',
      designation: 'Assistant Professor',
      employee_id: 'UBDT-FAC-042',
      intent: 'faculty',
    })
    expect(Object.keys(metadata).sort()).toEqual([
      'department',
      'designation',
      'employee_id',
      'intent',
      'name',
    ])
  })

  it('cannot carry role, status, reviewer or member-type fields', () => {
    const metadata = buildFacultySignupMetadata({
      name: 'Anita',
      department: 'CSE',
      designation: 'Professor',
      // A caller trying to smuggle privileged fields through the helper.
      ...({ role: 'admin', faculty_status: 'approved', status: 'approved' } as object),
    })

    expect(metadata).not.toHaveProperty('role')
    expect(metadata).not.toHaveProperty('faculty_status')
    expect(metadata).not.toHaveProperty('status')
    expect(metadata).not.toHaveProperty('member_type')
    expect(metadata).not.toHaveProperty('reviewed_by')
    expect(metadata).not.toHaveProperty('reviewed_at')
  })

  it('normalises an empty employee id to null', () => {
    expect(
      buildFacultySignupMetadata({
        name: 'Anita',
        department: 'CSE',
        designation: 'Professor',
        employeeId: '   ',
      }).employee_id,
    ).toBeNull()
  })
})

describe('buildFacultyApplicationRow', () => {
  it('always creates a pending row with no reviewer fields', () => {
    const row = buildFacultyApplicationRow('user-1', ' anita@ubdt.ac.in ', {
      name: ' Anita Sharma ',
      department: ' CSE ',
      designation: ' Professor ',
      employeeId: ' F-1 ',
    })

    expect(row).toEqual({
      user_id: 'user-1',
      full_name: 'Anita Sharma',
      official_email: 'anita@ubdt.ac.in',
      department: 'CSE',
      designation: 'Professor',
      employee_id: 'F-1',
      status: 'pending',
    })
    expect(row).not.toHaveProperty('reviewed_by')
    expect(row).not.toHaveProperty('reviewed_at')
    expect(row).not.toHaveProperty('role')
    expect(row).not.toHaveProperty('faculty_status')
  })
})

describe('classifyFacultyApplicationInsert', () => {
  it('treats a successful insert and an existing pending row as success', () => {
    expect(classifyFacultyApplicationInsert(null)).toBe('created')
    // 23505 is the unique index on one pending application per user. The
    // signup trigger winning the race must not look like an error.
    expect(classifyFacultyApplicationInsert({ code: '23505' })).toBe('already-pending')
  })

  it('maps a missing profile and any other failure separately', () => {
    expect(classifyFacultyApplicationInsert({ code: '23503' })).toBe('profile-not-ready')
    expect(classifyFacultyApplicationInsert({ code: '42501' })).toBe('failed')
    expect(classifyFacultyApplicationInsert({ code: null })).toBe('failed')
  })
})
