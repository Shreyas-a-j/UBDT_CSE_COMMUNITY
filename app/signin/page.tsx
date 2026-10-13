'use client'

import React, { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { AlertCircle, Loader2, Eye, EyeOff, ArrowRight, Mail } from 'lucide-react'
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
    <AuthFormShell title="WELCOME BACK" subtitle="Sign in to UCC Community">
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {error && (
          <div
            style={{
              padding: '8px 12px',
              background: 'rgba(255,68,102,0.1)',
              border: '2px solid rgba(255,68,102,0.4)',
              color: '#ff6688',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              boxShadow: '2px 2px 0px #661133',
            }}
          >
            <AlertCircle style={{ width: 14, height: 14, flexShrink: 0 }} />
            <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>{error}</span>
          </div>
        )}

        {/* Email */}
        <div>
          <label className="label" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Mail style={{ width: 13, height: 13, color: '#00aaff' }} /> Email Address
          </label>
          <input
            type="email"
            required
            placeholder="e.g. varun@gmail.com"
            value={email}
            onChange={e => { setEmail(e.target.value); setError('') }}
            className="input"
            autoComplete="email"
          />
        </div>

        {/* Password */}
        <div>
          <label className="label">Password</label>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              required
              placeholder="Your password"
              value={password}
              onChange={e => { setPassword(e.target.value); setError('') }}
              className="input pr-10"
              autoComplete="current-password"
            />
            <button
              type="button"
              onClick={() => setShowPassword(v => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Forgot password */}
        <p style={{ textAlign: 'right', margin: 0 }}>
          <Link href="/forgot-password" style={{ color: '#00aaff', fontSize: '0.75rem', fontWeight: 600 }}>
            Forgot password?
          </Link>
        </p>

        {/* Submit */}
        <button
          type="submit"
          disabled={loading}
          style={{
            width: '100%',
            padding: '10px',
            background: '#00aaff',
            color: '#060a14',
            border: '2px solid #0088cc',
            fontSize: '0.8125rem',
            fontWeight: 700,
            cursor: loading ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            boxShadow: '4px 4px 0px #003366',
            textTransform: 'uppercase',
            opacity: loading ? 0.7 : 1,
            letterSpacing: '0.03em',
          }}
        >
          {loading ? (
            <>
              <Loader2 style={{ width: 14, height: 14 }} className="animate-spin" />
              <span>SIGNING IN...</span>
            </>
          ) : (
            <>
              <span>SIGN IN</span>
              <ArrowRight style={{ width: 14, height: 14 }} />
            </>
          )}
        </button>

        {/* Links */}
        <p style={{ textAlign: 'center', fontSize: '0.75rem', color: '#6bafd4', margin: 0 }}>
          Don&apos;t have an account?{' '}
          <Link href="/signup" style={{ color: '#00ffcc', fontWeight: 600, textDecoration: 'underline' }}>
            SIGN UP
          </Link>
        </p>
        <p style={{ textAlign: 'center', fontSize: '0.75rem', color: '#6bafd4', margin: 0 }}>
          Faculty?{' '}
          <Link href="/signup/faculty" style={{ color: '#ffe066', fontWeight: 600 }}>
            Request faculty access
          </Link>
        </p>
      </form>
    </AuthFormShell>
  )
}

export default function SignInPage() {
  return (
    <Suspense fallback={
      <AuthFormShell title="WELCOME BACK" subtitle="Sign in to UCC Community">
        <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
          <Loader2 style={{ width: 32, height: 32, color: '#00aaff' }} className="animate-spin" />
        </div>
      </AuthFormShell>
    }>
      <SignInForm />
    </Suspense>
  )
}
