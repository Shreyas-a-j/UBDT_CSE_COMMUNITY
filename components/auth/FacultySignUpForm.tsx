'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { AlertCircle, ArrowRight, CheckCircle2, Clock, Loader2 } from 'lucide-react'
import AuthFormShell from '@/components/AuthFormShell'
import AuthSwitcher from '@/components/auth/AuthSwitcher'
import PasswordField from '@/components/auth/PasswordField'
import { createClient } from '@/lib/supabase/client'
import {
  buildFacultyApplicationRow,
  buildFacultySignupMetadata,
  classifyFacultyApplicationInsert,
} from '@/lib/logic/faculty'
import { validateFacultySignup } from '@/lib/validation'
import { canonicalAuthHref } from '@/lib/auth'

type SubmitPhase = 'idle' | 'creating-auth' | 'submitting-application' | 'done'

export default function FacultySignUpForm() {
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
  const [emailConfirmationRequired, setEmailConfirmationRequired] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setEmailConfirmationRequired(false)
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
          data: buildFacultySignupMetadata({
            name,
            department,
            designation,
            employeeId,
          }),
        },
      })

      if (signUpError) {
        if (
          signUpError.message.includes('already registered') ||
          signUpError.message.includes('User already registered')
        ) {
          setError(
            'This email is already registered. Sign in with that account, or contact an administrator to request faculty access.'
          )
          setPhase('idle')
          return
        }
        throw signUpError
      }

      const userId = authData.user?.id
      if (!userId) {
        // A successful signUp always returns the created account. Without an
        // id there is nothing that could have provisioned an application, so
        // do not claim success.
        setError(
          'Your account could not be created, so no application was saved. Please try again or contact support.',
        )
        setPhase('idle')
        return
      }

      // With email confirmation enabled, Supabase intentionally obfuscates an
      // already-registered address: signUp returns a user with an empty
      // identities array, no session and no error. Do not report success for
      // an account that was never created.
      if (Array.isArray(authData.user?.identities) && authData.user.identities.length === 0) {
        setError(
          'This email is already registered. Sign in with that account, or contact an administrator to request faculty access.'
        )
        setPhase('idle')
        return
      }

      // The database trigger creates the pending application atomically during
      // signUp. When email confirmation is required there is no browser
      // session yet, so attempting the RLS-protected insert would fail even
      // though the application already exists. Only use the browser fallback
      // when a real session is available (older deployments).
      if (!authData.session) {
        // The database trigger has already stored the pending application in
        // the same transaction as the auth.users insert. There is no browser
        // session yet, so no client write is possible — or needed.
        setEmailConfirmationRequired(true)
        setPhase('done')
        return
      }

      // Fallback for deployments that predate the signup-trigger provisioning.
      setPhase('submitting-application')
      const { error: appError } = await supabase
        .from('faculty_applications')
        .insert(
          buildFacultyApplicationRow(userId, email.trim(), {
            name,
            department,
            designation,
            employeeId,
          }),
        )

      const outcome = classifyFacultyApplicationInsert(appError)

      if (outcome === 'created' || outcome === 'already-pending') {
        // 'already-pending' means the trigger won the race and created the
        // row first. That is success, not a duplicate-application error.
        setPhase('done')
        return
      }

      if (appError) {
        // Structured error logging (no service-role key used).
        console.error('[FacultyApp] insert failed:', {
          code: appError.code,
          details: appError.details,
          hint: appError.hint,
          message: appError.message,
          userId,
        })
      }

      if (outcome === 'profile-not-ready') {
        // Foreign-key violation — profile row is missing (race condition
        // with the auth trigger). Surface a retry hint.
        setError(
          'Account created but the application could not be saved (profile not yet ready). Please sign in and try submitting again in a moment.'
        )
        setPhase('idle')
        return
      }

      // Generic fallback.
      setError(
        'Your account was created, but saving your application failed. Please sign in and try submitting again, or contact support.'
      )
      setPhase('idle')
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
              <CheckCircle2 className="h-5 w-5 text-accent-text" />
            </span>
            <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-warn/30 bg-warn/10">
              <Clock className="h-5 w-5 text-warn" />
            </span>
          </div>

          <div className="w-full rounded-xl border border-line bg-elevated px-4 py-3.5 text-left">
            <p className="font-display text-[13px] font-semibold text-ink">Your account is under review</p>
            <p className="mt-1 text-[12px] leading-relaxed text-muted">
              Your pending application has been saved for an administrator to review. You will be
              notified once a decision is made. Until approval, your account has standard student
              access.
            </p>
          </div>

          {emailConfirmationRequired && (
            <div className="w-full rounded-xl border border-warn/25 bg-warn/[0.05] px-4 py-3.5 text-left">
              <p className="font-display text-[13px] font-semibold text-ink">
                Confirm your email address
              </p>
              <p className="mt-1 text-[12px] leading-relaxed text-muted">
                Check your inbox for the confirmation link. Your application is already saved, so
                you can confirm at any time. Sign-in stays disabled until the address is verified.
              </p>
            </div>
          )}

          <p className="text-[12px] text-muted">
            <Link
              href={canonicalAuthHref()}
              className="font-medium text-ink underline-offset-4 hover:underline"
            >
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
      <AuthSwitcher mode="signup" role="faculty" />

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

        <PasswordField
          id="faculty-password"
          label="Password"
          placeholder="At least 6 characters"
          value={password}
          onChange={v => {
            setPassword(v)
            setError('')
          }}
          show={showPassword}
          onToggle={() => setShowPassword(v => !v)}
        />

        <div>
          <PasswordField
            id="faculty-confirm"
            label="Confirm password"
            placeholder="Re-enter your password"
            value={confirmPassword}
            onChange={v => {
              setConfirmPassword(v)
              setError('')
            }}
            show={showConfirm}
            onToggle={() => setShowConfirm(v => !v)}
          />
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
      </form>
    </AuthFormShell>
  )
}
