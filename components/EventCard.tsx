'use client'

import React, { useState, useEffect } from 'react'
import Image from 'next/image'
import {
  Calendar, Clock, Video, Users, CheckCircle2, ExternalLink, Edit2, Save, X,
} from 'lucide-react'
import { Event } from '@/lib/types'
import { useCommunity } from '@/contexts/CommunityContext'
import { formatEventDateTime, getCountdown, getAvatarFallback } from '@/lib/utils'

interface EventCardProps {
  event: Event
  compact?: boolean
}

export default function EventCard({ event, compact = false }: EventCardProps) {
  const {
    rsvpedEventIds, toggleRsvpEvent,
    setSelectedProfileForView, setIsProfileModalOpen,
    currentUser, updateEvent,
  } = useCommunity()

  const isRsvped = rsvpedEventIds.has(event.id)
  const isHost = currentUser?.id === event.host_id
  const [countdown, setCountdown] = useState('')
  const [isEditing, setIsEditing] = useState(false)

  // Edit state mirrors event fields
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
    updateEvent(event.id, {
      title: eTitle.trim(),
      description: eDesc.trim(),
      type: eType,
      event_date: eDate,
      event_time: eTime,
      duration: Number(eDuration),
      link: eLink.trim() || null,
      target_years: eTargetYears,
    })
    setIsEditing(false)
  }

  const toggleYear = (yr: number) => {
    if (eTargetYears.includes(yr)) {
      if (eTargetYears.length > 1) setETargetYears(eTargetYears.filter(y => y !== yr))
    } else {
      setETargetYears([...eTargetYears, yr].sort())
    }
  }

  const handleHostClick = () => {
    setSelectedProfileForView({
      id: event.host_id,
      usn: event.host_usn || '',
      name: event.host_name || 'Host',
      year: 1,
      branch: 'CSE',
      bio: null,
      avatar_url: event.host_avatar || null,
      skills: [],
      created_at: event.created_at,
    })
    setIsProfileModalOpen(true)
  }

  const typeBadge = {
    Workshop: 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400 border-indigo-200/60',
    Meeting: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border-emerald-200/60',
    Showcase: 'bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-400 border-amber-200/60',
  }[event.type]

  // ── Edit mode ──────────────────────────────────────────────────────────────
  if (isEditing) {
    return (
      <article className="card p-5 bg-white dark:bg-slate-900 border-2 border-[#1e3a5f]/30 dark:border-amber-500/30">
        <div className="flex items-center justify-between mb-4">
          <span className="text-xs font-bold text-[#1e3a5f] dark:text-amber-400 flex items-center gap-1.5">
            <Edit2 className="w-3.5 h-3.5" /> Editing Event
          </span>
          <button
            type="button"
            onClick={() => setIsEditing(false)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3 text-xs">
          <div>
            <label className="label">Title</label>
            <input type="text" value={eTitle} onChange={e => setETitle(e.target.value)} className="input text-xs" />
          </div>
          <div>
            <label className="label">Description</label>
            <textarea rows={3} value={eDesc} onChange={e => setEDesc(e.target.value)} className="textarea text-xs" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Type</label>
              <select value={eType} onChange={e => setEType(e.target.value as any)} className="select text-xs">
                <option value="Workshop">Workshop</option>
                <option value="Meeting">Meeting</option>
                <option value="Showcase">Showcase</option>
              </select>
            </div>
            <div>
              <label className="label">Duration (min)</label>
              <input type="number" min="15" max="240" step="15" value={eDuration} onChange={e => setEDuration(Number(e.target.value))} className="input text-xs" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Date</label>
              <input type="date" value={eDate} onChange={e => setEDate(e.target.value)} className="input text-xs" />
            </div>
            <div>
              <label className="label">Time (IST)</label>
              <input type="time" value={eTime} onChange={e => setETime(e.target.value)} className="input text-xs" />
            </div>
          </div>
          <div>
            <label className="label flex items-center gap-1"><Video className="w-3 h-3 text-indigo-600" /> Virtual Link</label>
            <input type="url" value={eLink} onChange={e => setELink(e.target.value)} placeholder="https://meet.google.com/…" className="input text-xs" />
          </div>
          <div>
            <label className="label">Target Years</label>
            <div className="flex gap-2 mt-1">
              {[1, 2, 3, 4].map(yr => (
                <button
                  key={yr}
                  type="button"
                  onClick={() => toggleYear(yr)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                    eTargetYears.includes(yr)
                      ? 'bg-[#1e3a5f] text-white border-[#1e3a5f]'
                      : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-600'
                  }`}
                >
                  {yr}yr
                </button>
              ))}
            </div>
          </div>

          <div className="pt-2 flex justify-end gap-2 border-t border-slate-100 dark:border-slate-700">
            <button type="button" onClick={() => setIsEditing(false)} className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 font-medium text-xs hover:bg-slate-50 dark:hover:bg-slate-700">
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!eTitle.trim() || !eDesc.trim() || !eDate}
              className="px-4 py-1.5 rounded-lg bg-[#1e3a5f] hover:bg-[#152e4d] text-white font-bold text-xs flex items-center gap-1.5 disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" /> Save Changes
            </button>
          </div>
        </div>
      </article>
    )
  }

  // ── Display mode ─────────────────────────────────────────────────────────
  return (
    <article className="card p-5 transition-all hover:border-slate-300 dark:hover:border-slate-600 relative group overflow-hidden bg-white dark:bg-slate-900">
      {/* Top Row */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wider border ${typeBadge}`}>
            {event.type}
          </span>
          <div className="flex items-center gap-1">
            {event.target_years.length === 4 ? (
              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-md">All Years</span>
            ) : (
              event.target_years.map(y => (
                <span key={y} className="text-[10px] font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
                  {y}yr
                </span>
              ))
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {countdown && (
            <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full flex items-center gap-1 ${
              countdown === 'Event ended'
                ? 'bg-slate-100 dark:bg-slate-800 text-slate-500'
                : 'bg-[#0d1f3c] dark:bg-amber-900/40 text-amber-300 shadow-xs'
            }`}>
              <Clock className="w-3 h-3" />{countdown}
            </span>
          )}
          {/* Host Edit button */}
          {isHost && (
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              className="p-1.5 rounded-lg text-slate-400 hover:text-[#1e3a5f] dark:hover:text-amber-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              title="Edit event"
            >
              <Edit2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Title */}
      <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100 group-hover:text-[#1e3a5f] dark:group-hover:text-amber-400 transition-colors leading-snug mb-2">
        {event.title}
      </h3>

      {/* Description */}
      {!compact && (
        <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed mb-4 line-clamp-3">
          {event.description}
        </p>
      )}

      {/* Meta */}
      <div className="flex flex-wrap items-center gap-y-2 gap-x-4 text-xs text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/60 p-2.5 rounded-lg border border-slate-100 dark:border-slate-700 mb-4">
        <div className="flex items-center gap-1.5 font-medium text-slate-800 dark:text-slate-200">
          <Calendar className="w-3.5 h-3.5 text-[#1e3a5f] dark:text-amber-400" />
          <span>{formatEventDateTime(event.event_date, event.event_time)}</span>
        </div>
        <div className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
          <Clock className="w-3.5 h-3.5" /><span>{event.duration} minutes</span>
        </div>
        <div className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400 ml-auto">
          <Users className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
          <span className="font-semibold text-slate-800 dark:text-slate-200">{event.rsvp_count ?? 0}</span> attending
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-3 pt-2 border-t border-slate-100 dark:border-slate-700">
        <button type="button" onClick={handleHostClick} className="flex items-center gap-2 group/host hover:opacity-80 transition-opacity">
          <div className="w-7 h-7 rounded-full overflow-hidden bg-slate-200 dark:bg-slate-700 flex items-center justify-center font-bold text-[10px] text-slate-700 dark:text-slate-200">
            {event.host_avatar ? (
              <Image src={event.host_avatar} alt={event.host_name || 'Host'} width={28} height={28} className="w-full h-full object-cover" />
            ) : (
              getAvatarFallback(event.host_name || 'Host')
            )}
          </div>
          <div className="flex flex-col">
            <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 group-hover/host:text-[#1e3a5f] dark:group-hover/host:text-amber-400">
              {event.host_name}
            </span>
            <span className="text-[10px] font-mono text-slate-400">Host ({event.host_usn})</span>
          </div>
        </button>

        <div className="flex items-center gap-2">
          {event.link && (
            <a
              href={event.link}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors"
            >
              <Video className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
              <span>Join Meet</span>
              <ExternalLink className="w-2.5 h-2.5 opacity-60" />
            </a>
          )}
          <button
            type="button"
            onClick={() => toggleRsvpEvent(event.id)}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold rounded-lg transition-all active:scale-95 ${
              isRsvped
                ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                : 'bg-[#1e3a5f] dark:bg-amber-600 text-white hover:bg-[#152e4d] dark:hover:bg-amber-700'
            }`}
          >
            {isRsvped ? <><CheckCircle2 className="w-3.5 h-3.5 text-emerald-200" /><span>Going ✓</span></> : <span>RSVP</span>}
          </button>
        </div>
      </div>
    </article>
  )
}
