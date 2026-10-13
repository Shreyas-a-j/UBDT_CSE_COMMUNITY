'use client'

import React, { Suspense, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { AlertCircle, Loader2, Eye, EyeOff, ArrowRight, CheckCircle2 } from 'lucide-react'
import AuthFormShell from '@/components/AuthFormShell'
import { createClient } from '@/lib/supabase/client'
import { validateStudentSignup, parseTagList } from '@/lib/validation'
import { validateUSN, getYearFromUSN } from '@/lib/utils'

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
      <AuthFormShell title="CHECK YOUR EMAIL" subtitle="Account created successfully">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center', textAlign: 'center' }}>
          <CheckCircle2 style={{ width: 48, height: 48, color: '#00ffcc' }} />
          <p style={{ color: '#a8d4f0', fontSize: '0.875rem', lineHeight: 1.6, margin: 0 }}>
            Your account has been created. Please check your email to verify your address, then{' '}
            <Link href="/signin" style={{ color: '#00aaff', fontWeight: 600 }}>
              sign in
            </Link>
            .
          </p>
        </div>
      </AuthFormShell>
    )
  }

  return (
    <AuthFormShell title="JOIN UCC COMMUNITY" subtitle="Create your student profile">
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
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

        {/* Full Name */}
        <div>
          <label className="label">Full Name</label>
          <input
            type="text"
            required
            placeholder="e.g. Varun Kumar"
            value={name}
            onChange={e => { setName(e.target.value); setError('') }}
            className="input"
            autoComplete="name"
          />
        </div>

        {/* USN */}
        <div>
          <label className="label">USN (University Seat Number)</label>
          <input
            type="text"
            required
            placeholder="e.g. 4UB24CS045"
            value={usn}
            onChange={e => handleUsnChange(e.target.value)}
            className="input"
            style={{ textTransform: 'uppercase' }}
            maxLength={12}
          />
          {usn && !validateUSN(usn) && (
            <p style={{ fontSize: '0.7rem', color: '#ff6688', marginTop: 4 }}>
              Invalid USN. Expected format: 4UB24CS045
            </p>
          )}
          {!usn && (
            <p style={{ fontSize: '0.7rem', color: '#6bafd4', marginTop: 4 }}>
              Format: 4UB[YY]CS[Roll] — academic year is auto-detected
            </p>
          )}
        </div>

        {/* Email */}
        <div>
          <label className="label">Email Address</label>
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

        {/* Academic Year + Section */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label className="label">Academic Year</label>
            <select
              value={year}
              onChange={e => setYear(Number(e.target.value))}
              className="select"
            >
              <option value={1}>1st Year</option>
              <option value={2}>2nd Year</option>
              <option value={3}>3rd Year</option>
              <option value={4}>4th Year</option>
            </select>
          </div>
          <div>
            <label className="label">Section (optional)</label>
            <input
              type="text"
              placeholder="e.g. A"
              value={section}
              onChange={e => setSection(e.target.value)}
              className="input"
              maxLength={10}
            />
          </div>
        </div>

        {/* Skills */}
        <div>
          <label className="label">Skills &amp; Interests (optional)</label>
          <input
            type="text"
            placeholder="e.g. Python, React, Machine Learning"
            value={skills}
            onChange={e => setSkills(e.target.value)}
            className="input"
          />
          <p style={{ fontSize: '0.7rem', color: '#6bafd4', marginTop: 4 }}>
            Comma-separated — helps connect you with relevant peers
          </p>
        </div>

        {/* Password */}
        <div>
          <label className="label">Password</label>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              required
              placeholder="Min. 6 characters"
              value={password}
              onChange={e => { setPassword(e.target.value); setError('') }}
              className="input pr-10"
              autoComplete="new-password"
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

        {/* Confirm Password */}
        <div>
          <label className="label">Confirm Password</label>
          <div className="relative">
            <input
              type={showConfirm ? 'text' : 'password'}
              required
              placeholder="Re-enter your password"
              value={confirmPassword}
              onChange={e => { setConfirmPassword(e.target.value); setError('') }}
              className="input pr-10"
              autoComplete="new-password"
            />
            <button
              type="button"
              onClick={() => setShowConfirm(v => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
            >
              {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          {confirmPassword && confirmPassword !== password && (
            <p style={{ fontSize: '0.7rem', color: '#ff6688', marginTop: 4 }}>
              Passwords do not match
            </p>
          )}
        </div>

        {/* Submit */}
        <div style={{ paddingTop: 4 }}>
          <button
            type="submit"
            disabled={loading || (!!confirmPassword && confirmPassword !== password)}
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
                <span>CREATING ACCOUNT...</span>
              </>
            ) : (
              <>
                <span>CREATE PROFILE &amp; JOIN</span>
                <ArrowRight style={{ width: 14, height: 14 }} />
              </>
            )}
          </button>
        </div>

        {/* Links */}
        <p style={{ textAlign: 'center', fontSize: '0.75rem', color: '#6bafd4', margin: 0 }}>
          Already have an account?{' '}
          <Link href="/signin" style={{ color: '#00ffcc', fontWeight: 600, textDecoration: 'underline' }}>
            SIGN IN
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

export default function SignUpPage() {
  return (
    <Suspense fallback={
      <AuthFormShell title="JOIN UCC COMMUNITY" subtitle="Create your student profile">
        <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
          <Loader2 style={{ width: 32, height: 32, color: '#00aaff' }} className="animate-spin" />
        </div>
      </AuthFormShell>
    }>
      <SignUpForm />
    </Suspense>
  )
}
