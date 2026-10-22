'use client';

/**
 * Auth context — React Native port of the web app's `contexts/AuthContext.tsx`
 * (see docs/mobile/MILESTONE_1_AUDIT.md §4). Behavior preserved:
 *
 * 1. `getSession()` bootstrap → profile fetch; plus an `onAuthStateChange`
 *    subscription keeping user/session/profile in sync.
 * 2. Profile load first does a `maybeSingle()` select — never assumes the
 *    row exists. Missing row → propagate auth metadata into a fallback
 *    profile provision via client-side insert (safety net for signups that
 *    bypass the `handle_new_user()` trigger); failed inserts surface an
 *    error, and a re-select decides the truth (trigger races).
 * 3. A profile that was just created without a `role` is re-fetched once
 *    after 500 ms to tolerate schema-cache lag.
 * 4. Errors are logged through the same safe field whitelist as
 *    `lib/supabase/errors.ts` on the web — tokens and keys are never logged.
 *
 * Milestone-1 adaptations for native (documented in the audit §6):
 * - sign-in lives here (`signInWithPassword`) with the same credential
 *   message mapping as the web sign-in page;
 * - session persistence is via expo-secure-store (src/lib/supabase.ts);
 * - sign-out also clears in-memory state; secure storage is cleared by
 *   supabase-js itself.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { logSupabaseError } from './errors';
import { fallbackProfileFromAuth, normalizeProfile } from './profile';
import type { Profile } from './types';
import { supabase } from './supabase';
export interface AuthState {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  /** True until the initial session check (and profile fetch) completes. */
  loading: boolean;
  /** Error from session restore or profile loading, if any. */
  error: string | null;
  signIn: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  user: null,
  session: null,
  profile: null,
  loading: true,
  error: null,
  signIn: async () => null,
  signOut: async () => {},
  refreshProfile: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fetchProfileRef = useRef<((authUser: User) => Promise<void>) | null>(null);
  const lastProfileUserIdRef = useRef<string | null>(null);

  const fetchProfile = useCallback(async (authUser: User) => {
    // 1. Select the existing profile first — never assume it needs creating.
    const { data, error: queryError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', authUser.id)
      .maybeSingle();

    if (queryError) {
      logSupabaseError('Profile fetch error', queryError);
      setError(queryError.message ?? 'Failed to load profile');
      setProfile(fallbackProfileFromAuth(authUser));
      return;
    }

    if (data) {
      setError(null);
      setProfile(normalizeProfile(data as Record<string, unknown>));
      return;
    }

    // 2. Profile row does not exist — attempt to create it. This is a
    //    safety net for the edge case where the sign-up trigger did not
    //    fire; the trigger remains the primary path.
    const fallback = fallbackProfileFromAuth(authUser);
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
    });

    // 3. Log all Supabase error fields; a failed insert must not be
    //    treated as success.
    if (insertError) {
      logSupabaseError('Profile insert error', insertError);
      setError(insertError.message ?? 'Failed to create profile');
    }

    const { data: created, error: selectError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', authUser.id)
      .maybeSingle();

    if (selectError) {
      logSupabaseError('Profile re-fetch error', selectError);
      setProfile(normalizeProfile(created as Record<string, unknown> | null) ?? fallback);
      return;
    }

    setProfile(normalizeProfile(created as Record<string, unknown> | null) ?? fallback);

    // A profile created without a role is re-fetched once to pick up any
    // schema-cache lag (same behavior as the web).
    if (created && !created.role) {
      setTimeout(() => {
        void fetchProfileRef.current?.(authUser);
      }, 500);
    }
  }, []);

  useEffect(() => {
    fetchProfileRef.current = (authUser: User) => {
      lastProfileUserIdRef.current = authUser.id;
      return fetchProfile(authUser);
    };
  }, [fetchProfile]);

  const refreshProfile = useCallback(async () => {
    if (user) await fetchProfile(user);
  }, [fetchProfile, user]);

  const signIn = useCallback(async (email: string, password: string): Promise<string | null> => {
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (signInError) {
      logSupabaseError('Sign-in error', signInError);
      const msg = signInError.message ?? '';
      if (msg.toLowerCase().includes('email not confirmed')) {
        return 'Your email is not confirmed. Please check your inbox.';
      }
      if (
        msg.toLowerCase().includes('invalid login credentials') ||
        msg.toLowerCase().includes('invalid credentials')
      ) {
        return 'Wrong email or password. Double-check and try again.';
      }
      return msg || 'Sign in failed. Please try again.';
    }

    // On success the onAuthStateChange listener sets user/session/profile
    // and consumers navigate accordingly.
    return null;
  }, []);

  const signOut = useCallback(async () => {
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) {
      logSupabaseError('Sign-out error', signOutError);
    }
    // The listener clears session/profile on SIGNED_OUT; clear explicitly
    // as well so a signOut without a listener event still resets the UI.
    lastProfileUserIdRef.current = null;
    setUser(null);
    setSession(null);
    setProfile(null);
    setError(null);
  }, []);

  useEffect(() => {
    let cancelled = false;

    supabase.auth
      .getSession()
      .then(async ({ data: { session: nextSession }, error: sessionError }) => {
        if (cancelled) return;
        if (sessionError) {
          logSupabaseError('Session restore error', sessionError);
          setError(sessionError.message);
        }
        setSession(nextSession);
        setUser(nextSession?.user ?? null);
        if (nextSession?.user) {
          await fetchProfile(nextSession.user);
        } else {
          setProfile(null);
        }
        setLoading(false);
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, nextSession) => {
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      if (nextSession?.user) {
        // Skip a duplicate concurrent fetch for the same user, so the
        // initial getSession() + INITIAL_SESSION pair doesn't double-fetch.
        if (lastProfileUserIdRef.current === nextSession.user.id && !cancelled) return;
        await fetchProfile(nextSession.user);
      } else {
        lastProfileUserIdRef.current = null;
        setProfile(null);
      }
      setLoading(false);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [fetchProfile]);

  const value = useMemo<AuthState>(
    () => ({ user, session, profile, loading, error, signIn, signOut, refreshProfile }),
    [user, session, profile, loading, error, signIn, signOut, refreshProfile]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
