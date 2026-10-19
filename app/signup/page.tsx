'use client'

import React, { Suspense, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { AlertCircle, ArrowRight, CheckCircle2, Eye, EyeOff, Loader2 } from 'lucide-react'
import AuthFormShell from '@/components/AuthFormShell'
import { createClient } from '@/lib/supabase/client'
import { validateStudentSignup, parseTagList } from '@/lib/validation'
import { validateUSN, getYearFromUSN } from '@/lib/utils'

function PasswordField({
  id,
  label,
  value,
  onChange,
  placeholder,
  show,
  onToggle,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  placeholder: string
  show: boolean
  onToggle: () => void
}) {
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={show ? 'text' : 'password'}
          required
          placeholder={placeholder}
          value={value}
          onChange={e => onChange(e.target.value)}
          className="field pr-11"
          autoComplete="new-password"
        />
        <button
          type="button"
          onClick={onToggle}
          className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-dim transition-colors hover:text-ink"
          aria-label={show ? 'Hide password' : 'Show password'}
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </div>
  )
}

function SignUpForm() {
  const router = useRouter()
  const supabase = createClient()

  const [name, setName] = useState('')
  const [usn, setUsn] = useState('')
  const [email, setEmail] = useState('')
  const [year, setYear] = useState<number>(1)
  const [section, setSection] = useState('')
  const [skills, setSkills] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)

  const handleUsnChange = (val: string) => {
    const upper = val.toUpperCase().trim()
    setUsn(upper)
    setError('')
    const detected = getYearFromUSN(upper)
    if (detected) setYear(detected)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    const formattedUsn = usn.toUpperCase().trim()
    const validationError = validateStudentSignup({
      name,
      email,
      password,
      confirmPassword,
      usn: formattedUsn,
      year,
      section,
    })
    if (validationError) {
      setError(validationError)
      return
    }

    setLoading(true)
    try {
      const skillsList = parseTagList(skills)

      // Double-check USN availability before submitting.
      // The database unique constraint is the authoritative check;
      // this provides early user feedback.
      const { data: existing, error: usnCheckError } = await supabase
        .from('profiles')
        .select('id, role')
        .eq('usn', formattedUsn)
        .maybeSingle()

      if (usnCheckError) {
        // Column might not exist yet — log but proceed; DB constraint is authoritative
        console.error('USN check failed (relying on DB constraint):', usnCheckError)
      } else if (existing) {
        setError('This USN is already registered. Please sign in or contact the administrator.')
        setLoading(false)
        return
      }

      // Step 1: Create auth account
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            name: name.trim(),
            usn: formattedUsn,
            year,
            department: 'CSE',
            section: section.trim() || null,
            skills: skillsList,
            intent: 'student',
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
        // Check for USN uniqueness constraint violation (PG error code 23505)
        if (
          signUpError.message.includes('duplicate key') ||
          signUpError.message.includes('usn') ||
          signUpError.message.includes('profiles_student_usn_unique') ||
          signUpError.message.includes('profiles_usn_key')
        ) {
          setError('This USN is already registered. Please sign in or contact the administrator.')
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
      <AuthFormShell title="Check your email" subtitle="Your account has been created.">
        <div className="flex flex-col items-center gap-4 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-lg border border-accent/30 bg-accent-soft">
            <CheckCircle2 className="h-6 w-6 text-accent" />
          </span>
          <p className="max-w-sm text-[13px] leading-relaxed text-muted">
            We sent a verification link to your inbox. Confirm your address, then{' '}
            <Link href="/signin" className="font-medium text-ink underline-offset-4 hover:underline">
              sign in
            </Link>{' '}
            to join the feed.
          </p>
        </div>
      </AuthFormShell>
    )
  }

  const passwordsMismatch = Boolean(confirmPassword && confirmPassword !== password)

  return (
    <AuthFormShell
      title="Join the community"
      subtitle="Create your student profile for the CSE department."
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
          <label htmlFor="signup-name" className="label">
            Full name
          </label>
          <input
            id="signup-name"
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
          <label htmlFor="signup-usn" className="label">
            USN
          </label>
          <input
            id="signup-usn"
            type="text"
            required
            placeholder="e.g. 4UB24CS045"
            value={usn}
            onChange={e => handleUsnChange(e.target.value)}
            className="field font-mono uppercase placeholder:normal-case"
            maxLength={12}
          />
          {usn && !validateUSN(usn) ? (
            <p className="mt-1.5 text-[11px] text-danger">
              Invalid USN. Expected format: 4UB24CS045
            </p>
          ) : (
            <p className="mt-1.5 text-[10.5px] text-dim">
              4UB[YY]CS[Roll] — academic year is detected automatically
            </p>
          )}
        </div>

        <div>
          <label htmlFor="signup-email" className="label">
            Email address
          </label>
          <input
            id="signup-email"
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
            <label htmlFor="signup-year" className="label">
              Academic year
            </label>
            <select
              id="signup-year"
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
            <label htmlFor="signup-section" className="label">
              Section <span className="font-normal text-dim">(optional)</span>
            </label>
            <input
              id="signup-section"
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
          <label htmlFor="signup-skills" className="label">
            Skills &amp; interests <span className="font-normal text-dim">(optional)</span>
          </label>
          <input
            id="signup-skills"
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
          id="signup-password"
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
            id="signup-confirm"
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

        <div className="mt-2 space-y-2 text-center text-[12px] text-muted">
          <p>
            Already have an account?{' '}
            <Link href="/signin" className="font-medium text-ink underline-offset-4 hover:underline">
              Sign in
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

export default function SignUpPage() {
  return (
    <Suspense
      fallback={
        <AuthFormShell
          title="Join the community"
          subtitle="Create your student profile for the CSE department."
        >
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-dim" />
          </div>
        </AuthFormShell>
      }
    >
      <SignUpForm />
    </Suspense>
  )
}
