'use client'

import React from 'react'
import Link from 'next/link'
import { Check, Compass, Edit3, GraduationCap, LogIn } from 'lucide-react'
import { useCommunity } from '@/contexts/CommunityContext'
import { getYearLabel } from '@/lib/utils'
import { displayName } from '@/lib/profile'
import { YearFilter } from '@/lib/types'
import UserAvatar from '@/components/UserAvatar'

const BATCHES: { value: YearFilter; label: string; code: string }[] = [
  { value: 0, label: 'All batches', code: '1–4' },
  { value: 1, label: '1st year', code: '4UB26' },
  { value: 2, label: '2nd year', code: '4UB25' },
  { value: 3, label: '3rd year', code: '4UB24' },
  { value: 4, label: '4th year', code: '4UB23' },
]

export default function SidebarLeft() {
  const {
    currentUser, yearFilter, setYearFilter, setIsProfileModalOpen,
    setSelectedProfileForView, setIsAuthModalOpen,
  } = useCommunity()

  return (
    <aside className="flex flex-col gap-4">
      {currentUser ? (
        <div className="card overflow-hidden">
          <div
            className="h-14 border-b border-line"
            style={{
              background:
                'radial-gradient(120% 140% at 0% 0%, color-mix(in oklab, var(--color-accent) 18%, transparent), transparent 62%)',
            }}
          />
          <div className="px-4 pb-4">
            <div className="-mt-6 flex items-end justify-between">
              <UserAvatar
                src={currentUser.avatar_url}
                name={displayName(currentUser)}
                size={52}
                className="ring-4 ring-surface"
              />
              <span className="chip chip-mono mb-1">CSE</span>
            </div>

            <h2 className="mt-3 truncate font-display text-[15px] font-semibold text-ink">
              {displayName(currentUser)}
            </h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {currentUser.usn && <span className="chip chip-mono">{currentUser.usn}</span>}
              <span className="chip">{getYearLabel(currentUser.year)}</span>
            </div>

            {currentUser.bio && (
              <p className="clamp-2 mt-3 text-[12.5px] leading-relaxed text-muted">{currentUser.bio}</p>
            )}

            {currentUser.skills && currentUser.skills.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {currentUser.skills.slice(0, 4).map(skill => (
                  <span key={skill} className="chip">
                    {skill}
                  </span>
                ))}
                {currentUser.skills.length > 4 && (
                  <span className="chip border-dashed">+{currentUser.skills.length - 4}</span>
                )}
              </div>
            )}

            <div className="mt-4 grid grid-cols-2 gap-2">
              <Link href={`/people/${currentUser.id}`} className="btn btn-outline btn-sm">
                Profile
              </Link>
              <button
                type="button"
                className="btn btn-soft btn-sm"
                onClick={() => {
                  setSelectedProfileForView(currentUser)
                  setIsProfileModalOpen(true)
                }}
              >
                <Edit3 className="h-3.5 w-3.5" />
                Edit
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="card p-5">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-line bg-elevated">
            <GraduationCap className="h-5 w-5 text-accent" />
          </span>
          <h2 className="mt-3 font-display text-[15px] font-semibold text-ink">Join the community</h2>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
            Sign in with your USN to post discussions, host workshops and RSVP to events.
          </p>
          <button
            type="button"
            className="btn btn-accent btn-block mt-4"
            onClick={() => setIsAuthModalOpen(true)}
          >
            <LogIn className="h-4 w-4" />
            Sign in or join
          </button>
        </div>
      )}

      <section className="card p-4" aria-labelledby="batch-filter-heading">
        <div className="mb-2 flex items-center justify-between">
          <h3 id="batch-filter-heading" className="flex items-center gap-1.5 font-display text-[13px] font-semibold text-ink">
            <Compass className="h-3.5 w-3.5 text-dim" />
            Filter by batch
          </h3>
          <span className="font-mono text-[10px] text-dim">Year</span>
        </div>

        <div className="flex flex-col gap-0.5">
          {BATCHES.map(opt => {
            const active = yearFilter === opt.value
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setYearFilter(opt.value)}
                aria-pressed={active}
                className={`flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-[12.5px] transition-colors ${
                  active
                    ? 'bg-accent/10 text-ink'
                    : 'text-muted hover:bg-elevated hover:text-ink'
                }`}
              >
                <span className="flex items-center gap-2">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      active ? 'bg-accent' : 'bg-line-strong'
                    }`}
                  />
                  {opt.label}
                </span>
                <span className={`font-mono text-[10.5px] ${active ? 'text-accent' : 'text-dim'}`}>
                  {active ? <Check className="h-3.5 w-3.5" /> : opt.code}
                </span>
              </button>
            )
          })}
        </div>
      </section>

      <section className="card p-4" aria-labelledby="dept-heading">
        <h3 id="dept-heading" className="mb-3 font-display text-[13px] font-semibold text-ink">
          Department
        </h3>
        <dl className="space-y-2.5 text-[12px]">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-dim">Programme</dt>
            <dd className="text-right text-muted">B.E. Computer Science</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-dim">Batches</dt>
            <dd className="font-mono text-muted">1st – 4th year</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-dim">Affiliation</dt>
            <dd className="font-mono text-muted">VTU</dd>
          </div>
        </dl>
      </section>
    </aside>
  )
}
