'use client'

import React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { canonicalAuthHref, SIGNUP_ROLES, type AuthMode, type SignupRole } from '@/lib/auth'

const ROLE_LABELS: Record<SignupRole, string> = {
  student: 'Student',
  alumni: 'Alumni',
  faculty: 'Faculty',
}

/**
 * The Sign In / Sign Up chooser that sits at the top of every form on the
 * canonical authentication page. Switching a mode or role rewrites the URL to
 * the canonical page, preserving `next` so post-login redirects survive the
 * round trip.
 */
export default function AuthSwitcher({ mode, role }: { mode: AuthMode; role: SignupRole }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const next = searchParams?.get('next') ?? null

  const go = (nextMode: AuthMode, nextRole: SignupRole = role) => {
    router.replace(canonicalAuthHref({ mode: nextMode, role: nextRole, next }), {
      scroll: false,
    })
  }

  const segmentClass = (active: boolean) =>
    `flex-1 rounded-md px-3 py-2 text-[12.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-ring)] ${
      active ? 'bg-accent text-accent-ink shadow-card' : 'text-muted hover:text-ink'
    }`

  return (
    <div className="mb-6 space-y-3">
      <div
        role="tablist"
        aria-label="Authentication mode"
        className="flex gap-1 rounded-lg border border-line bg-elevated p-1"
      >
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'signin'}
          onClick={() => go('signin')}
          className={segmentClass(mode === 'signin')}
        >
          Sign in
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'signup'}
          onClick={() => go('signup')}
          className={segmentClass(mode === 'signup')}
        >
          Create account
        </button>
      </div>

      {mode === 'signup' && (
        <div
          role="tablist"
          aria-label="Account type"
          className="flex gap-1 rounded-lg border border-line bg-elevated p-1"
        >
          {SIGNUP_ROLES.map(signupRole => (
            <button
              key={signupRole}
              type="button"
              role="tab"
              aria-selected={role === signupRole}
              onClick={() => go('signup', signupRole)}
              className={segmentClass(role === signupRole)}
            >
              {ROLE_LABELS[signupRole]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
