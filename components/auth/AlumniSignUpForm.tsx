'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { AlertCircle, ArrowRight, CheckCircle2, Loader2 } from 'lucide-react'
import AuthFormShell from '@/components/AuthFormShell'
import AuthSwitcher from '@/components/auth/AuthSwitcher'
import PasswordField from '@/components/auth/PasswordField'
import { createClient } from '@/lib/supabase/client'
import { validateAlumniSignup, parseTagList } from '@/lib/validation'
import { canonicalAuthHref } from '@/lib/auth'

export default function AlumniSignUpForm() {
  const router = useRouter()
  const supabase = createClient()

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [graduationYear, setGraduationYear] = useState<number>(new Date().getFullYear())
  const [section, setSection] = useState('')
  const [skills, setSkills] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)

  const currentYear = new Date().getFullYear()
  const yearOptions = Array.from({ length: 60 }, (_, i) => currentYear - i)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    const validationError = validateAlumniSignup({
      name,
      email,
      password,
      confirmPassword,
      graduationYear,
      section,
    })
    if (validationError) {
      setError(validationError)
      return
    }

    setLoading(true)
    try {
      const skillsList = parseTagList(skills)

      // Step 1: Create auth account. No USN is sent for alumni; the existing
      // handle_new_user() trigger provisions the alumni profile with
      // role='student', faculty_status='none', member_type='alumni'.
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            name: name.trim(),
            department: 'CSE',
            section: section.trim() || null,
            skills: skillsList,
            intent: 'alumni',
            graduation_year: graduationYear,
          },
        },
      })

      if (signUpError) {
        if (
          signUpError.message.includes('already registered') ||
          signUpError.message.includes('User already registered')
        ) {
          setError('This email is already registered. Please sign in instead.')
          return
        }
        throw signUpError
      }

      if (!data.user) {
        // Email confirmation required
        setSuccess(true)
        return
      }

      // Auto sign-in
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      })

      if (signInErr) {
        // Email confirmation required
        setSuccess(true)
        return
      }

      router.push('/')
      router.refresh()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Sign up failed. Please try again.'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <AuthFormShell title="Check your email" subtitle="Your alumni account has been created.">
        <div className="flex flex-col items-center gap-4 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-lg border border-accent/30 bg-accent-soft">
            <CheckCircle2 className="h-6 w-6 text-accent-text" />
          </span>
          <p className="max-w-sm text-[13px] leading-relaxed text-muted">
            We sent a verification link to your inbox. Confirm your address, then{' '}
            <Link
              href={canonicalAuthHref()}
              className="font-medium text-ink underline-offset-4 hover:underline"
            >
              sign in
            </Link>{' '}
            to join the community.
          </p>
        </div>
      </AuthFormShell>
    )
  }

  const passwordsMismatch = Boolean(confirmPassword && confirmPassword !== password)

  return (
    <AuthFormShell
      title="Join as alumnus"
      subtitle="Create your alumni profile for the CSE department."
    >
      <AuthSwitcher mode="signup" role="alumni" />

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
          <label htmlFor="alumni-name" className="label">
            Full name
          </label>
          <input
            id="alumni-name"
            type="text"
            required
            placeholder="e.g. Varun Kumar"
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
          <label htmlFor="alumni-email" className="label">
            Email address
          </label>
          <input
            id="alumni-email"
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

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="alumni-graduation-year" className="label">
              Graduation year
            </label>
            <select
              id="alumni-graduation-year"
              value={graduationYear}
              onChange={e => setGraduationYear(Number(e.target.value))}
              className="field-select"
            >
              {yearOptions.map(y => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="alumni-section" className="label">
              Section <span className="font-normal text-dim">(optional)</span>
            </label>
            <input
              id="alumni-section"
              type="text"
              placeholder="e.g. A"
              value={section}
              onChange={e => setSection(e.target.value)}
              className="field"
              maxLength={10}
            />
          </div>
        </div>

        <div>
          <label htmlFor="alumni-skills" className="label">
            Skills &amp; interests <span className="font-normal text-dim">(optional)</span>
          </label>
          <input
            id="alumni-skills"
            type="text"
            placeholder="e.g. Python, React, Machine Learning"
            value={skills}
            onChange={e => setSkills(e.target.value)}
            className="field"
          />
          <p className="mt-1.5 text-[10.5px] text-dim">
            Comma-separated — helps connect you with relevant peers
          </p>
        </div>

        <PasswordField
          id="alumni-password"
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
            id="alumni-confirm"
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
              <Loader2 className="h-4 w-4 animate-spin" /> Creating account…
            </>
          ) : (
            <>
              Create profile <ArrowRight className="h-4 w-4" />
            </>
          )}
        </button>
      </form>
    </AuthFormShell>
  )
}
