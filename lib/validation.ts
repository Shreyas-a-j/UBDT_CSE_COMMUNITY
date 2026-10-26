import { validateUSN } from '@/lib/utils'

export const BIO_MAX_LENGTH = 600
export const NAME_MAX_LENGTH = 80

export function sanitizeText(value: string, max = 4000): string {
  return value.replace(/\u0000/g, '').trim().slice(0, max)
}

export const ADMISSION_NUMBER_PATTERN = /^[A-Z0-9][A-Z0-9/-]{2,22}[A-Z0-9]$/

export function normalizeAdmissionNumber(value: string): string {
  return value.trim().toUpperCase()
}

export function validateAdmissionNumber(value: string): boolean {
  return ADMISSION_NUMBER_PATTERN.test(normalizeAdmissionNumber(value))
}

export function validateStudentSignup(input: {
  name: string
  email: string
  password: string
  confirmPassword: string
  usn: string
  admissionNumber?: string
  year: number
  section?: string
}): string | null {
  if (!input.name.trim()) return 'Please enter your full name.'
  if (input.name.trim().length < 2) return 'Name must be at least 2 characters.'
  if (!input.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) {
    return 'Please enter a valid email address.'
  }
  const usn = input.usn.trim()
  const admissionNumber = (input.admissionNumber ?? '').trim()
  if (usn && !validateUSN(usn)) return 'Invalid USN. Expected format: 4UB24CS045'
  if (admissionNumber && !validateAdmissionNumber(admissionNumber)) {
    return 'Enter a valid admission number. Use 4-24 letters, digits, hyphens or slashes.'
  }
  if (![1, 2, 3, 4].includes(input.year)) return 'Select a valid academic year.'
  if (input.year === 1 && !usn && !admissionNumber) {
    return 'First-year students need either a USN or an admission number.'
  }
  if (input.year !== 1 && !usn) {
    return 'A USN is required for students in years 2-4.'
  }
  if (!input.password || input.password.length < 6) return 'Password must be at least 6 characters.'
  if (input.password !== input.confirmPassword) return 'Passwords do not match.'
  return null
}

export function validateFacultySignup(input: {
  name: string
  email: string
  password: string
  confirmPassword: string
  designation: string
  department: string
}): string | null {
  if (!input.name.trim()) return 'Please enter your full name.'
  if (!input.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) {
    return 'Please enter a valid institutional email.'
  }
  if (!input.designation.trim()) return 'Please enter your designation.'
  if (!input.department.trim()) return 'Please enter your department.'
  if (!input.password || input.password.length < 6) return 'Password must be at least 6 characters.'
  if (input.password !== input.confirmPassword) return 'Passwords do not match.'
  return null
}

export function validateAlumniSignup(input: {
  name: string
  email: string
  password: string
  confirmPassword: string
  graduationYear: number
  section?: string
}): string | null {
  if (!input.name.trim()) return 'Please enter your full name.'
  if (input.name.trim().length < 2) return 'Name must be at least 2 characters.'
  if (!input.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) {
    return 'Please enter a valid email address.'
  }
  const currentYear = new Date().getFullYear()
  if (!Number.isInteger(input.graduationYear) || input.graduationYear < 1950 || input.graduationYear > currentYear) {
    return `Graduation year must be between 1950 and ${currentYear}.`
  }
  if (!input.password || input.password.length < 6) return 'Password must be at least 6 characters.'
  if (input.password !== input.confirmPassword) return 'Passwords do not match.'
  return null
}

export function validateAcademicYear(year: unknown): string | null {
  return typeof year === 'number' && Number.isInteger(year) && year >= 1 && year <= 4
    ? null
    : 'Select a valid academic year.'
}

export function parseTagList(value: string): string[] {
  return value
    .split(',')
    .map(item => item.trim().replace(/^#/, ''))
    .filter(Boolean)
    .slice(0, 20)
}
