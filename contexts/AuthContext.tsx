'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { User, Session } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import { Profile } from '@/lib/types'
import { fallbackProfileFromAuth, normalizeProfile } from '@/lib/profile'

interface AuthContextType {
  user: User | null
  session: Session | null
  profile: Profile | null
  loading: boolean
  error: string | null
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  profile: null,
  loading: true,
  error: null,
  signOut: async () => {},
  refreshProfile: async () => {},
})

/**
 * Log a Supabase error object with all available detail fields.
 * Supabase errors carry message, code, details, and hint — log
 * each one so operators can distinguish constraint violations
 * from transient failures.
 */
function logSupabaseError(label: string, err: unknown): void {
  if (!err || typeof err !== 'object') {
    // Log unexpected non-object errors with message if available
    const message = typeof err === 'object' ? JSON.stringify(err) : String(err)
    console.error(`${label}: ${message}`)
    return
  }
  const e = err as Record<string, unknown>
  console.error(`${label}:`, {
    message: e.message,
    code: e.code,
    details: e.details,
    hint: e.hint,
  })
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const supabase = useMemo(() => createClient(), [])
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchProfile = useCallback(async (authUser: User) => {
    // 1. Select existing profile first — never assume it needs to be created.
    const { data, error: queryError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', authUser.id)
      .maybeSingle()

    if (queryError) {
      logSupabaseError('Profile fetch error', queryError)
      setError(queryError.message ?? 'Failed to load profile')
      setProfile(fallbackProfileFromAuth(authUser))
      return
    }

    if (data) {
      setError(null)
      setProfile(normalizeProfile(data as Record<string, unknown>))
      return
    }

    // 2. Profile does not exist — attempt to create it.
    //    This is a safety net for edge cases where the trigger
    //    did not fire (e.g. auth user created outside the normal
    //    sign-up flow). The trigger remains the primary path.
    const fallback = fallbackProfileFromAuth(authUser)
    const { error: insertError } = await supabase.from('profiles').insert({
      id: fallback.id,
      email: fallback.email,
      name: fallback.name,
      usn: fallback.usn,
      year: fallback.year,
      branch: fallback.branch,
      section: fallback.section,
      skills: fallback.skills,
      interests: fallback.interests,
      role: 'student',
      faculty_status: fallback.faculty_status,
      designation: null,
      employee_id: null,
      expertise: [],
    })

    // 3. Log ALL Supabase error fields individually.
    if (insertError) {
      logSupabaseError('Profile insert error', insertError)
      // Do NOT silently treat a failed insert as success.
      // Set the error so the caller knows provisioning failed.
      setError(insertError.message ?? 'Failed to create profile')
      // Still attempt a select in case the row was created by a
      // race-condition retry of the trigger.
    }

    const { data: created, error: selectError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', authUser.id)
      .maybeSingle()

    if (selectError) {
      logSupabaseError('Profile re-fetch error', selectError)
      setProfile(normalizeProfile(created as Record<string, unknown> | null) ?? fallback)
      return
    }

    setProfile(normalizeProfile(created as Record<string, unknown> | null) ?? fallback)

    // If a profile was created but looks incomplete (missing role),
    // retry once after a short delay to pick up any schema-cache lag.
    if (created && !created.role) {
      setTimeout(() => {
        if (authUser) fetchProfile(authUser)
      }, 500)
    }
  }, [supabase])

  const refreshProfile = useCallback(async () => {
    if (user) await fetchProfile(user)
  }, [fetchProfile, user])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setUser(null)
    setSession(null)
    setProfile(null)
  }, [supabase])

  useEffect(() => {
    let cancelled = false

    supabase.auth.getSession().then(async ({ data: { session: nextSession }, error: sessionError }) => {
      if (cancelled) return
      if (sessionError) {
        logSupabaseError('Session error', sessionError)
        setError(sessionError.message)
      }
      setSession(nextSession)
      setUser(nextSession?.user ?? null)
      if (nextSession?.user) {
        await fetchProfile(nextSession.user)
      } else {
        setProfile(null)
      }
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, nextSession) => {
      setSession(nextSession)
      setUser(nextSession?.user ?? null)
      if (nextSession?.user) {
        await fetchProfile(nextSession.user)
      } else {
        setProfile(null)
      }
      setLoading(false)
    })

    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [fetchProfile, supabase])

  return (
    <AuthContext.Provider value={{ user, session, profile, loading, error, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
