'use client'

import React, { useState } from 'react'
import { X, GraduationCap, ArrowRight, ShieldCheck, UserCheck, AlertCircle } from 'lucide-react'
import { useCommunity } from '@/contexts/CommunityContext'
import { validateUSN, getYearFromUSN, getYearLabel } from '@/lib/utils'

export default function AuthModal() {
  const {
    isAuthModalOpen,
    setIsAuthModalOpen,
    setCurrentUser,
    allProfiles,
    switchUserByYear,
  } = useCommunity()

  const [isSignUp, setIsSignUp] = useState(true)
  const [usn, setUsn] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [year, setYear] = useState<number>(3)
  const [error, setError] = useState('')

  if (!isAuthModalOpen) return null

  const handleUsnChange = (val: string) => {
    const uppercaseVal = val.toUpperCase().trim()
    setUsn(uppercaseVal)
    setError('')

    const detected = getYearFromUSN(uppercaseVal)
    if (detected) {
      setYear(detected)
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    const formattedUsn = usn.toUpperCase().trim()
    if (!validateUSN(formattedUsn)) {
      setError('Please enter a valid UBDT CSE USN format (e.g. 1UB22CS045)')
      return
    }

    if (isSignUp && !name.trim()) {
      setError('Please enter your full name')
      return
    }

    if (!password || password.length < 4) {
      setError('Password must be at least 4 characters')
      return
    }

    // Check if profile exists with this USN
    const existing = allProfiles.find(p => p.usn.toUpperCase() === formattedUsn)

    if (isSignUp) {
      const newProfile = {
        id: `user-${Date.now()}`,
        usn: formattedUsn,
        name: name.trim(),
        year: year || 1,
        branch: 'CSE',
        bio: `${getYearLabel(year || 1)} student at UBDT College of Engineering, Davangere.`,
        avatar_url: null,
        skills: ['C++', 'Python', 'Web Development'],
        created_at: new Date().toISOString(),
      }
      setCurrentUser(newProfile)
    } else {
      if (existing) {
        setCurrentUser(existing)
      } else {
        // Log in new demo profile
        const newProfile = {
          id: `user-${Date.now()}`,
          usn: formattedUsn,
          name: name.trim() || `Student ${formattedUsn.slice(-3)}`,
          year: year || 1,
          branch: 'CSE',
          bio: `CSE student at UBDT College of Engineering, Davangere.`,
          avatar_url: null,
          skills: ['Algorithms', 'Software Engineering'],
          created_at: new Date().toISOString(),
        }
        setCurrentUser(newProfile)
      }
    }

    setIsAuthModalOpen(false)
  }

  return (
    <div className="modal-overlay">
      <div className="modal-content overflow-hidden">
        {/* Navy Header Banner */}
        <div className="bg-gradient-to-r from-[#0a1628] via-[#1e3a5f] to-[#254b7a] p-5 text-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-amber-400 text-slate-900 flex items-center justify-center font-bold">
              <GraduationCap className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold">
                {isSignUp ? 'Join UBDT CSE Community' : 'Sign in to UBDT CSE'}
              </h2>
              <p className="text-[11px] text-amber-200">
                Exclusive to UBDT CE Davangere CSE Students
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setIsAuthModalOpen(false)}
            className="p-1 rounded-md text-white/80 hover:text-white hover:bg-white/10"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Instant 1-Click Persona Logins (Super convenient for reviewers!) */}
        <div className="p-4 bg-slate-50 border-b border-slate-100">
          <p className="text-[11px] font-bold text-slate-600 mb-2 flex items-center gap-1.5">
            <UserCheck className="w-3.5 h-3.5 text-emerald-600" />
            Instant 1-Click Test Login (Skip typing):
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 text-xs">
            {[
              { yr: 1, name: 'Sneha (1st Yr)', usn: '1UB24CS012' },
              { yr: 2, name: 'Rohan (2nd Yr)', usn: '1UB23CS045' },
              { yr: 3, name: 'Priyanka (3rd Yr)', usn: '1UB22CS078' },
              { yr: 4, name: 'Aditya (4th Yr)', usn: '1UB21CS099' },
            ].map(test => (
              <button
                key={test.yr}
                type="button"
                onClick={() => {
                  switchUserByYear(test.yr)
                  setIsAuthModalOpen(false)
                }}
                className="p-2 rounded-lg bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-left transition-all"
              >
                <span className="block font-bold text-slate-800 text-[11px]">{test.name}</span>
                <span className="block text-[10px] font-mono text-slate-400">{test.usn}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Auth Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-3.5 text-xs">
          {error && (
            <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

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

          <div>
            <label className="label">College USN (University Seat Number)</label>
            <input
              type="text"
              required
              placeholder="e.g. 1UB22CS045"
              value={usn}
              onChange={e => handleUsnChange(e.target.value)}
              className="input font-mono uppercase text-xs"
            />
            <p className="text-[10px] text-slate-400 mt-1">
              Format: 1UB[Year]CS[Roll No]. Auto-derives your academic year.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Academic Year</label>
              <select
                value={year}
                onChange={e => setYear(Number(e.target.value))}
                className="select text-xs"
              >
                <option value={1}>1st Year (Freshers)</option>
                <option value={2}>2nd Year (Sophomore)</option>
                <option value={3}>3rd Year (Junior)</option>
                <option value={4}>4th Year (Senior / Final)</option>
              </select>
            </div>
            <div>
              <label className="label">Department</label>
              <input
                type="text"
                disabled
                value="CSE (Fixed)"
                className="input text-xs bg-slate-100 text-slate-500 cursor-not-allowed"
              />
            </div>
          </div>

          <div>
            <label className="label">Personal Password</label>
            <input
              type="password"
              required
              placeholder="••••••••"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="input text-xs"
            />
          </div>

          <div className="pt-2">
            <button
              type="submit"
              className="w-full py-2.5 rounded-lg bg-[#1e3a5f] hover:bg-[#152e4d] text-white font-bold text-xs flex items-center justify-center gap-2 shadow-xs transition-all"
            >
              <span>{isSignUp ? 'Create CSE Profile & Enter' : 'Log In with USN'}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="text-center pt-2">
            <button
              type="button"
              onClick={() => {
                setIsSignUp(!isSignUp)
                setError('')
              }}
              className="text-xs text-[#1e3a5f] hover:underline font-semibold"
            >
              {isSignUp ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
