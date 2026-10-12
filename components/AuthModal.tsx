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
    // Use the provided email for sign-up, derive email for sign-in
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
          bio: `${getYearLabel(year || 1)} student at UBDT College of Engineering, Davangere.`,
          avatar_url: null,
          skills: [],
          created_at: new Date().toISOString(),
        }
        try { await supabase.from('profiles').upsert(newProfile) } catch {}
        setCurrentUser(newProfile)
      } else {
        // For sign-in, try stored email first then derived email
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
              .from('profiles').select('*').eq('id', data.user.id).single()
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
      <div className="modal-content overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-[#0a1628] via-[#1e3a5f] to-[#254b7a] p-5 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-amber-400 text-slate-900 flex items-center justify-center">
              <GraduationCap className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold leading-snug">
                {isSignUp ? 'Join UBDT CSE Community' : 'Welcome Back'}
              </h2>
              <p className="text-[11px] text-amber-200/80">
                {isSignUp ? 'Create your student profile' : 'Sign in to your account'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => { resetForm(); setIsAuthModalOpen(false) }}
            className="p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Toggle Tabs */}
        <div className="flex border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60">
          {['Sign Up', 'Sign In'].map((tab, i) => (
            <button
              key={tab}
              type="button"
              onClick={() => { setIsSignUp(i === 0); setError('') }}
              className={`flex-1 py-2.5 text-xs font-bold transition-all ${
                isSignUp === (i === 0)
                  ? 'bg-white dark:bg-slate-900 text-[#1e3a5f] dark:text-amber-400 border-b-2 border-[#1e3a5f] dark:border-amber-400'
                  : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-3 text-xs">
          {error && (
            <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-400 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
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
                className="input text-xs"
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
              className="input font-mono uppercase text-xs"
              maxLength={12}
            />
            <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1">
              Format: 4UB[YY]CS[Roll] — year is auto-derived
            </p>
          </div>

          {/* Email — sign up only */}
          {isSignUp && (
            <div>
              <label className="label flex items-center gap-1">
                <Mail className="w-3 h-3" /> Email Address
              </label>
              <input
                type="email"
                required
                placeholder="e.g. varun@gmail.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="input text-xs"
              />
            </div>
          )}

          {/* Academic Year — sign up only */}
          {isSignUp && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Academic Year</label>
                <select value={year} onChange={e => setYear(Number(e.target.value))} className="select text-xs">
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
                  className="input text-xs bg-slate-100 dark:bg-slate-700 text-slate-400 cursor-not-allowed"
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
                className="input text-xs pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
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
                  className={`input text-xs pr-10 ${
                    confirmPassword && confirmPassword !== password
                      ? 'border-rose-400 focus:border-rose-400'
                      : ''
                  }`}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm(!showConfirm)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                >
                  {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {confirmPassword && confirmPassword !== password && (
                <p className="text-[10px] text-rose-500 mt-1">Passwords do not match</p>
              )}
            </div>
          )}

          {/* Submit */}
          <div className="pt-2">
            <button
              type="submit"
              disabled={loading || (isSignUp && !!confirmPassword && confirmPassword !== password)}
              className="w-full py-2.5 rounded-xl bg-[#1e3a5f] hover:bg-[#152e4d] text-white font-bold text-xs flex items-center justify-center gap-2 shadow-sm transition-all disabled:opacity-60"
            >
              {loading ? (
                <><Loader2 className="w-4 h-4 animate-spin" /><span>Please wait…</span></>
              ) : (
                <><span>{isSignUp ? 'Create Profile & Join' : 'Sign In'}</span><ArrowRight className="w-3.5 h-3.5" /></>
              )}
            </button>
          </div>

          <p className="text-center text-slate-400 dark:text-slate-500 text-[11px]">
            {isSignUp ? 'Already have an account? ' : "Don't have an account? "}
            <button
              type="button"
              onClick={() => { setIsSignUp(!isSignUp); setError('') }}
              className="text-[#1e3a5f] dark:text-amber-400 font-bold hover:underline"
            >
              {isSignUp ? 'Sign In' : 'Sign Up'}
            </button>
          </p>
        </form>
      </div>
    </div>
  )
}
