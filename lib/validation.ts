import { validateUSN } from '@/lib/utils'

export const BIO_MAX_LENGTH = 600
export const NAME_MAX_LENGTH = 80

export function sanitizeText(value: string, max = 4000): string {
  return value.replace(/\u0000/g, '').trim().slice(0, max)
}

export function validateStudentSignup(input: {
  name: string
  email: string
  password: string
  confirmPassword: string
  usn: string
  year: number
  section?: string
}): string | null {
  if (!input.name.trim()) return 'Please enter your full name.'
  if (input.name.trim().length < 2) return 'Name must be at least 2 characters.'
  if (!input.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) {
    return 'Please enter a valid email address.'
  }
  if (!validateUSN(input.usn)) return 'Invalid USN. Expected format: 4UB24CS045'
  if (![1, 2, 3, 4].includes(input.year)) return 'Select a valid academic year.'
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

export function parseTagList(value: string): string[] {
  return value
    .split(',')
    .map(item => item.trim().replace(/^#/, ''))
    .filter(Boolean)
    .slice(0, 20)
}
