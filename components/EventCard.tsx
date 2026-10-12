'use client'

import React, { useState, useEffect } from 'react'
import Image from 'next/image'
import {
  Calendar,
  Clock,
  Video,
  Users,
  CheckCircle2,
  Sparkles,
  Layers,
  ExternalLink,
} from 'lucide-react'
import { Event } from '@/lib/types'
import { useCommunity } from '@/contexts/CommunityContext'
import {
  formatEventDateTime,
  getCountdown,
  getEventTypeColor,
  getAvatarFallback,
  getYearLabel,
} from '@/lib/utils'

interface EventCardProps {
  event: Event
  compact?: boolean
}

export default function EventCard({ event, compact = false }: EventCardProps) {
  const { rsvpedEventIds, toggleRsvpEvent, setSelectedProfileForView, setIsProfileModalOpen } = useCommunity()

  const isRsvped = rsvpedEventIds.has(event.id)
  const [countdown, setCountdown] = useState<string>('')

  useEffect(() => {
    setCountdown(getCountdown(event.event_date, event.event_time))
    const timer = setInterval(() => {
      setCountdown(getCountdown(event.event_date, event.event_time))
    }, 30000)
    return () => clearInterval(timer)
  }, [event.event_date, event.event_time])

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

  return (
    <article className="card p-5 transition-all hover:border-slate-300 relative group overflow-hidden bg-white">
      {/* Top row: Badge type & Countdown */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={`text-xs font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wider ${
              event.type === 'Workshop'
                ? 'bg-indigo-50 text-indigo-700 border border-indigo-200/60'
                : event.type === 'Meeting'
                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/60'
                : 'bg-amber-50 text-amber-800 border border-amber-200/60'
            }`}
          >
            {event.type}
          </span>

          {/* Target Years */}
          <div className="flex items-center gap-1">
            {event.target_years.length === 4 ? (
              <span className="text-[11px] font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md">
                All Years
              </span>
            ) : (
              event.target_years.map(y => (
                <span
                  key={y}
                  className="text-[10px] font-semibold text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded"
                >
                  {y}st/nd/rd/th
                </span>
              ))
            )}
          </div>
        </div>

        {countdown && (
          <span
            className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full flex items-center gap-1 ${
              countdown === 'Event ended'
                ? 'bg-slate-100 text-slate-500'
                : 'bg-[#0d1f3c] text-amber-300 shadow-xs'
            }`}
          >
            <Clock className="w-3 h-3" />
            {countdown}
          </span>
        )}
      </div>

      {/* Title */}
      <h3 className="text-base sm:text-lg font-bold text-slate-900 group-hover:text-[#1e3a5f] transition-colors leading-snug mb-2">
        {event.title}
      </h3>

      {/* Description */}
      {!compact && (
        <p className="text-xs sm:text-sm text-slate-600 leading-relaxed mb-4 line-clamp-3">
          {event.description}
        </p>
      )}

      {/* Event Details Meta: Date, Time, Duration */}
      <div className="flex flex-wrap items-center gap-y-2 gap-x-4 text-xs text-slate-600 bg-slate-50/80 p-2.5 rounded-lg border border-slate-100 mb-4">
        <div className="flex items-center gap-1.5 font-medium text-slate-800">
          <Calendar className="w-3.5 h-3.5 text-[#1e3a5f]" />
          <span>{formatEventDateTime(event.event_date, event.event_time)}</span>
        </div>
        <div className="flex items-center gap-1.5 text-slate-500">
          <Clock className="w-3.5 h-3.5" />
          <span>{event.duration} minutes</span>
        </div>
        <div className="flex items-center gap-1.5 text-slate-500 ml-auto">
          <Users className="w-3.5 h-3.5 text-indigo-600" />
          <span className="font-semibold text-slate-800">{event.rsvp_count ?? 0}</span> attending
        </div>
      </div>

      {/* Bottom Bar: Host info + Action Buttons */}
      <div className="flex items-center justify-between gap-3 pt-2 border-t border-slate-100">
        {/* Host Info */}
        <button
          type="button"
          onClick={handleHostClick}
          className="flex items-center gap-2 text-left group/host hover:opacity-85 transition-opacity"
        >
          <div className="w-7 h-7 rounded-full overflow-hidden bg-slate-200 text-slate-700 flex items-center justify-center font-bold text-[10px]">
            {event.host_avatar ? (
              <Image
                src={event.host_avatar}
                alt={event.host_name || 'Host'}
                width={28}
                height={28}
                className="w-full h-full object-cover"
              />
            ) : (
              getAvatarFallback(event.host_name || 'Host')
            )}
          </div>
          <div className="flex flex-col">
            <span className="text-xs font-semibold text-slate-800 group-hover/host:text-[#1e3a5f]">
              {event.host_name}
            </span>
            <span className="text-[10px] font-mono text-slate-400">
              Host ({event.host_usn})
            </span>
          </div>
        </button>

        {/* Buttons: Join Virtual Link & RSVP */}
        <div className="flex items-center gap-2">
          {event.link && (
            <a
              href={event.link}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors"
            >
              <Video className="w-3.5 h-3.5 text-indigo-600" />
              <span>Join Meet</span>
              <ExternalLink className="w-2.5 h-2.5 opacity-60" />
            </a>
          )}

          <button
            type="button"
            onClick={() => toggleRsvpEvent(event.id)}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold rounded-lg transition-all active:scale-95 ${
              isRsvped
                ? 'bg-emerald-600 text-white shadow-xs hover:bg-emerald-700'
                : 'bg-[#1e3a5f] text-white shadow-xs hover:bg-[#152e4d]'
            }`}
          >
            {isRsvped ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-200" />
                <span>Going ✓</span>
              </>
            ) : (
              <>
                <span>RSVP</span>
              </>
            )}
          </button>
        </div>
      </div>
    </article>
  )
}
