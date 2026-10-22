'use client'

import React, { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import AuthFormShell from '@/components/AuthFormShell'
import SignInForm from '@/components/auth/SignInForm'
import StudentSignUpForm from '@/components/auth/StudentSignUpForm'
import AlumniSignUpForm from '@/components/auth/AlumniSignUpForm'
import FacultySignUpForm from '@/components/auth/FacultySignUpForm'
import { resolveAuthView } from '@/lib/auth'

/**
 * The single canonical authentication page.
 *
 * Every Sign In / Sign Up entry point in the app lands here. The URL decides
 * the view so links and redirects can deep-link to a mode and role:
 *
 *   /signin                          → Sign In (default)
 *   /signin?mode=signup              → student registration
 *   /signin?mode=signup&role=alumni  → alumni registration (no USN)
 *   /signin?mode=signup&role=faculty → faculty access request
 *   /signin?next=/messages           → Sign In, then continue to /messages
 */
function CanonicalAuth() {
  const searchParams = useSearchParams()
  const { mode, role } = resolveAuthView({
    mode: searchParams?.get('mode'),
    role: searchParams?.get('role'),
  })

  if (mode === 'signup') {
    if (role === 'alumni') return <AlumniSignUpForm />
    if (role === 'faculty') return <FacultySignUpForm />
    return <StudentSignUpForm />
  }

  return <SignInForm />
}

export default function CanonicalAuthPage() {
  return (
    <Suspense
      fallback={
        <AuthFormShell
          title="UBDT CSE Community"
          subtitle="Preparing the sign-in page…"
        >
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-dim" />
          </div>
        </AuthFormShell>
      }
    >
      <CanonicalAuth />
    </Suspense>
  )
}
