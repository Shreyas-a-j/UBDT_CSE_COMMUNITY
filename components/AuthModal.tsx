'use client'

import React, { useState } from 'react'
import { X, GraduationCap, ArrowRight, AlertCircle, Loader2, Eye, EyeOff, Mail } from 'lucide-react'
import { useCommunity } from '@/contexts/CommunityContext'
import { validateUSN, getYearFromUSN, getYearLabel } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'

export default function AuthModal() {
  const { isAuthModalOpen, setIsAuthModalOpen, setCurrentUser } = useCommunity()
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

  if (!isAuthModalOpen) return null

  const handleUsnChange = (val: string) => {
    const uppercaseVal = val.toUpperCase().trim()
    setUsn(uppercaseVal)
    setError('')
    const detected = getYearFromUSN(uppercaseVal)
    if (detected) setYear(detected)
  }

  const resetForm = () => {
    setUsn('')
    setName('')
    setEmail('')
    setPassword('')
    setConfirmPassword('')
    setYear(1)
    setError('')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    const formattedUsn = usn.toUpperCase().trim()
    if (!validateUSN(formattedUsn)) {
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

    setLoading(true)
    const authEmail = isSignUp ? email.trim() : `${formattedUsn.toLowerCase()}@ubdtce.org`

    try {
      if (isSignUp) {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: authEmail,
          password,
          options: {
            data: { name: name.trim(), usn: formattedUsn, year },
          },
        })

        if (signUpError) {
          if (signUpError.message.includes('already registered')) {
            setError('This USN or email is already registered. Please sign in.')
            setLoading(false)
            return
          }
          throw signUpError
        }

        const userId = data.user?.id || `user-${Date.now()}`
        const newProfile = {
          id: userId,
          usn: formattedUsn,
          name: name.trim(),
          year: year || 1,
          branch: 'CSE',
          bio: `${getYearLabel(year || 1)} student at UCC.`,
          avatar_url: null,
          skills: [],
          created_at: new Date().toISOString(),
        }
        try { await supabase.from('user_profiles').upsert(newProfile) } catch {}
        setCurrentUser(newProfile)
      } else {
        const tryEmails = [
          email.trim(),
          `${formattedUsn.toLowerCase()}@ubdtce.org`,
        ].filter(Boolean)

        let signedIn = false
        for (const tryEmail of tryEmails) {
          const { data, error: signInError } = await supabase.auth.signInWithPassword({
            email: tryEmail,
            password,
          })
          if (!signInError && data.user) {
            const { data: profileData } = await supabase
              .from('user_profiles').select('*').eq('id', data.user.id).single()
            if (profileData) {
              setCurrentUser(profileData)
            } else {
              setCurrentUser({
                id: data.user.id,
                usn: formattedUsn,
                name: data.user.user_metadata?.name || `Student`,
                year: data.user.user_metadata?.year || year,
                branch: 'CSE',
                bio: null,
                avatar_url: null,
                skills: [],
                created_at: new Date().toISOString(),
              })
            }
            signedIn = true
            break
          }
        }
        if (!signedIn) {
          setError('Invalid credentials. Please check your USN and password.')
          setLoading(false)
          return
        }
      }

      resetForm()
      setIsAuthModalOpen(false)
    } catch (err: any) {
      setError(err?.message || 'Authentication error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ background: '#0b1220', border: '2px solid #00aaff', boxShadow: '6px 6px 0px #000, 0 0 24px rgba(0,170,255,0.18)', borderRadius: 0, overflow: 'hidden', outline: 'none' }}>
        {/* Header */}
        <div style={{ background: '#090e1c', borderBottom: '2px solid #1e3560', padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, background: '#00aaff', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '2px 2px 0px #000' }}>
              <GraduationCap style={{ width: 20, height: 20, color: '#060a14' }} />
            </div>
            <div>
              <h2 style={{ fontSize: '0.95rem', color: '#e8f4fd', fontWeight: 700, lineHeight: 1.3, textTransform: 'uppercase', letterSpacing: '0.03em', margin: 0 }}>
                {isSignUp ? 'JOIN UCC COMMUNITY' : 'WELCOME BACK'}
              </h2>
              <p style={{ fontSize: '0.72rem', color: '#00ffcc', margin: '2px 0 0 0', fontWeight: 500 }}>
                {isSignUp ? 'Create your UCC student profile' : 'Sign in with your USN'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => { resetForm(); setIsAuthModalOpen(false) }}
            style={{ background: 'transparent', border: '2px solid #1e3560', padding: '5px', cursor: 'pointer', color: '#6bafd4', display: 'flex', alignItems: 'center' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = '#00aaff'; (e.currentTarget as HTMLElement).style.color = '#e8f4fd' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = '#1e3560'; (e.currentTarget as HTMLElement).style.color = '#6bafd4' }}
          >
            <X style={{ width: 16, height: 16 }} />
          </button>
        </div>

        {/* Toggle Tabs */}
        <div style={{ display: 'flex', borderBottom: '2px solid #1e3560', background: '#080d18' }}>
          {['SIGN UP', 'SIGN IN'].map((tab, i) => (
            <button
              key={tab}
              type="button"
              onClick={() => { setIsSignUp(i === 0); setError('') }}
              style={{ flex: 1, padding: '10px', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer', border: 'none', borderBottom: isSignUp === (i === 0) ? '2px solid #00aaff' : '2px solid transparent', background: isSignUp === (i === 0) ? 'rgba(0,170,255,0.08)' : 'transparent', color: isSignUp === (i === 0) ? '#00aaff' : '#6bafd4', transition: 'all 0.05s steps(1)', letterSpacing: '0.04em' }}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 13 }}>
          {error && (
            <div style={{ padding: '8px 12px', background: 'rgba(255,68,102,0.1)', border: '2px solid rgba(255,68,102,0.4)', color: '#ff6688', display: 'flex', alignItems: 'center', gap: 8, boxShadow: '2px 2px 0px #661133' }}>
              <AlertCircle style={{ width: 14, height: 14, flexShrink: 0 }} />
              <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>{error}</span>
            </div>
          )}

          {/* Full Name — sign up only */}
          {isSignUp && (
            <div>
              <label className="label">Full Name</label>
              <input
                type="text"
                required
                placeholder="e.g. Varun Kumar"
                value={name}
                onChange={e => setName(e.target.value)}
                className="input"
              />
            </div>
          )}

          {/* USN */}
          <div>
            <label className="label">USN (University Seat Number)</label>
            <input
              type="text"
              required
              placeholder="e.g. 4UB24CS045"
              value={usn}
              onChange={e => handleUsnChange(e.target.value)}
              className="input uppercase"
              maxLength={12}
            />
            <p style={{ fontSize: '0.7rem', color: '#6bafd4', marginTop: 4 }}>
              Format: 4UB[YY]CS[Roll] — academic year is auto-detected
            </p>
          </div>

          {/* Email — sign up only */}
          {isSignUp && (
            <div>
              <label className="label" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <Mail style={{ width: 13, height: 13, color: '#00aaff' }} /> Email Address
              </label>
              <input
                type="email"
                required
                placeholder="e.g. varun@gmail.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="input"
              />
            </div>
          )}

          {/* Academic Year — sign up only */}
          {isSignUp && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label className="label">Academic Year</label>
                <select value={year} onChange={e => setYear(Number(e.target.value))} className="select">
                  <option value={1}>1st Year</option>
                  <option value={2}>2nd Year</option>
                  <option value={3}>3rd Year</option>
                  <option value={4}>4th Year</option>
                </select>
              </div>
              <div>
                <label className="label">Department</label>
                <input
                  type="text"
                  disabled
                  value="CSE (Fixed)"
                  className="input"
                  style={{ background: '#090d16', color: '#00aaff', opacity: 0.8, cursor: 'not-allowed', fontWeight: 600 }}
                />
              </div>
            </div>
          )}

          {/* Password */}
          <div>
            <label className="label">Password</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                required
                placeholder="Min. 6 characters"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="input pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Confirm Password — sign up only */}
          {isSignUp && (
            <div>
              <label className="label">Confirm Password</label>
              <div className="relative">
                <input
                  type={showConfirm ? 'text' : 'password'}
                  required
                  placeholder="Re-enter your password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  className="input pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm(!showConfirm)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                >
                  {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {confirmPassword && confirmPassword !== password && (
                <p style={{ fontSize: '0.7rem', color: '#ff6688', marginTop: 4 }}>Passwords do not match</p>
              )}
            </div>
          )}

          {/* Submit */}
          <div style={{ paddingTop: 8 }}>
            <button
              type="submit"
              disabled={loading || (isSignUp && !!confirmPassword && confirmPassword !== password)}
              style={{ width: '100%', padding: '10px', background: '#00aaff', color: '#060a14', border: '2px solid #0088cc', fontSize: '0.8125rem', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, boxShadow: '4px 4px 0px #003366', textTransform: 'uppercase', opacity: loading ? 0.7 : 1, letterSpacing: '0.03em' }}
            >
              {loading ? (
                <><Loader2 style={{ width: 14, height: 14 }} className="animate-spin" /><span>PLEASE WAIT...</span></>
              ) : (
                <><span>{isSignUp ? 'CREATE PROFILE & JOIN' : 'SIGN IN'}</span><ArrowRight style={{ width: 14, height: 14 }} /></>
              )}
            </button>
          </div>

          <p style={{ textAlign: 'center', fontSize: '0.75rem', color: '#6bafd4', paddingTop: 4 }}>
            {isSignUp ? 'Already have an account? ' : "Don't have an account? "}
            <button
              type="button"
              onClick={() => { setIsSignUp(!isSignUp); setError('') }}
              style={{ fontSize: '0.75rem', color: '#00ffcc', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', fontWeight: 600 }}
            >
              {isSignUp ? 'SIGN IN' : 'SIGN UP'}
            </button>
          </p>
        </form>
      </div>
    </div>
  )
}
