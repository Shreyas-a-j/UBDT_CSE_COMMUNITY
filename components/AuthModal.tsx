'use client'

import React, { useState } from 'react'
import { AlertCircle, ArrowRight, Eye, EyeOff, Loader2, Mail } from 'lucide-react'
import { useCommunity } from '@/contexts/CommunityContext'
import { validateUSN, getYearFromUSN } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import Modal, { ModalCloseButton } from '@/components/Modal'

export default function AuthModal() {
  const { isAuthModalOpen, setIsAuthModalOpen } = useCommunity()
  const supabase = createClient()

  const [isSignUp, setIsSignUp] = useState(true)
  const [usn, setUsn] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [year, setYear] = useState<number>(1)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  const resetForm = () => {
    setUsn('')
    setName('')
    setEmail('')
    setPassword('')
    setConfirmPassword('')
    setYear(1)
    setError('')
  }

  const close = () => {
    resetForm()
    setIsAuthModalOpen(false)
  }

  const handleUsnChange = (value: string) => {
    const uppercaseValue = value.toUpperCase().trim()
    setUsn(uppercaseValue)
    setError('')
    const detected = getYearFromUSN(uppercaseValue)
    if (detected) setYear(detected)
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')

    const formattedUsn = usn.toUpperCase().trim()
    if (isSignUp && !validateUSN(formattedUsn)) {
      setError('Invalid USN. Expected format: 4UB24CS045')
      return
    }
    if (isSignUp && !name.trim()) {
      setError('Please enter your full name')
      return
    }
    if (isSignUp && !email.trim()) {
      setError('Please enter your email address')
      return
    }
    if (!password || password.length < 6) {
      setError('Password must be at least 6 characters')
      return
    }
    if (isSignUp && password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }
    if (!email.trim()) {
      setError('Please enter your email address')
      return
    }

    setLoading(true)
    const authEmail = email.trim()

    try {
      if (isSignUp) {
        const { error: signUpError } = await supabase.auth.signUp({
          email: authEmail,
          password,
          options: {
            data: { name: name.trim(), usn: formattedUsn, year, department: 'CSE' },
          },
        })

        if (signUpError) {
          if (
            signUpError.message.includes('already registered') ||
            signUpError.message.includes('User already registered')
          ) {
            setError('This email is already registered. Please sign in instead.')
            setLoading(false)
            return
          }
          throw signUpError
        }

        const { error: signInErr } = await supabase.auth.signInWithPassword({
          email: authEmail,
          password,
        })

        if (signInErr) {
          setError('Account created. Check your email to verify, then sign in.')
          setLoading(false)
          resetForm()
          setIsSignUp(false)
          return
        }
      } else {
        const { data, error: signInError } = await supabase.auth.signInWithPassword({
          email: authEmail,
          password,
        })

        if (signInError || !data.user) {
          const message = signInError?.message || ''
          if (message.toLowerCase().includes('email not confirmed')) {
            setError(
              'Your email is not confirmed. Check your inbox or ask the admin to confirm your account.'
            )
          } else if (
            message.toLowerCase().includes('invalid login credentials') ||
            message.toLowerCase().includes('invalid credentials')
          ) {
            setError('Wrong email or password. Double-check and try again.')
          } else {
            setError(message || 'Sign in failed. Please try again.')
          }
          setLoading(false)
          return
        }
      }

      resetForm()
      setIsAuthModalOpen(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Authentication error. Please try again.'
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  if (!isAuthModalOpen) return null

  return (
    <Modal open={isAuthModalOpen} onClose={close} labelledBy="auth-modal-title">
      <div className="modal-head">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-accent/40 bg-accent-soft font-mono text-[10px] font-bold text-accent-hover">
            CSE
          </span>
          <div>
            <h2 id="auth-modal-title" className="text-[16px] font-semibold text-ink">
              {isSignUp ? 'Join the community' : 'Welcome back'}
            </h2>
            <p className="mt-0.5 text-[12px] text-muted">
              {isSignUp ? 'Create your student profile with your USN.' : 'Sign in to your UBDT CSE account.'}
            </p>
          </div>
        </div>
        <ModalCloseButton onClick={close} />
      </div>

      <div className="flex border-b border-line bg-surface px-2" role="tablist" aria-label="Authentication mode">
        {[
          { id: true, label: 'Create account' },
          { id: false, label: 'Sign in' },
        ].map(tab => {
          const active = isSignUp === tab.id
          return (
            <button
              key={String(tab.id)}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => {
                setIsSignUp(tab.id)
                setError('')
              }}
              className={`relative px-3 py-2.5 text-[12.5px] font-medium transition-colors ${
                active ? 'text-ink' : 'text-muted hover:text-ink'
              }`}
            >
              {tab.label}
              {active && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-accent" />}
            </button>
          )
        })}
      </div>

      <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
        <div className="modal-body space-y-3.5">
          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2.5 text-[12px] text-danger"
            >
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {isSignUp && (
            <div>
              <label className="label" htmlFor="auth-name">Full name</label>
              <input
                id="auth-name"
                type="text"
                required
                autoComplete="name"
                placeholder="e.g. Varun Kumar"
                value={name}
                onChange={e => setName(e.target.value)}
                className="field"
              />
            </div>
          )}

          {isSignUp && (
            <div>
              <label className="label" htmlFor="auth-usn">USN</label>
              <input
                id="auth-usn"
                type="text"
                required
                placeholder="4UB24CS045"
                value={usn}
                onChange={e => handleUsnChange(e.target.value)}
                className="field font-mono uppercase"
                maxLength={12}
              />
              <p className="mt-1.5 text-[11px] text-dim">
                Format 4UB[YY]CS[Roll]. Your academic year is detected automatically.
              </p>
            </div>
          )}

          <div>
            <label className="label flex items-center gap-1.5" htmlFor="auth-email">
              <Mail className="h-3 w-3" /> Email address
            </label>
            <input
              id="auth-email"
              type="email"
              required
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={e => {
                setEmail(e.target.value)
                setError('')
              }}
              className="field"
            />
          </div>

          {isSignUp && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="auth-year">Academic year</label>
                <select
                  id="auth-year"
                  value={year}
                  onChange={e => setYear(Number(e.target.value))}
                  className="field-select"
                >
                  <option value={1}>1st year</option>
                  <option value={2}>2nd year</option>
                  <option value={3}>3rd year</option>
                  <option value={4}>4th year</option>
                </select>
              </div>
              <div>
                <label className="label" htmlFor="auth-dept">Department</label>
                <input
                  id="auth-dept"
                  type="text"
                  disabled
                  value="CSE"
                  className="field cursor-not-allowed opacity-70"
                />
              </div>
            </div>
          )}

          <div>
            <label className="label" htmlFor="auth-password">Password</label>
            <div className="relative">
              <input
                id="auth-password"
                type={showPassword ? 'text' : 'password'}
                required
                autoComplete={isSignUp ? 'new-password' : 'current-password'}
                placeholder="At least 6 characters"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="field pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword(v => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-dim transition-colors hover:bg-elevated hover:text-ink"
              >
                {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>

          {isSignUp && (
            <div>
              <label className="label" htmlFor="auth-confirm">Confirm password</label>
              <div className="relative">
                <input
                  id="auth-confirm"
                  type={showConfirm ? 'text' : 'password'}
                  required
                  autoComplete="new-password"
                  placeholder="Re-enter your password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  className="field pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm(v => !v)}
                  aria-label={showConfirm ? 'Hide password' : 'Show password'}
                  className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-dim transition-colors hover:bg-elevated hover:text-ink"
                >
                  {showConfirm ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
              {confirmPassword && confirmPassword !== password && (
                <p className="mt-1.5 text-[11px] text-danger">Passwords do not match.</p>
              )}
            </div>
          )}

          {!isSignUp && (
            <p className="text-right">
              <a href="/forgot-password" className="text-[11.5px] font-medium text-accent hover:underline">
                Forgot password?
              </a>
            </p>
          )}
        </div>

        <div className="flex flex-col gap-3 border-t border-line bg-surface px-5 py-4">
          <button
            type="submit"
            disabled={loading || (isSignUp && !!confirmPassword && confirmPassword !== password)}
            className="btn btn-accent btn-lg btn-block"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Please wait…
              </>
            ) : (
              <>
                {isSignUp ? 'Create profile' : 'Sign in'}
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>

          <div className="flex flex-wrap items-center justify-between gap-2 text-[11.5px] text-dim">
            <span>
              {isSignUp ? 'Already registered?' : 'New here?'}{' '}
              <button
                type="button"
                onClick={() => {
                  setIsSignUp(!isSignUp)
                  setError('')
                }}
                className="font-medium text-ink hover:underline"
              >
                {isSignUp ? 'Sign in' : 'Create an account'}
              </button>
            </span>
            <a href="/signup/faculty" className="font-medium text-muted hover:text-ink">
              Faculty access
            </a>
          </div>
        </div>
      </form>
    </Modal>
  )
}
