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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const supabase = useMemo(() => createClient(), [])
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchProfile = useCallback(async (authUser: User) => {
    const { data, error: queryError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', authUser.id)
      .maybeSingle()

    if (queryError) {
      setError(queryError.message)
      setProfile(fallbackProfileFromAuth(authUser))
      return
    }

    if (data) {
      setError(null)
      setProfile(normalizeProfile(data as Record<string, unknown>))
      return
    }

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
    })
    if (insertError && !insertError.message.toLowerCase().includes('duplicate')) {
      setError(insertError.message)
    }
    const { data: created } = await supabase.from('profiles').select('*').eq('id', authUser.id).maybeSingle()
    setProfile(normalizeProfile(created as Record<string, unknown> | null) ?? fallback)
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
      if (sessionError) setError(sessionError.message)
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
