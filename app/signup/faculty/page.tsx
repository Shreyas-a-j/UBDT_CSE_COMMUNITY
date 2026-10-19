'use client'

import React, { Suspense, useState } from 'react'
import Link from 'next/link'
import { AlertCircle, ArrowRight, CheckCircle2, Clock, Eye, EyeOff, Loader2 } from 'lucide-react'
import AuthFormShell from '@/components/AuthFormShell'
import { createClient } from '@/lib/supabase/client'
import { validateFacultySignup } from '@/lib/validation'

type SubmitPhase = 'idle' | 'creating-auth' | 'submitting-application' | 'done'

function FacultySignUpForm() {
  const supabase = createClient()

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [department, setDepartment] = useState('CSE')
  const [designation, setDesignation] = useState('')
  const [employeeId, setEmployeeId] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [phase, setPhase] = useState<SubmitPhase>('idle')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setPhase('creating-auth')

    const validationError = validateFacultySignup({
      name,
      email,
      password,
      confirmPassword,
      designation,
      department,
    })
    if (validationError) {
      setError(validationError)
      setPhase('idle')
      return
    }

    setLoading(true)

    try {
      // Step 1: Create (or sign in to) the auth account.
      // signUp is idempotent for new accounts; for existing accounts it returns
      // an error we can surface as a sign-in hint.
      const { data: authData, error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            name: name.trim(),
            department: department.trim(),
            designation: designation.trim(),
            employee_id: employeeId.trim() || null,
            intent: 'faculty',
          },
        },
      })

      if (signUpError) {
        if (
          signUpError.message.includes('already registered') ||
          signUpError.message.includes('User already registered')
        ) {
          setError(
            'This email is already registered. Please sign in and resubmit your faculty application from your profile.'
          )
          return
        }
        throw signUpError
      }

      const userId = authData.user?.id
      if (!userId) {
        // Email confirmation is required before the profile row (and thus the
        // application FK) can be created. Show a pending-state message rather
        // than failing outright.
        setPhase('done')
        return
      }

      // Step 2: Insert the faculty application row.
      setPhase('submitting-application')
      const { error: appError } = await supabase
        .from('faculty_applications')
        .insert({
          user_id: userId,
          full_name: name.trim(),
          official_email: email.trim(),
          department: department.trim(),
          designation: designation.trim(),
          employee_id: employeeId.trim() || null,
          status: 'pending',
        })

      if (appError) {
        // Structured error logging (no service-role key used).
        console.error('[FacultyApp] insert failed:', {
          code: appError.code,
          details: appError.details,
          hint: appError.hint,
          message: appError.message,
          userId,
        })

        // Map common Supabase error codes to human-readable messages.
        if (appError.code === '23505') {
          // PostgreSQL unique-violation — a pending application already exists.
          setError(
            'You already have a pending faculty application. Please wait for review or sign in to check its status.'
          )
          return
        }
        if (appError.code === '23503') {
          // Foreign-key violation — profile row is missing (race condition
          // with the auth trigger). Surface a retry hint.
          setError(
            'Account created but the application could not be saved (profile not yet ready). Please sign in and try submitting again in a moment.'
          )
          return
        }

        // Generic fallback.
        setError(
          'Your account was created, but saving your application failed. Please sign in and try submitting again, or contact support.'
        )
        return
      }

      // SUCCESS: Both auth account and application row are persisted.
      setPhase('done')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Sign up failed. Please try again.'
      setError(msg)
      setPhase('idle')
    } finally {
      setLoading(false)
    }
  }

  if (phase === 'done') {
    return (
      <AuthFormShell
        title="Application submitted"
        subtitle="Your faculty access request has been received."
      >
        <div className="flex flex-col items-center gap-5 text-center">
          <div className="flex items-center gap-2">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-accent/30 bg-accent/10">
              <CheckCircle2 className="h-5 w-5 text-accent" />
            </span>
            <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-warn/30 bg-warn/10">
              <Clock className="h-5 w-5 text-warn" />
            </span>
          </div>

          <div className="w-full rounded-xl border border-line bg-elevated px-4 py-3.5 text-left">
            <p className="font-display text-[13px] font-semibold text-ink">Your account is under review</p>
            <p className="mt-1 text-[12px] leading-relaxed text-muted">
              You will be notified once an administrator approves your faculty application. Until
              then, your account has standard student access.
            </p>
          </div>

          <p className="text-[12px] text-muted">
            <Link href="/signin" className="font-medium text-ink underline-offset-4 hover:underline">
              Sign in to your account
            </Link>{' '}
            while you wait for approval.
          </p>
        </div>
      </AuthFormShell>
    )
  }

  const passwordsMismatch = Boolean(confirmPassword && confirmPassword !== password)

  return (
    <AuthFormShell
      title="Faculty access request"
      subtitle="Apply for verified faculty permissions in the CSE community."
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex items-start gap-2.5 rounded-lg border border-warn/25 bg-warn/[0.05] px-3 py-2.5">
          <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" />
          <p className="text-[11.5px] leading-relaxed text-muted">
            An administrator reviews every application before faculty permissions are granted.
            Until approved, your account keeps standard student access.
          </p>
        </div>

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
          <label htmlFor="faculty-name" className="label">
            Full name
          </label>
          <input
            id="faculty-name"
            type="text"
            required
            placeholder="e.g. Dr. Anita Sharma"
            value={name}
            onChange={e => {
              setName(e.target.value)
              setError('')
            }}
            className="field"
            autoComplete="name"
          />
        </div>

        <div>
          <label htmlFor="faculty-email" className="label">
            Official institutional email
          </label>
          <input
            id="faculty-email"
            type="email"
            required
            placeholder="e.g. anita.sharma@ubdt.ac.in"
            value={email}
            onChange={e => {
              setEmail(e.target.value)
              setError('')
            }}
            className="field"
            autoComplete="email"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="faculty-department" className="label">
              Department
            </label>
            <input
              id="faculty-department"
              type="text"
              required
              placeholder="e.g. CSE"
              value={department}
              onChange={e => {
                setDepartment(e.target.value)
                setError('')
              }}
              className="field"
            />
          </div>
          <div>
            <label htmlFor="faculty-designation" className="label">
              Designation
            </label>
            <input
              id="faculty-designation"
              type="text"
              required
              placeholder="e.g. Assistant Professor"
              value={designation}
              onChange={e => {
                setDesignation(e.target.value)
                setError('')
              }}
              className="field"
            />
          </div>
        </div>

        <div>
          <label htmlFor="faculty-employee-id" className="label">
            Employee ID <span className="font-normal text-dim">(optional)</span>
          </label>
          <input
            id="faculty-employee-id"
            type="text"
            placeholder="e.g. UBDT-FAC-042"
            value={employeeId}
            onChange={e => {
              setEmployeeId(e.target.value)
              setError('')
            }}
            className="field"
          />
        </div>

        <div>
          <label htmlFor="faculty-password" className="label">
            Password
          </label>
          <div className="relative">
            <input
              id="faculty-password"
              type={showPassword ? 'text' : 'password'}
              required
              placeholder="At least 6 characters"
              value={password}
              onChange={e => {
                setPassword(e.target.value)
                setError('')
              }}
              className="field pr-11"
              autoComplete="new-password"
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

        <div>
          <label htmlFor="faculty-confirm" className="label">
            Confirm password
          </label>
          <div className="relative">
            <input
              id="faculty-confirm"
              type={showConfirm ? 'text' : 'password'}
              required
              placeholder="Re-enter your password"
              value={confirmPassword}
              onChange={e => {
                setConfirmPassword(e.target.value)
                setError('')
              }}
              className="field pr-11"
              autoComplete="new-password"
            />
            <button
              type="button"
              onClick={() => setShowConfirm(v => !v)}
              className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-dim transition-colors hover:text-ink"
              aria-label={showConfirm ? 'Hide password' : 'Show password'}
            >
              {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {passwordsMismatch && (
            <p className="mt-1.5 text-[11px] text-danger">Passwords do not match</p>
          )}
        </div>

        <button
          type="submit"
          disabled={loading || passwordsMismatch}
          className="btn btn-accent btn-lg btn-block mt-1"
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {phase === 'submitting-application' ? 'Saving application…' : 'Submitting…'}
            </>
          ) : (
            <>
              Submit application <ArrowRight className="h-4 w-4" />
            </>
          )}
        </button>

        <div className="mt-2 space-y-2 text-center text-[12px] text-muted">
          <p>
            Already have an account?{' '}
            <Link href="/signin" className="font-medium text-ink underline-offset-4 hover:underline">
              Sign in
            </Link>
          </p>
          <p>
            Student registration?{' '}
            <Link href="/signup" className="font-medium text-ink underline-offset-4 hover:underline">
              Sign up here
            </Link>
          </p>
        </div>
      </form>
    </AuthFormShell>
  )
}

export default function FacultySignUpPage() {
  return (
    <Suspense
      fallback={
        <AuthFormShell
          title="Faculty access request"
          subtitle="Apply for verified faculty permissions in the CSE community."
        >
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-dim" />
          </div>
        </AuthFormShell>
      }
    >
      <FacultySignUpForm />
    </Suspense>
  )
}
