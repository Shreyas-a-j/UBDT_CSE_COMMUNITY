'use client'

import React, { useState, useEffect } from 'react'
import Image from 'next/image'
import { Calendar, Clock, Video, Users, CheckCircle2, ExternalLink, Edit2, Save, X } from 'lucide-react'
import { Event } from '@/lib/types'
import { useCommunity } from '@/contexts/CommunityContext'
import { formatEventDateTime, getCountdown, getAvatarFallback } from '@/lib/utils'
import UserAvatar from '@/components/UserAvatar'

interface EventCardProps { event: Event; compact?: boolean }

export default function EventCard({ event, compact = false }: EventCardProps) {
  const { rsvpedEventIds, toggleRsvpEvent, setSelectedProfileForView, setIsProfileModalOpen, currentUser, updateEvent } = useCommunity()
  const isRsvped = rsvpedEventIds.has(event.id)
  const isHost = currentUser?.id === event.host_id
  const [countdown, setCountdown] = useState('')
  const [isEditing, setIsEditing] = useState(false)
  const [eTitle, setETitle] = useState(event.title)
  const [eDesc, setEDesc] = useState(event.description)
  const [eType, setEType] = useState(event.type)
  const [eDate, setEDate] = useState(event.event_date)
  const [eTime, setETime] = useState(event.event_time)
  const [eDuration, setEDuration] = useState(event.duration)
  const [eLink, setELink] = useState(event.link || '')
  const [eTargetYears, setETargetYears] = useState<number[]>(event.target_years)

  useEffect(() => {
    setCountdown(getCountdown(event.event_date, event.event_time))
    const timer = setInterval(() => setCountdown(getCountdown(event.event_date, event.event_time)), 30000)
    return () => clearInterval(timer)
  }, [event.event_date, event.event_time])

  const handleSave = () => {
    updateEvent(event.id, { title: eTitle.trim(), description: eDesc.trim(), type: eType, event_date: eDate, event_time: eTime, duration: Number(eDuration), link: eLink.trim() || null, target_years: eTargetYears })
    setIsEditing(false)
  }
  const toggleYear = (yr: number) => {
    if (eTargetYears.includes(yr)) { if (eTargetYears.length > 1) setETargetYears(eTargetYears.filter(y => y !== yr)) }
    else { setETargetYears([...eTargetYears, yr].sort()) }
  }
  const handleHostClick = () => {
    setSelectedProfileForView({ id: event.host_id, usn: event.host_usn || '', name: event.host_name || 'Host', year: 1, branch: 'CSE', bio: null, avatar_url: event.host_avatar || null, skills: [], created_at: event.created_at })
    setIsProfileModalOpen(true)
  }

  const typeBadge = { Workshop: { bg: 'rgba(170,102,255,0.15)', color: '#cc99ff', border: 'rgba(170,102,255,0.4)', shadow: '#440066' }, Meeting: { bg: 'rgba(0,255,204,0.12)', color: '#00ffcc', border: 'rgba(0,255,204,0.4)', shadow: '#006655' }, Showcase: { bg: 'rgba(255,224,102,0.12)', color: '#ffe066', border: 'rgba(255,224,102,0.4)', shadow: '#665500' } }[event.type] || { bg: 'rgba(0,170,255,0.15)', color: '#00aaff', border: 'rgba(0,170,255,0.4)', shadow: '#003366' }

  // Edit Mode
  if (isEditing) {
    return (
      <article style={{ background: '#0d1426', border: '2px solid #00ffcc', padding: '20px', boxShadow: '4px 4px 0px #006655, 0 0 16px rgba(0,255,204,0.1)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 12, marginBottom: 12, borderBottom: '2px solid #1e3560' }}>
          <span style={{ fontSize: '0.75rem', color: '#e8f4fd', fontWeight: 700, textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Edit2 style={{ width: 13, height: 13, color: '#00ffcc' }} /> EDITING EVENT
          </span>
          <button type="button" onClick={() => setIsEditing(false)} style={{ background: 'transparent', border: '2px solid #1e3560', padding: 4, cursor: 'pointer', color: '#6bafd4' }}>
            <X style={{ width: 14, height: 14 }} />
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div><label className="label">TITLE</label><input type="text" value={eTitle} onChange={e => setETitle(e.target.value)} className="input" /></div>
          <div><label className="label">DESCRIPTION</label><textarea rows={3} value={eDesc} onChange={e => setEDesc(e.target.value)} className="textarea" /></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label className="label">TYPE</label>
              <select value={eType} onChange={e => setEType(e.target.value as any)} className="select">
                <option value="Workshop">Workshop</option>
                <option value="Meeting">Meeting</option>
                <option value="Showcase">Showcase</option>
              </select>
            </div>
            <div><label className="label">DURATION (MIN)</label><input type="number" min="15" max="240" step="15" value={eDuration} onChange={e => setEDuration(Number(e.target.value))} className="input" /></div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div><label className="label">DATE</label><input type="date" value={eDate} onChange={e => setEDate(e.target.value)} className="input" /></div>
            <div><label className="label">TIME (IST)</label><input type="time" value={eTime} onChange={e => setETime(e.target.value)} className="input" /></div>
          </div>
          <div>
            <label className="label" style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Video style={{ width: 12, height: 12 }} /> VIRTUAL LINK</label>
            <input type="url" value={eLink} onChange={e => setELink(e.target.value)} placeholder="https://meet.google.com/..." className="input" />
          </div>
          <div>
            <label className="label">TARGET YEARS</label>
            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              {[1, 2, 3, 4].map(yr => (
                <button key={yr} type="button" onClick={() => toggleYear(yr)}
                  style={{ fontSize: '0.72rem', fontWeight: 700, padding: '5px 12px', border: '2px solid', cursor: 'pointer', textTransform: 'uppercase',
                    background: eTargetYears.includes(yr) ? '#00ffcc' : 'transparent',
                    color: eTargetYears.includes(yr) ? '#060a14' : '#a8d4f0',
                    borderColor: eTargetYears.includes(yr) ? '#00ccaa' : '#1e3560',
                    boxShadow: eTargetYears.includes(yr) ? '2px 2px 0px #006655' : '2px 2px 0px #000' }}>
                  {yr}YR
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 12, borderTop: '2px solid #1e3560' }}>
            <button type="button" onClick={() => setIsEditing(false)} style={{ fontSize: '0.72rem', fontWeight: 700, color: '#a8d4f0', background: 'transparent', border: '2px solid #1e3560', padding: '6px 12px', cursor: 'pointer', boxShadow: '2px 2px 0px #000', textTransform: 'uppercase' }}>CANCEL</button>
            <button type="button" onClick={handleSave} disabled={!eTitle.trim() || !eDesc.trim() || !eDate}
              style={{ fontSize: '0.72rem', fontWeight: 700, color: '#060a14', background: '#00ffcc', border: '2px solid #00ccaa', padding: '6px 14px', cursor: 'pointer', boxShadow: '3px 3px 0px #006655', display: 'flex', alignItems: 'center', gap: 6, textTransform: 'uppercase' }}>
              <Save style={{ width: 13, height: 13 }} /> SAVE
            </button>
          </div>
        </div>
      </article>
    )
  }

  // Display Mode
  return (
    <article style={{ background: '#0d1426', border: '2px solid #1e3560', padding: '20px', boxShadow: '4px 4px 0px #000', position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: 'linear-gradient(90deg, #00ffcc, #00aaff)' }} />

      {/* Top Row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.68rem', fontWeight: 700, padding: '2px 8px', background: typeBadge.bg, color: typeBadge.color, border: `2px solid ${typeBadge.border}`, boxShadow: `2px 2px 0px ${typeBadge.shadow}`, textTransform: 'uppercase' }}>{event.type}</span>
          {event.target_years.length === 4 ? (
            <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#44ccff', background: 'rgba(0,170,255,0.1)', border: '1px solid rgba(0,170,255,0.3)', padding: '2px 7px' }}>ALL YEARS</span>
          ) : (
            event.target_years.map(y => <span key={y} style={{ fontSize: '0.68rem', fontWeight: 700, color: '#44ccff', background: 'rgba(0,170,255,0.1)', border: '1px solid rgba(0,170,255,0.3)', padding: '2px 6px' }}>{y}YR</span>)
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {countdown && (
            <span style={{ fontSize: '0.7rem', fontWeight: 700, padding: '2px 8px', display: 'flex', alignItems: 'center', gap: 4, background: countdown === 'Event ended' ? 'transparent' : 'rgba(255,224,102,0.1)', color: countdown === 'Event ended' ? '#3d6b8a' : '#ffe066', border: `2px solid ${countdown === 'Event ended' ? '#1e3560' : 'rgba(255,224,102,0.4)'}`, boxShadow: countdown === 'Event ended' ? 'none' : '2px 2px 0px #665500' }}>
              <Clock style={{ width: 11, height: 11 }} />{countdown}
            </span>
          )}
          {isHost && (
            <button type="button" onClick={() => setIsEditing(true)} style={{ background: 'transparent', border: '2px solid transparent', padding: 4, cursor: 'pointer', color: '#6bafd4' }} title="Edit event">
              <Edit2 style={{ width: 13, height: 13 }} />
            </button>
          )}
        </div>
      </div>

      {/* Title */}
      <h3 style={{ fontSize: '1rem', color: '#e8f4fd', fontWeight: 700, lineHeight: 1.4, marginBottom: 8 }}>{event.title}</h3>

      {/* Description */}
      {!compact && (
        <p style={{ fontSize: '0.875rem', color: '#cbd5e1', lineHeight: 1.6, marginBottom: 14, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}>{event.description}</p>
      )}

      {/* Meta Box */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, background: '#090e1c', border: '2px solid #1e3560', padding: '10px 14px', marginBottom: 14, boxShadow: 'inset 2px 2px 0px rgba(0,0,0,0.4)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Calendar style={{ width: 14, height: 14, color: '#00aaff' }} />
          <span style={{ fontSize: '0.75rem', color: '#e8f4fd', fontWeight: 600 }}>{formatEventDateTime(event.event_date, event.event_time)}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Clock style={{ width: 13, height: 13, color: '#6bafd4' }} />
          <span style={{ fontSize: '0.75rem', color: '#a8d4f0', fontWeight: 500 }}>{event.duration} MIN</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
          <Users style={{ width: 13, height: 13, color: '#00ffcc' }} />
          <span style={{ fontSize: '0.75rem', color: '#e8f4fd', fontWeight: 700 }}>{event.rsvp_count ?? 0}</span>
          <span style={{ fontSize: '0.72rem', color: '#a8d4f0', fontWeight: 600 }}>ATTENDING</span>
        </div>
      </div>

      {/* Footer */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 14, borderTop: '2px solid #1e3560' }}>
        <button type="button" onClick={handleHostClick} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
          <UserAvatar src={event.host_avatar} name={event.host_name || 'Host'} size={32} borderColor="#1e3560" />
          <div style={{ textAlign: 'left' }}>
            <span style={{ fontSize: '0.8rem', color: '#e8f4fd', fontWeight: 700, display: 'block' }}>{event.host_name}</span>
            <span style={{ fontSize: '0.7rem', color: '#00aaff', fontWeight: 500 }}>HOST ({event.host_usn})</span>
          </div>
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {event.link && (
            <a href={event.link} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: '0.72rem', fontWeight: 700, color: '#a8d4f0', background: 'transparent', border: '2px solid #1e3560', padding: '6px 12px', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6, boxShadow: '2px 2px 0px #000', textTransform: 'uppercase' }}>
              <Video style={{ width: 13, height: 13, color: '#00aaff' }} /> JOIN MEET
              <ExternalLink style={{ width: 11, height: 11, opacity: 0.6 }} />
            </a>
          )}
          <button type="button" onClick={() => toggleRsvpEvent(event.id)}
            style={{ fontSize: '0.75rem', fontWeight: 700, padding: '7px 16px', border: '2px solid', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, textTransform: 'uppercase', transition: 'all 0.05s steps(1)',
              background: isRsvped ? '#00ffcc' : '#00aaff',
              color: '#060a14',
              borderColor: isRsvped ? '#00ccaa' : '#0088cc',
              boxShadow: isRsvped ? '3px 3px 0px #006655' : '3px 3px 0px #003366',
              letterSpacing: '0.02em' }}>
            {isRsvped ? (<><CheckCircle2 style={{ width: 14, height: 14 }} /> GOING ✓</>) : 'RSVP'}
          </button>
        </div>
      </div>
    </article>
  )
}
