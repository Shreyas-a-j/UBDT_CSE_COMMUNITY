'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { AlertCircle, Loader2, Eye, EyeOff, ArrowRight, CheckCircle2, Clock } from 'lucide-react'
import AuthFormShell from '@/components/AuthFormShell'
import { createClient } from '@/lib/supabase/client'
import { validateFacultySignup } from '@/lib/validation'

export default function FacultySignUpPage() {
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
  const [submitted, setSubmitted] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

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
      return
    }

    setLoading(true)
    try {
      // Step 1: Create auth account (role will be 'student' until admin approves)
      const { data, error: signUpError } = await supabase.auth.signUp({
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
          setError('This email is already registered. Please sign in instead.')
          return
        }
        throw signUpError
      }

      const userId = data.user?.id
      if (!userId) {
        // Email confirmation required — still submit the application row if possible
        // We can't insert faculty_applications without the user id; show pending message
        setSubmitted(true)
        return
      }

      // Step 2: Insert faculty application row
      const { error: appError } = await supabase.from('faculty_applications').insert({
        user_id: userId,
        full_name: name.trim(),
        official_email: email.trim(),
        department: department.trim(),
        designation: designation.trim(),
        employee_id: employeeId.trim() || null,
        status: 'pending',
      })

      if (appError) {
        // Application insert failed — account was created but application not recorded.
        // Non-fatal: user can contact admin. Don't block the success state.
        console.error('Faculty application insert failed:', appError.message)
      }

      setSubmitted(true)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Sign up failed. Please try again.'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  if (submitted) {
    return (
      <AuthFormShell title="APPLICATION SUBMITTED" subtitle="Faculty access request received">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, alignItems: 'center', textAlign: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
            <CheckCircle2 style={{ width: 36, height: 36, color: '#00ffcc' }} />
            <Clock style={{ width: 36, height: 36, color: '#ffe066' }} />
          </div>
          <div
            style={{
              padding: '12px 16px',
              background: 'rgba(0,255,204,0.08)',
              border: '2px solid rgba(0,255,204,0.3)',
              width: '100%',
            }}
          >
            <p style={{ color: '#00ffcc', fontSize: '0.875rem', fontWeight: 700, margin: '0 0 6px' }}>
              YOUR ACCOUNT IS UNDER REVIEW
            </p>
            <p style={{ color: '#a8d4f0', fontSize: '0.8rem', lineHeight: 1.6, margin: 0 }}>
              You will be notified once an administrator approves your faculty application. Until then, your
              account has standard student access.
            </p>
          </div>
          <p style={{ color: '#6bafd4', fontSize: '0.75rem', margin: 0 }}>
            <Link href="/signin" style={{ color: '#00aaff', fontWeight: 600 }}>
              Sign in to your account
            </Link>{' '}
            while you wait for approval.
          </p>
        </div>
      </AuthFormShell>
    )
  }

  return (
    <AuthFormShell title="FACULTY ACCESS REQUEST" subtitle="Submit your application for faculty verification">
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Security notice */}
        <div
          style={{
            padding: '8px 12px',
            background: 'rgba(255,224,102,0.06)',
            border: '2px solid rgba(255,224,102,0.25)',
            color: '#ffe066',
            fontSize: '0.72rem',
            lineHeight: 1.5,
          }}
        >
          Your application will be reviewed by an administrator before faculty permissions are granted. Until
          approved, your account will have standard student access.
        </div>

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
            placeholder="e.g. Dr. Anita Sharma"
            value={name}
            onChange={e => { setName(e.target.value); setError('') }}
            className="input"
            autoComplete="name"
          />
        </div>

        {/* Official Email */}
        <div>
          <label className="label">Official Institutional Email</label>
          <input
            type="email"
            required
            placeholder="e.g. anita.sharma@ubdt.ac.in"
            value={email}
            onChange={e => { setEmail(e.target.value); setError('') }}
            className="input"
            autoComplete="email"
          />
        </div>

        {/* Department + Designation */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label className="label">Department</label>
            <input
              type="text"
              required
              placeholder="e.g. CSE"
              value={department}
              onChange={e => { setDepartment(e.target.value); setError('') }}
              className="input"
            />
          </div>
          <div>
            <label className="label">Designation</label>
            <input
              type="text"
              required
              placeholder="e.g. Assistant Professor"
              value={designation}
              onChange={e => { setDesignation(e.target.value); setError('') }}
              className="input"
            />
          </div>
        </div>

        {/* Employee ID */}
        <div>
          <label className="label">Employee ID (optional)</label>
          <input
            type="text"
            placeholder="e.g. UBDT-FAC-042"
            value={employeeId}
            onChange={e => { setEmployeeId(e.target.value); setError('') }}
            className="input"
          />
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
              background: '#ffe066',
              color: '#060a14',
              border: '2px solid #ccb300',
              fontSize: '0.8125rem',
              fontWeight: 700,
              cursor: loading ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              boxShadow: '4px 4px 0px #665500',
              textTransform: 'uppercase',
              opacity: loading ? 0.7 : 1,
              letterSpacing: '0.03em',
            }}
          >
            {loading ? (
              <>
                <Loader2 style={{ width: 14, height: 14 }} className="animate-spin" />
                <span>SUBMITTING...</span>
              </>
            ) : (
              <>
                <span>SUBMIT APPLICATION</span>
                <ArrowRight style={{ width: 14, height: 14 }} />
              </>
            )}
          </button>
        </div>

        {/* Links */}
        <p style={{ textAlign: 'center', fontSize: '0.75rem', color: '#6bafd4', margin: 0 }}>
          Already have an account?{' '}
          <Link href="/signin" style={{ color: '#00aaff', fontWeight: 600, textDecoration: 'underline' }}>
            SIGN IN
          </Link>
        </p>
        <p style={{ textAlign: 'center', fontSize: '0.75rem', color: '#6bafd4', margin: 0 }}>
          Student registration?{' '}
          <Link href="/signup" style={{ color: '#00ffcc', fontWeight: 600 }}>
            Sign up here
          </Link>
        </p>
      </form>
    </AuthFormShell>
  )
}
