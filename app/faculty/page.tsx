import { redirect } from 'next/navigation'

/**
 * The faculty directory lives in the People directory's Faculty filter. This
 * route remains as a stable link target (and for the middleware redirect from
 * /faculty/dashboard) but no longer renders a second, subtly different list.
 */
export default function FacultyPage() {
  redirect('/people?filter=faculty')
}
