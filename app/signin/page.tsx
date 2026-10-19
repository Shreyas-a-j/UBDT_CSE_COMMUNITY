'use client'

import React, { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { AlertCircle, ArrowRight, Eye, EyeOff, Loader2 } from 'lucide-react'
import AuthFormShell from '@/components/AuthFormShell'
import { createClient } from '@/lib/supabase/client'

function SignInForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

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
          setError('Your email is not confirmed. Please check your inbox.')
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

      const next = searchParams.get('next') || '/'
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

        <div>
          <div className="mb-1.5 flex items-baseline justify-between gap-2">
            <label htmlFor="signin-password" className="label mb-0">
              Password
            </label>
            <Link
              href="/forgot-password"
              className="text-[11.5px] font-medium text-muted transition-colors hover:text-ink"
            >
              Forgot password?
            </Link>
          </div>
          <div className="relative">
            <input
              id="signin-password"
              type={showPassword ? 'text' : 'password'}
              required
              placeholder="Your password"
              value={password}
              onChange={e => {
                setPassword(e.target.value)
                setError('')
              }}
              className="field pr-11"
              autoComplete="current-password"
            />
            <button
              type="button"
              onClick={() => setShowPassword(v => !v)}
              className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-dim transition-colors hover:text-ink"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

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

        <div className="mt-2 space-y-2 text-center text-[12px] text-muted">
          <p>
            New here?{' '}
            <Link href="/signup" className="font-medium text-ink underline-offset-4 hover:underline">
              Create an account
            </Link>
          </p>
          <p>
            Faculty?{' '}
            <Link
              href="/signup/faculty"
              className="font-medium text-ink underline-offset-4 hover:underline"
            >
              Request faculty access
            </Link>
          </p>
        </div>
      </form>
    </AuthFormShell>
  )
}

export default function SignInPage() {
  return (
    <Suspense
      fallback={
        <AuthFormShell title="Welcome back" subtitle="Sign in to your UBDT CSE Community account.">
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-dim" />
          </div>
        </AuthFormShell>
      }
    >
      <SignInForm />
    </Suspense>
  )
}
