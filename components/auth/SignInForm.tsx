'use client'

import React, { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { AlertCircle, ArrowRight, Loader2 } from 'lucide-react'
import AuthFormShell from '@/components/AuthFormShell'
import AuthSwitcher from '@/components/auth/AuthSwitcher'
import PasswordField from '@/components/auth/PasswordField'
import { createClient } from '@/lib/supabase/client'
import { safeNextPath } from '@/lib/auth'

export default function SignInForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const linkError = searchParams?.get('error')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!email.trim()) {
      setError('Please enter your email address.')
      return
    }
    if (!password || password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }

    setLoading(true)
    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      })

      if (signInError || !data.user) {
        const msg = signInError?.message || ''
        if (msg.toLowerCase().includes('email not confirmed')) {
          setError(
            'Your email address has not been confirmed yet, so sign-in is disabled. Open the confirmation link in your inbox (check spam too). Confirming your email is separate from faculty approval: an administrator can still review your application while it is unverified.',
          )
        } else if (
          msg.toLowerCase().includes('invalid login credentials') ||
          msg.toLowerCase().includes('invalid credentials')
        ) {
          setError('Wrong email or password. Double-check and try again.')
        } else {
          setError(msg || 'Sign in failed. Please try again.')
        }
        return
      }

      const next = safeNextPath(searchParams?.get('next'))
      router.push(next)
      router.refresh()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Authentication error. Please try again.'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthFormShell title="Welcome back" subtitle="Sign in to your UBDT CSE Community account.">
      <AuthSwitcher mode="signin" role="student" />

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {linkError === 'auth' && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/[0.06] px-3 py-2.5 text-[12.5px] text-danger"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="break-words">
              That sign-in link has expired or is invalid. Please sign in with your email and
              password.
            </span>
          </div>
        )}

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
          <label htmlFor="signin-email" className="label">
            Email address
          </label>
          <input
            id="signin-email"
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

        <PasswordField
          id="signin-password"
          label="Password"
          placeholder="Your password"
          value={password}
          onChange={v => {
            setPassword(v)
            setError('')
          }}
          show={showPassword}
          onToggle={() => setShowPassword(v => !v)}
          autoComplete="current-password"
          labelAddon={
            <Link
              href="/forgot-password"
              className="text-[11.5px] font-medium text-muted transition-colors hover:text-ink"
            >
              Forgot password?
            </Link>
          }
        />

        <button type="submit" disabled={loading} className="btn btn-accent btn-lg btn-block mt-1">
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Signing in…
            </>
          ) : (
            <>
              Sign in <ArrowRight className="h-4 w-4" />
            </>
          )}
        </button>
      </form>

    </AuthFormShell>
  )
}
