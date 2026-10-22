import { redirect } from 'next/navigation'
import { canonicalAuthHref } from '@/lib/auth'

/**
 * Legacy route, preserved: student registration now lives on the canonical
 * authentication page. The URL still resolves so old links and bookmarks keep
 * working, but there is no second copy of the form.
 */
export default function LegacyStudentSignUpPage() {
  redirect(canonicalAuthHref({ mode: 'signup', role: 'student' }))
}
