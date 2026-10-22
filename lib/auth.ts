/**
 * Canonical authentication routing.
 *
 * Every Sign In / Sign Up entry point — navbar links, profile prompts,
 * middleware redirects, the OAuth callback fallback and the (now removed)
 * auth modal — funnels to the single canonical page at `/signin`.
 *
 * The page reads its view from the URL so links, redirects and bookmarks can
 * deep-link straight to Sign In or to a specific Sign Up role.
 */

export type AuthMode = 'signin' | 'signup'
export type SignupRole = 'student' | 'alumni' | 'faculty'

export const CANONICAL_AUTH_PATH = '/signin'

export const SIGNUP_ROLES: readonly SignupRole[] = ['student', 'alumni', 'faculty']

export const DEFAULT_SIGNUP_ROLE: SignupRole = 'student'

export function isSignupRole(value: unknown): value is SignupRole {
  return typeof value === 'string' && (SIGNUP_ROLES as readonly string[]).includes(value)
}

export interface AuthQuery {
  mode?: string | null
  role?: string | null
}

export interface AuthView {
  mode: AuthMode
  role: SignupRole
}

/**
 * Maps raw query values to a concrete view. Anything unrecognised falls back
 * to the safe default (Sign In, student registration) so a tampered URL can
 * never select a broken state.
 */
export function resolveAuthView(query: AuthQuery): AuthView {
  const mode: AuthMode = query.mode === 'signup' ? 'signup' : 'signin'
  const role: SignupRole = isSignupRole(query.role) ? query.role : DEFAULT_SIGNUP_ROLE
  return { mode, role }
}

/**
 * Only same-origin, absolute-path redirects are honoured after authentication.
 * `//evil.example` and absolute URLs are dropped, which keeps the `next`
 * parameter from becoming an open redirect.
 */
export function safeNextPath(value: string | null | undefined, fallback = '/'): string {
  if (!value) return fallback
  if (!value.startsWith('/') || value.startsWith('//')) return fallback
  return value
}

export interface CanonicalAuthLinkOptions {
  mode?: AuthMode
  role?: SignupRole
  next?: string | null
}

/** Builds a link to the canonical page for the requested view. */
export function canonicalAuthHref({
  mode = 'signin',
  role,
  next,
}: CanonicalAuthLinkOptions = {}): string {
  const params = new URLSearchParams()
  if (mode === 'signup') {
    params.set('mode', 'signup')
    params.set('role', isSignupRole(role) ? role : DEFAULT_SIGNUP_ROLE)
  }
  if (next) params.set('next', next)
  const query = params.toString()
  return query ? `${CANONICAL_AUTH_PATH}?${query}` : CANONICAL_AUTH_PATH
}
