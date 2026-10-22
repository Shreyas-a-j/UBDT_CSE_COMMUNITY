import { redirect } from 'next/navigation'
import { canonicalAuthHref } from '@/lib/auth'

/**
 * Legacy route, preserved: alumni registration now lives on the canonical
 * authentication page. Alumni sign up without a USN, exactly as before.
 */
export default function LegacyAlumniSignUpPage() {
  redirect(canonicalAuthHref({ mode: 'signup', role: 'alumni' }))
}
