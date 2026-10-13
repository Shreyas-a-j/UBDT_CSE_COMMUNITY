import { afterEach, beforeEach, vi } from 'vitest'

// Mock console.error to suppress expected warnings and test our error handling
const originalError = console.error

beforeEach(() => {
  // Suppress Supabase error logging during tests
  console.error = vi.fn((...args) => {
    // Only log unexpected errors
    if (
      typeof args[0] === 'string' &&
      (args[0].includes('[FacultyApp] insert failed') ||
       args[0].includes('[ERROR]'))
    ) {
      originalError(...args)
    }
  })
})

afterEach(() => {
  console.error = originalError
})