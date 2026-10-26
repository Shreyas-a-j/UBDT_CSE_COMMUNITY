import { describe, it, expect } from 'vitest'
import {
  normalizeAdmissionNumber,
  validateAcademicYear,
  validateAdmissionNumber,
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

describe('student signup validation', () => {
  const yy = String(currentYear % 100).padStart(2, '0')
  const base = {
    name: 'Rahul Sharma',
    email: 'rahul@example.com',
    password: 'secret1',
    confirmPassword: 'secret1',
    usn: `4UB${yy}CS045`,
    year: 2,
  }

  it('accepts a valid year 2-4 USN', () => {
    expect(validateStudentSignup(base)).toBeNull()
  })

  it('requires a USN for years 2-4 even with an admission number', () => {
    expect(validateStudentSignup({ ...base, usn: '' })).toMatch(/USN is required/i)
    expect(
      validateStudentSignup({ ...base, usn: '', admissionNumber: 'ADM-2026-001' }),
    ).toMatch(/USN is required/i)
  })

  it('accepts a first-year admission number without a USN', () => {
    expect(
      validateStudentSignup({ ...base, usn: '', year: 1, admissionNumber: 'ADM-2026-001' }),
    ).toBeNull()
  })

  it('rejects a first-year student with neither identifier', () => {
    expect(validateStudentSignup({ ...base, usn: '', year: 1 })).toMatch(
      /either a USN or an admission number/i,
    )
  })

  it('rejects an invalid USN even when the admission number is valid', () => {
    expect(
      validateStudentSignup({
        ...base,
        usn: 'NOT-A-USN',
        year: 1,
        admissionNumber: 'ADM-2026-001',
      }),
    ).toMatch(/invalid USN/i)
  })

  it('rejects an invalid admission number', () => {
    expect(
      validateStudentSignup({ ...base, usn: '', year: 1, admissionNumber: 'A B' }),
    ).toMatch(/valid admission number/i)
  })

  it('normalizes admission numbers by trimming and uppercasing', () => {
    expect(normalizeAdmissionNumber('  adm-2026-001  ')).toBe('ADM-2026-001')
    expect(validateAdmissionNumber('  adm-2026-001  ')).toBe(true)
  })

  it('enforces the 4-24 character admission-number length', () => {
    expect(validateAdmissionNumber('ADM1')).toBe(true)
    expect(validateAdmissionNumber(`A${'B'.repeat(22)}C`)).toBe(true)
    expect(validateAdmissionNumber('AB1')).toBe(false)
    expect(validateAdmissionNumber(`A${'B'.repeat(23)}C`)).toBe(false)
    expect(validateAdmissionNumber('-ABC')).toBe(false)
    expect(validateAdmissionNumber('ABC-')).toBe(false)
  })
})

describe('faculty signup validation', () => {
  it('still requires designation and department', () => {
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

describe('validateAcademicYear', () => {
  it('accepts 1 through 4', () => {
    for (const year of [1, 2, 3, 4]) {
      expect(validateAcademicYear(year)).toBeNull()
    }
  })

  it('rejects out-of-range, fractional, string and missing values', () => {
    for (const year of [0, 5, 1.5, '2', null, undefined, NaN]) {
      expect(validateAcademicYear(year)).toBe('Select a valid academic year.')
    }
  })
})
