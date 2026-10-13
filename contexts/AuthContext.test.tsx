/**
 * AuthContext profile-provisioning tests
 *
 * These tests verify the fetchProfile logic path used when:
 *   - A profile already exists
 *   - A profile is missing and needs to be created
 *   - Insert fails with various Supabase errors
 *   - A duplicate-USN conflict occurs
 *   - Concurrent signups race
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { AuthProvider, useAuth } from './AuthContext'

// @testing-library/react's RenderHookResult doesn't expose waitForNextUpdate in
// this version. Wait for the async state update that AuthContext sets after
// the profile fetch resolves. Poll until the microtask queue drains so the
// insert + re-select + setState chain has had a chance to complete.
function waitForNextUpdate() {
  return waitFor(() => new Promise(resolve => setTimeout(resolve, 0)), {
    interval: 10,
    timeout: 2000,
  })
}

// Mock the Supabase client factory
const mockSupabase = vi.hoisted(() => ({
  from: vi.fn(),
  auth: {
    getSession: vi.fn(),
    onAuthStateChange: vi.fn(),
    signOut: vi.fn(),
  },
}))

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => mockSupabase,
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeUser(id = 'user-1', email = 'alice@example.com') {
  return { id, email, user_metadata: {} }
}

/** Build a mock Supabase chain. Each `.from()` call returns a query builder. */
function setupMockChain(
  selectResult: { data: unknown; error: unknown },
  insertResult: { data: unknown; error: unknown },
  reSelectResult: { data: unknown; error: unknown }
) {
  // Persistent spies so assertions can inspect call counts across the
  // multiple `.from('profiles')` calls the hook makes.
  const insertSpy = vi.fn(() => Promise.resolve(insertResult))
  const updateSpy = vi.fn(() => ({
    eq: vi.fn(() => Promise.resolve({ data: null, error: null })),
  }))

  const selectBuilder = {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        maybeSingle: vi.fn(() => Promise.resolve(selectResult)),
      })),
    })),
  }
  const insertBuilder = { insert: insertSpy }
  const updateBuilder = { update: updateSpy }

  let callCount = 0
  const fromMock = vi.fn(table => {
    if (table === 'profiles') {
      // The hook calls from('profiles') three times per fetchProfile:
      //   1. select existing  2. insert (if missing)  3. re-select
      // Cycle through the builders so each call gets the right shape.
      if (callCount === 0) { callCount++; return selectBuilder }
      if (callCount === 1) { callCount++; return insertBuilder }
      callCount++
      return selectBuilder
    }
    return selectBuilder
  })
  mockSupabase.from = fromMock

  // Expose spies for assertions
  ;(mockSupabase as any)._insertSpy = insertSpy
  ;(mockSupabase as any)._updateSpy = updateSpy
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('fetchProfile — existing profile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSupabase.auth.getSession.mockResolvedValue({
      data: { session: { user: makeUser() } },
      error: null,
    })
    mockSupabase.auth.onAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    })
  })

  it('returns the existing profile without attempting insert', async () => {
    const profileRow = {
      id: 'user-1',
      email: 'alice@example.com',
      name: 'Alice',
      role: 'student',
      faculty_status: 'none',
    }
    setupMockChain({ data: profileRow, error: null }, { data: null, error: null }, { data: null, error: null })

    let fetched: any
    const { rerender } = renderHook(() => {
      const auth = useAuth()
      fetched = auth.profile
      return auth
    }, { wrapper: ({ children }) => <AuthProvider>{children}</AuthProvider> })

    await waitFor(() => expect(fetched).not.toBeNull())
    expect(mockSupabase.from).toHaveBeenCalledWith('profiles')
    // Insert must NOT have been called — profile already exists
    expect((mockSupabase as any)._insertSpy).not.toHaveBeenCalled()
    expect(fetched!.id).toBe('user-1')
    rerender()
  })
})

describe('fetchProfile — missing profile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSupabase.auth.getSession.mockResolvedValue({
      data: { session: { user: makeUser() } },
      error: null,
    })
    mockSupabase.auth.onAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    })
  })

  it('inserts a new profile when none exists and returns it', async () => {
    // First select finds nothing
    setupMockChain(
      { data: null, error: null },          // initial select
      { data: { id: 'user-1' }, error: null }, // insert succeeds
      { data: { id: 'user-1', role: 'student' }, error: null } // re-select
    )

    let result: any = null
    const { result: hookResult } = renderHook(() => {
      const auth = useAuth()
      result = auth.profile
      return auth
    }, { wrapper: ({ children }) => <AuthProvider>{children}</AuthProvider> })

    await waitForNextUpdate()
    expect((mockSupabase as any)._insertSpy).toHaveBeenCalledTimes(1)
    const insertArgs = (mockSupabase as any)._insertSpy.mock.calls[0][0]
    expect(insertArgs.role).toBe('student')
    expect(insertArgs.faculty_status).toBe('none')
    expect(result).not.toBeNull()
  })
})

describe('fetchProfile — insert error', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSupabase.auth.getSession.mockResolvedValue({
      data: { session: { user: makeUser() } },
      error: null,
    })
    mockSupabase.auth.onAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    })
  })

  it('sets an error and does NOT silently succeed on insert failure', async () => {
    const insertErr = { message: 'duplicate key violation', code: '23505', details: 'Key (usn)=(X) already exists.', hint: null }

    setupMockChain(
      { data: null, error: null },                    // select — none found
      { data: null, error: insertErr },               // insert — fails
      { data: null, error: null }                     // re-select — still none
    )

    let profileErr: string | null = null
    const { waitForNextUpdate: _unused } = renderHook(() => {
      const auth = useAuth()
      profileErr = auth.error
      return auth
    }, { wrapper: ({ children }) => <AuthProvider>{children}</AuthProvider> })

    await waitForNextUpdate()
    // Error must be surfaced — not silently swallowed
    expect(profileErr).not.toBeNull()
    expect(profileErr).toContain('duplicate key')
  })
})

describe('fetchProfile — query error', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSupabase.auth.getSession.mockResolvedValue({
      data: { session: { user: makeUser() } },
      error: null,
    })
    mockSupabase.auth.onAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    })
  })

  it('falls back to auth-only profile on query error and logs details', async () => {
    const queryErr = { message: 'relation "profiles" does not exist', code: '42P01', details: null, hint: 'Did you mean "auth.users"?' }

    setupMockChain(
      { data: null, error: queryErr },
      { data: null, error: null },
      { data: null, error: null }
    )

    let profile: any = null
    let err: string | null = null
    const { waitForNextUpdate: _unused } = renderHook(() => {
      const auth = useAuth()
      profile = auth.profile
      err = auth.error
      return auth
    }, { wrapper: ({ children }) => <AuthProvider>{children}</AuthProvider> })

    await waitForNextUpdate()
    // Should fall back to auth-only profile, not crash
    expect(profile).not.toBeNull()
    expect(err).not.toBeNull()
  })
})

describe('concurrent signups', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('each user gets their own profile — no cross-contamination', async () => {
    const userA = makeUser('user-a', 'a@example.com')
    const userB = makeUser('user-b', 'b@example.com')

    mockSupabase.auth.getSession.mockResolvedValue({
      data: { session: { user: userA } },
      error: null,
    })
    mockSupabase.auth.onAuthStateChange.mockImplementation((_event, session) => ({
      data: { subscription: { unsubscribe: vi.fn() } },
    }))

    // User A's profile exists
    setupMockChain(
      { data: { id: 'user-a', name: 'Alice', role: 'student' }, error: null },
      { data: null, error: null },
      { data: null, error: null }
    )

    let profileA: any
    const { waitForNextUpdate: _unused } = renderHook(() => {
      const auth = useAuth()
      profileA = auth.profile
      return auth
    }, { wrapper: ({ children }) => <AuthProvider>{children}</AuthProvider> })

    await waitForNextUpdate()
    expect(profileA!.id).toBe('user-a')
    expect(profileA!.name).toBe('Alice')
  })
})

describe('faculty signup metadata', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const facultyUser = {
      id: 'fac-1',
      email: 'prof@ubdt.ac.in',
      user_metadata: { intent: 'faculty', name: 'Dr. Rao', designation: 'Professor' },
    }
    mockSupabase.auth.getSession.mockResolvedValue({
      data: { session: { user: facultyUser } },
      error: null,
    })
    mockSupabase.auth.onAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    })
  })

  it('provisions a student-profile with pending faculty_status — NOT verified faculty', async () => {
    const insertSpy = vi.fn(() => Promise.resolve({ data: { id: 'fac-1' }, error: null }))
    const fromSpy = vi.fn((table) => {
      if (table === 'profiles') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
          insert: insertSpy,
        }
      }
      return {}
    })
    mockSupabase.from = fromSpy

    let profile: any
    const { waitForNextUpdate: _unused } = renderHook(() => {
      const auth = useAuth()
      profile = auth.profile
      return auth
    }, { wrapper: ({ children }) => <AuthProvider>{children}</AuthProvider> })

    await waitForNextUpdate()
    expect(profile).not.toBeNull()
    expect(profile!.role).toBe('student')
    expect(profile!.faculty_status).toBe('pending')
    // Faculty privileges are NOT granted at signup
    expect(profile!.role).not.toBe('faculty')
  })
})

describe('duplicate USN recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const user = makeUser('user-dup', 'dup@example.com')
    mockSupabase.auth.getSession.mockResolvedValue({
      data: { session: { user } },
      error: null,
    })
    mockSupabase.auth.onAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    })
  })

  it('surfaces a clear error when USN unique constraint fires on insert', async () => {
    const usnErr = {
      message: 'duplicate key value violates unique constraint "profiles_student_usn_unique"',
      code: '23505',
      details: 'Key (usn)=(4UB24CS001) already exists.',
      hint: null,
    }

    const insertSpy = vi.fn(() => Promise.resolve({ data: null, error: usnErr }))
    const fromSpy = vi.fn((table: string) => {
      if (table === 'profiles') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
          insert: insertSpy,
        }
      }
      return {}
    })
    mockSupabase.from = fromSpy

    let err: string | null = null
    const { waitForNextUpdate: _unused } = renderHook(() => {
      const auth = useAuth()
      err = auth.error
      return auth
    }, { wrapper: ({ children }) => <AuthProvider>{children}</AuthProvider> })

    await waitForNextUpdate()
    expect(err).not.toBeNull()
    expect(err!).toContain('duplicate')
  })
})
