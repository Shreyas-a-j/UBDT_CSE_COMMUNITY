'use client'

import React from 'react'
import Image from 'next/image'
import { GraduationCap, Edit3, Compass, Check, LogIn } from 'lucide-react'
import { useCommunity } from '@/contexts/CommunityContext'
import { getYearLabel } from '@/lib/utils'
import { displayName } from '@/lib/profile'
import Link from 'next/link'
import { YearFilter } from '@/lib/types'
import UserAvatar from '@/components/UserAvatar'

export default function SidebarLeft() {
  const { currentUser, yearFilter, setYearFilter, setIsProfileModalOpen, setSelectedProfileForView, setIsAuthModalOpen } = useCommunity()

  return (
    <aside style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Profile Card or Sign In */}
      {currentUser ? (
        <div style={{ background: '#0d1426', border: '2px solid #1e3560', boxShadow: '4px 4px 0px #000', position: 'relative', overflow: 'hidden' }}>
          {/* Pixel corner decorations */}
          <div style={{ position: 'absolute', top: 0, left: 0, width: 6, height: 6, background: '#00aaff' }} />
          <div style={{ position: 'absolute', top: 0, right: 0, width: 6, height: 6, background: '#00ffcc' }} />

          {/* Cover */}
          <div style={{ height: 60, background: 'linear-gradient(90deg, #0a1525 0%, #0f1f3d 50%, #0a1525 100%)', borderBottom: '2px solid #1e3560', display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end', padding: 8 }}>
            <span style={{ fontSize: '0.7rem', background: '#00aaff', color: '#060a14', padding: '2px 8px', fontWeight: 700, boxShadow: '2px 2px 0px #003366', letterSpacing: '0.04em' }}>CSE</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', marginTop: -28, padding: '0 16px 16px' }}>
            <div style={{ marginBottom: 8 }}>
              <UserAvatar src={currentUser.avatar_url} name={displayName(currentUser)} size={56} borderColor="#00aaff" />
            </div>

            <h2 style={{ fontSize: '0.9rem', color: '#e8f4fd', fontWeight: 700, lineHeight: 1.4, marginBottom: 8 }}>{displayName(currentUser)}</h2>

            <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
              {currentUser.usn && <span style={{ fontSize: '0.7rem', color: '#00ffcc', background: 'rgba(0,255,204,0.1)', border: '2px solid rgba(0,255,204,0.4)', padding: '2px 8px', boxShadow: '2px 2px 0px #006655', fontWeight: 700 }}>{currentUser.usn}</span>}
              <span style={{ fontSize: '0.7rem', color: '#ffe066', background: 'rgba(255,224,102,0.1)', border: '2px solid rgba(255,224,102,0.35)', padding: '2px 8px', boxShadow: '2px 2px 0px #665500', fontWeight: 700 }}>{getYearLabel(currentUser.year)}</span>
            </div>

            {currentUser.bio && (
              <p style={{ fontSize: '0.78rem', color: '#a8d4f0', lineHeight: 1.5, marginBottom: 10, maxHeight: 60, overflow: 'hidden' }}>{currentUser.bio}</p>
            )}

            {currentUser.skills && currentUser.skills.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 4, marginBottom: 12 }}>
                {currentUser.skills.slice(0, 4).map(skill => (
                  <span key={skill} style={{ fontSize: '0.7rem', color: '#a8d4f0', background: '#0c1220', border: '1px solid #1e3560', padding: '2px 7px', fontWeight: 500 }}>{skill}</span>
                ))}
                {currentUser.skills.length > 4 && <span style={{ fontSize: '0.7rem', color: '#6bafd4' }}>+{currentUser.skills.length - 4}</span>}
              </div>
            )}

            <Link href={`/people/${currentUser.id}`} className="btn-outline" style={{ width: '100%', marginBottom: 8, fontSize: '0.75rem' }}>VIEW PROFILE</Link>
            <button
              type="button"
              onClick={() => { setSelectedProfileForView(currentUser); setIsProfileModalOpen(true) }}
              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '7px', fontSize: '0.75rem', fontWeight: 700, color: '#44ccff', background: 'transparent', border: '2px solid #1e3560', cursor: 'pointer', boxShadow: '2px 2px 0px #000', textTransform: 'uppercase', transition: 'all 0.05s steps(1)' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = '#00aaff'; (e.currentTarget as HTMLElement).style.background = 'rgba(0,170,255,0.08)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = '#1e3560'; (e.currentTarget as HTMLElement).style.background = 'transparent' }}
            >
              <Edit3 style={{ width: 13, height: 13 }} />
              EDIT PROFILE
            </button>
          </div>
        </div>
      ) : (
        <div style={{ background: '#0d1426', border: '2px solid #1e3560', padding: '22px 16px', textAlign: 'center', boxShadow: '4px 4px 0px #000' }}>
          <div style={{ width: 46, height: 46, background: 'rgba(0,170,255,0.1)', border: '2px solid rgba(0,170,255,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px', boxShadow: '3px 3px 0px #003366' }}>
            <GraduationCap style={{ width: 24, height: 24, color: '#00aaff' }} />
          </div>
          <h3 style={{ fontSize: '0.95rem', fontWeight: 800, color: '#e8f4fd', marginBottom: 8, letterSpacing: '0.02em' }}>JOIN UCC COMMUNITY</h3>
          <p style={{ fontSize: '0.78rem', color: '#6bafd4', marginBottom: 16, lineHeight: 1.5 }}>Sign in with your USN to post discussions, host workshops, and RSVP.</p>
          <button
            type="button"
            onClick={() => setIsAuthModalOpen(true)}
            style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '9px', background: '#00aaff', color: '#060a14', border: '2px solid #0088cc', fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer', boxShadow: '3px 3px 0px #003366', textTransform: 'uppercase', letterSpacing: '0.03em' }}
          >
            <LogIn style={{ width: 14, height: 14 }} />
            SIGN IN / JOIN
          </button>
        </div>
      )}

      {/* Year Filter */}
      <div style={{ background: '#0d1426', border: '2px solid #1e3560', padding: '12px', boxShadow: '4px 4px 0px #000' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, paddingBottom: 8, borderBottom: '2px solid #1e3560' }}>
          <span style={{ fontSize: '0.75rem', color: '#e8f4fd', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6, letterSpacing: '0.03em' }}>
            <Compass style={{ width: 14, height: 14, color: '#00aaff' }} />
            FILTER BY YEAR
          </span>
          <span style={{ fontSize: '0.65rem', color: '#3d6b8a', textTransform: 'uppercase', fontWeight: 700 }}>BATCH</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {[
            { value: 0, label: 'ALL BATCHES (1ST-4TH)' },
            { value: 1, label: '1ST YEAR (4UB26CS...)' },
            { value: 2, label: '2ND YEAR (4UB25CS...)' },
            { value: 3, label: '3RD YEAR (4UB24CS...)' },
            { value: 4, label: '4TH YEAR (4UB23CS...)' },
          ].map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setYearFilter(opt.value as YearFilter)}
              style={{
                width: '100%', textAlign: 'left', padding: '7px 10px', fontSize: '0.75rem', fontWeight: 600,
                cursor: 'pointer', border: '2px solid', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                transition: 'all 0.05s steps(1)', textTransform: 'uppercase',
                background: yearFilter === opt.value ? '#00aaff' : 'transparent',
                color: yearFilter === opt.value ? '#060a14' : '#a8d4f0',
                borderColor: yearFilter === opt.value ? '#0088cc' : '#1e3560',
                boxShadow: yearFilter === opt.value ? '2px 2px 0px #003366' : 'none',
                transform: yearFilter === opt.value ? 'translate(-1px,-1px)' : 'none',
              }}
            >
              <span>{opt.label}</span>
              {yearFilter === opt.value && <Check style={{ width: 13, height: 13 }} />}
            </button>
          ))}
        </div>
      </div>

      {/* Stats */}
      <div style={{ background: '#0d1426', border: '2px solid #1e3560', padding: '12px', boxShadow: '4px 4px 0px #000' }}>
        <span style={{ fontSize: '0.72rem', color: '#3d6b8a', textTransform: 'uppercase', fontWeight: 700, display: 'block', marginBottom: 10, borderBottom: '2px solid #1e3560', paddingBottom: 6, letterSpacing: '0.04em' }}>
          UCC STATS
        </span>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #1e3560' }}>
          <span style={{ fontSize: '0.75rem', color: '#6bafd4' }}>Department</span>
          <span style={{ fontSize: '0.75rem', color: '#00ffcc', fontWeight: 700 }}>CSE</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #1e3560' }}>
          <span style={{ fontSize: '0.75rem', color: '#6bafd4' }}>Batches</span>
          <span style={{ fontSize: '0.75rem', color: '#00aaff', fontWeight: 700 }}>1st – 4th Year</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}>
          <span style={{ fontSize: '0.75rem', color: '#6bafd4' }}>Affiliation</span>
          <span style={{ fontSize: '0.75rem', color: '#e8f4fd', fontWeight: 700 }}>VTU</span>
        </div>
      </div>
    </aside>
  )
}
