import { redirect } from 'next/navigation'
import { canonicalAuthHref } from '@/lib/auth'

/**
 * Legacy route, preserved: the faculty access request now lives on the
 * canonical authentication page, with the same pending-approval behaviour.
 */
export default function LegacyFacultySignUpPage() {
  redirect(canonicalAuthHref({ mode: 'signup', role: 'faculty' }))
}
