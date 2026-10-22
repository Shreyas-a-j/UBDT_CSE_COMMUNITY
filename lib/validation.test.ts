import { describe, it, expect } from 'vitest'
import {
  validateAlumniSignup,
  validateFacultySignup,
  validateStudentSignup,
} from './validation'

const currentYear = new Date().getFullYear()

function alumniInput(overrides: Partial<Parameters<typeof validateAlumniSignup>[0]> = {}) {
  return {
    name: 'Asha Rao',
    email: 'asha.rao@example.com',
    password: 'secret1',
    confirmPassword: 'secret1',
    graduationYear: 2024,
    ...overrides,
  }
}

describe('validateAlumniSignup', () => {
  it('accepts an alumnus without a USN', () => {
    expect(validateAlumniSignup(alumniInput())).toBeNull()
  })

  it('accepts the earliest and current graduation years', () => {
    expect(validateAlumniSignup(alumniInput({ graduationYear: 1950 }))).toBeNull()
    expect(validateAlumniSignup(alumniInput({ graduationYear: currentYear }))).toBeNull()
  })

  it('rejects a graduation year before 1950', () => {
    expect(validateAlumniSignup(alumniInput({ graduationYear: 1949 }))).toMatch(
      /graduation year/i,
    )
  })

  it('rejects a future graduation year', () => {
    expect(validateAlumniSignup(alumniInput({ graduationYear: currentYear + 1 }))).toMatch(
      /graduation year/i,
    )
  })

  it('rejects a non-integer graduation year', () => {
    expect(validateAlumniSignup(alumniInput({ graduationYear: 2024.5 }))).toMatch(
      /graduation year/i,
    )
  })

  it('still requires a name, email, and matching passwords', () => {
    expect(validateAlumniSignup(alumniInput({ name: ' ' }))).toMatch(/name/i)
    expect(validateAlumniSignup(alumniInput({ email: 'not-an-email' }))).toMatch(/email/i)
    expect(validateAlumniSignup(alumniInput({ password: 'short' }))).toMatch(/password/i)
    expect(
      validateAlumniSignup(alumniInput({ confirmPassword: 'different' })),
    ).toMatch(/passwords do not match/i)
  })
})

describe('student and faculty signup validation remain unchanged', () => {
  it('student signup still requires a valid USN', () => {
    const yy = String(currentYear % 100).padStart(2, '0')
    const valid = {
      name: 'Rahul Sharma',
      email: 'rahul@example.com',
      password: 'secret1',
      confirmPassword: 'secret1',
      usn: `4UB${yy}CS045`,
      year: 2,
    }

    expect(validateStudentSignup(valid)).toBeNull()
    expect(validateStudentSignup({ ...valid, usn: '' })).toMatch(/invalid usn/i)
  })

  it('faculty signup still requires designation and department', () => {
    const valid = {
      name: 'Dr. Anita Sharma',
      email: 'anita@ubdt.ac.in',
      password: 'secret1',
      confirmPassword: 'secret1',
      designation: 'Assistant Professor',
      department: 'CSE',
    }

    expect(validateFacultySignup(valid)).toBeNull()
    expect(validateFacultySignup({ ...valid, designation: '' })).toMatch(/designation/i)
    expect(validateFacultySignup({ ...valid, department: '' })).toMatch(/department/i)
  })
})
