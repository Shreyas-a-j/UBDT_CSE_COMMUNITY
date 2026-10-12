'use client'

import React from 'react'
import Image from 'next/image'
import {
  User,
  GraduationCap,
  Sparkles,
  Edit3,
  Compass,
  Check,
  LogIn,
} from 'lucide-react'
import { useCommunity } from '@/contexts/CommunityContext'
import { getAvatarFallback, getYearLabel } from '@/lib/utils'
import { YearFilter } from '@/lib/types'

export default function SidebarLeft() {
  const {
    currentUser,
    yearFilter,
    setYearFilter,
    setIsProfileModalOpen,
    setSelectedProfileForView,
    setIsAuthModalOpen,
  } = useCommunity()

  return (
    <aside className="space-y-4">
      {/* Student Profile Card or Sign In Prompt */}
      {currentUser ? (
        <div className="card p-4 bg-white relative overflow-hidden">
          <div className="h-16 -mx-4 -mt-4 bg-gradient-to-r from-[#0d1f3c] via-[#1e3a5f] to-[#254b7a] relative">
            <span className="absolute top-2 right-2 text-[10px] font-mono uppercase bg-amber-400 text-slate-900 font-extrabold px-1.5 py-0.5 rounded shadow-xs">
              CSE Branch
            </span>
          </div>

          <div className="relative -mt-8 flex flex-col items-center text-center">
            <div className="w-16 h-16 rounded-full overflow-hidden bg-white p-0.5 shadow-md ring-2 ring-slate-100 mb-2">
              <div className="w-full h-full rounded-full overflow-hidden bg-[#1e3a5f] text-white flex items-center justify-center font-bold text-sm">
                {currentUser.avatar_url ? (
                  <Image
                    src={currentUser.avatar_url}
                    alt={currentUser.name}
                    width={64}
                    height={64}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  getAvatarFallback(currentUser.name)
                )}
              </div>
            </div>

            <h2 className="text-sm sm:text-base font-bold text-slate-900 leading-tight">
              {currentUser.name}
            </h2>

            <div className="flex items-center gap-1.5 mt-1">
              <span className="text-xs font-mono font-semibold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded">
                {currentUser.usn}
              </span>
              <span className="text-xs font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200/60">
                {getYearLabel(currentUser.year)}
              </span>
            </div>

            {currentUser.bio && (
              <p className="text-xs text-slate-600 mt-2.5 leading-relaxed line-clamp-3 px-1">
                {currentUser.bio}
              </p>
            )}

            {currentUser.skills && currentUser.skills.length > 0 && (
              <div className="flex flex-wrap justify-center gap-1 mt-3">
                {currentUser.skills.slice(0, 4).map(skill => (
                  <span
                    key={skill}
                    className="text-[10px] font-medium bg-slate-100 text-slate-700 px-2 py-0.5 rounded"
                  >
                    {skill}
                  </span>
                ))}
                {currentUser.skills.length > 4 && (
                  <span className="text-[10px] text-slate-400 px-1 py-0.5">
                    +{currentUser.skills.length - 4}
                  </span>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                setSelectedProfileForView(currentUser)
                setIsProfileModalOpen(true)
              }}
              className="w-full mt-3.5 inline-flex items-center justify-center gap-1.5 py-1.5 text-xs font-semibold text-[#1e3a5f] bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors"
            >
              <Edit3 className="w-3.5 h-3.5" />
              <span>Edit Profile & Skills</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="card p-4 bg-white text-center">
          <div className="w-12 h-12 rounded-full bg-slate-100 text-[#1e3a5f] flex items-center justify-center mx-auto mb-3">
            <GraduationCap className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-bold text-slate-900 mb-1">
            Join the CSE Community
          </h3>
          <p className="text-xs text-slate-500 mb-4 leading-relaxed">
            Sign in with your UBDT USN to post discussions, host workshops, and RSVP for events.
          </p>
          <button
            type="button"
            onClick={() => setIsAuthModalOpen(true)}
            className="w-full inline-flex items-center justify-center gap-2 py-2 px-3 bg-[#1e3a5f] hover:bg-[#152e4d] text-white text-xs font-bold rounded-lg shadow-xs transition-all"
          >
            <LogIn className="w-3.5 h-3.5" />
            <span>Sign In / Sign Up</span>
          </button>
        </div>
      )}

      {/* Year Filter Navigation */}
      <div className="card p-3.5 bg-white">
        <div className="flex items-center justify-between mb-2.5 px-1">
          <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
            <Compass className="w-3.5 h-3.5 text-[#1e3a5f]" />
            Filter by Year
          </span>
          <span className="text-[10px] text-slate-400">Target Year</span>
        </div>

        <div className="space-y-1">
          {[
            { value: 0, label: 'All Batches (1st to 4th)' },
            { value: 1, label: '1st Year (2024 Batch)' },
            { value: 2, label: '2nd Year (2023 Batch)' },
            { value: 3, label: '3rd Year (2022 Batch)' },
            { value: 4, label: '4th Year (2021 Batch)' },
          ].map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setYearFilter(opt.value as YearFilter)}
              className={`w-full text-left px-3 py-1.5 text-xs rounded-lg font-medium transition-all flex items-center justify-between ${
                yearFilter === opt.value
                  ? 'bg-[#1e3a5f] text-white font-bold shadow-xs'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <span>{opt.label}</span>
              {yearFilter === opt.value && <Check className="w-3.5 h-3.5 text-amber-300" />}
            </button>
          ))}
        </div>
      </div>

      {/* Department Quick Stats */}
      <div className="card p-3.5 bg-white text-xs text-slate-600 space-y-2">
        <span className="font-bold text-slate-800 block text-[11px] uppercase tracking-wider text-slate-400">
          UBDT CSE Stats
        </span>
        <div className="flex justify-between py-1 border-b border-slate-100">
          <span>Total Student Intake</span>
          <span className="font-bold text-[#1e3a5f]">480 Students</span>
        </div>
        <div className="flex justify-between py-1 border-b border-slate-100">
          <span>Annual Intake</span>
          <span className="font-semibold text-slate-800">120 per Year</span>
        </div>
        <div className="flex justify-between py-1">
          <span>Affiliation</span>
          <span className="font-semibold text-slate-800">Constituent VTU</span>
        </div>
      </div>
    </aside>
  )
}
