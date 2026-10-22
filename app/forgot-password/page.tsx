'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { AlertCircle, ArrowRight, CheckCircle2, Loader2 } from 'lucide-react'
import AuthFormShell from '@/components/AuthFormShell'
import { createClient } from '@/lib/supabase/client'
import { canonicalAuthHref } from '@/lib/auth'

export default function ForgotPasswordPage() {
  const supabase = createClient()

  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Please enter a valid email address.')
      return
    }

    setLoading(true)
    try {
      // The recovery email links back through the OAuth/PKCE callback so the
      // code can be exchanged for a session before the reset form loads.
      const redirectTo = `${window.location.origin}/auth/callback?next=/reset-password`
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo,
      })
      if (resetError) throw resetError
      setSent(true)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not send the reset link. Please try again.'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  if (sent) {
    return (
      <AuthFormShell title="Check your email" subtitle="Password reset link sent.">
        <div className="flex flex-col items-center gap-4 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-lg border border-accent/30 bg-accent-soft">
            <CheckCircle2 className="h-6 w-6 text-accent-text" />
          </span>
          <p className="max-w-sm text-[13px] leading-relaxed text-muted">
            If an account exists for {email.trim()}, we sent a link to reset the password. Follow
            it, then{' '}
            <Link
              href={canonicalAuthHref()}
              className="font-medium text-ink underline-offset-4 hover:underline"
            >
              return to sign in
            </Link>
            .
          </p>
        </div>
      </AuthFormShell>
    )
  }

  return (
    <AuthFormShell
      title="Reset your password"
      subtitle="Enter your email and we will send you a reset link."
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/[0.06] px-3 py-2.5 text-[12.5px] text-danger"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="break-words">{error}</span>
          </div>
        )}

        <div>
          <label htmlFor="forgot-email" className="label">
            Email address
          </label>
          <input
            id="forgot-email"
            type="email"
            required
            placeholder="you@example.com"
            value={email}
            onChange={e => {
              setEmail(e.target.value)
              setError('')
            }}
            className="field"
            autoComplete="email"
          />
        </div>

        <button type="submit" disabled={loading} className="btn btn-accent btn-lg btn-block mt-1">
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Sending link…
            </>
          ) : (
            <>
              Send reset link <ArrowRight className="h-4 w-4" />
            </>
          )}
        </button>

        <p className="mt-2 text-center text-[12px] text-muted">
          <Link
            href={canonicalAuthHref()}
            className="font-medium text-ink underline-offset-4 hover:underline"
          >
            Back to sign in
          </Link>
        </p>
      </form>
    </AuthFormShell>
  )
}
