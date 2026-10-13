import { validateUSN } from '@/lib/utils'

export const MESSAGE_MAX_LENGTH = 4000
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

export function validateMessageBody(body: string): string | null {
  const text = sanitizeText(body, MESSAGE_MAX_LENGTH)
  if (!text) return 'Message cannot be empty.'
  if (text.length > MESSAGE_MAX_LENGTH) return `Messages must be ${MESSAGE_MAX_LENGTH} characters or fewer.`
  return null
}

export function parseTagList(value: string): string[] {
  return value
    .split(',')
    .map(item => item.trim().replace(/^#/, ''))
    .filter(Boolean)
    .slice(0, 20)
}
