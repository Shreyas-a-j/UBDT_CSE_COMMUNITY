'use client'

import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { format, parseISO } from 'date-fns'
import {
  Calendar, Check, Clock, Edit2, ExternalLink, Save, Users, Video, X,
} from 'lucide-react'
import { Event } from '@/lib/types'
import { useCommunity } from '@/contexts/CommunityContext'
import { formatEventDateTime, getCountdown } from '@/lib/utils'
import UserAvatar from '@/components/UserAvatar'

interface EventCardProps {
  event: Event
  compact?: boolean
}

const TYPE_TONE: Record<string, string> = {
  Workshop: 'chip-info',
  Meeting: 'chip-accent',
  Showcase: 'chip-warn',
  Seminar: 'chip-info',
  'Project Session': 'chip-info',
}

function DateBlock({ date }: { date: string }) {
  let day: string
  let weekday: string
  let month: string

  try {
    const parsed = parseISO(date)
    day = format(parsed, 'd')
    weekday = format(parsed, 'EEE')
    month = format(parsed, 'MMM')
  } catch {
    return null
  }

  return (
    <div className="hidden w-[60px] shrink-0 flex-col items-center justify-center gap-1 rounded-md border border-line bg-elevated py-2.5 sm:flex">
      <span className="text-[9.5px] font-medium uppercase tracking-wide text-dim">
        {weekday}
      </span>
      <span className="text-[22px] font-semibold leading-none text-ink">
        {day}
      </span>
      <span className="text-[9.5px] font-medium uppercase tracking-wide text-dim">
        {month}
      </span>
    </div>
  )
}

export default function EventCard({ event, compact = false }: EventCardProps) {
  const router = useRouter()
  const { rsvpedEventIds, toggleRsvpEvent, currentUser, updateEvent } = useCommunity()
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
    queueMicrotask(() => setCountdown(getCountdown(event.event_date, event.event_time)))
    const timer = setInterval(
      () => setCountdown(getCountdown(event.event_date, event.event_time)),
      30000
    )
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

  const toggleYear = (year: number) => {
    if (eTargetYears.includes(year)) {
      if (eTargetYears.length > 1) setETargetYears(eTargetYears.filter(y => y !== year))
    } else {
      setETargetYears([...eTargetYears, year].sort())
    }
  }

  if (isEditing) {
    return (
      <article className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-4 py-3 sm:px-5">
          <h3 className="flex items-center gap-2 font-display text-[13.5px] font-semibold text-ink">
            <Edit2 className="h-4 w-4 text-info" /> Editing event
          </h3>
          <button
            type="button"
            className="btn-icon h-8 w-8"
            onClick={() => setIsEditing(false)}
            aria-label="Close editor"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-col gap-4 p-4 sm:p-5">
          <div>
            <label className="label" htmlFor={`evt-title-${event.id}`}>Title</label>
            <input
              id={`evt-title-${event.id}`}
              type="text"
              value={eTitle}
              onChange={e => setETitle(e.target.value)}
              className="field"
            />
          </div>
          <div>
            <label className="label" htmlFor={`evt-desc-${event.id}`}>Description</label>
            <textarea
              id={`evt-desc-${event.id}`}
              rows={3}
              value={eDesc}
              onChange={e => setEDesc(e.target.value)}
              className="field-area"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor={`evt-type-${event.id}`}>Type</label>
              <select
                id={`evt-type-${event.id}`}
                value={eType}
                onChange={e => setEType(e.target.value as Event['type'])}
                className="field-select"
              >
                <option value="Workshop">Workshop</option>
                <option value="Meeting">Meeting</option>
                <option value="Showcase">Showcase</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor={`evt-duration-${event.id}`}>Duration, minutes</label>
              <input
                id={`evt-duration-${event.id}`}
                type="number"
                min="15"
                max="240"
                step="15"
                value={eDuration}
                onChange={e => setEDuration(Number(e.target.value))}
                className="field"
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor={`evt-date-${event.id}`}>Date</label>
              <input
                id={`evt-date-${event.id}`}
                type="date"
                value={eDate}
                onChange={e => setEDate(e.target.value)}
                className="field"
              />
            </div>
            <div>
              <label className="label" htmlFor={`evt-time-${event.id}`}>Time, IST</label>
              <input
                id={`evt-time-${event.id}`}
                type="time"
                value={eTime}
                onChange={e => setETime(e.target.value)}
                className="field"
              />
            </div>
          </div>
          <div>
            <label className="label flex items-center gap-1.5" htmlFor={`evt-link-${event.id}`}>
              <Video className="h-3 w-3" /> Virtual link
            </label>
            <input
              id={`evt-link-${event.id}`}
              type="url"
              value={eLink}
              onChange={e => setELink(e.target.value)}
              placeholder="https://meet.google.com/…"
              className="field"
            />
          </div>
          <div>
            <span className="label">Target batches</span>
            <div className="flex flex-wrap gap-1.5">
              {[1, 2, 3, 4].map(year => {
                const active = eTargetYears.includes(year)
                return (
                  <button
                    key={year}
                    type="button"
                    onClick={() => toggleYear(year)}
                    aria-pressed={active}
                    className={`btn h-8 ${active ? 'btn-accent' : 'btn-outline'}`}
                  >
                    {year === 1 ? '1st' : year === 2 ? '2nd' : year === 3 ? '3rd' : '4th'} year
                  </button>
                )
              })}
            </div>
          </div>
          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setIsEditing(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-accent btn-sm"
              onClick={handleSave}
              disabled={!eTitle.trim() || !eDesc.trim() || !eDate}
            >
              <Save className="h-3.5 w-3.5" /> Save changes
            </button>
          </div>
        </div>
      </article>
    )
  }

  return (
    <article className="card card-hover flex gap-4 p-5 sm:gap-5 sm:p-6">
      <DateBlock date={event.event_date} />

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`type-badge border border-line ${TYPE_TONE[event.type] ?? 'chip-info'}`}>
              {event.type}
            </span>
            {event.target_years.length === 4 ? (
              <span className="type-badge border border-line bg-elevated text-muted">All years</span>
            ) : (
              event.target_years.map(year => (
                <span key={year} className="type-badge border border-line bg-elevated font-mono text-dim">{year}yr</span>
              ))
            )}
            {countdown && (
              <span
                className={`type-badge border border-line font-mono ${
                  countdown === 'Event ended' ? 'bg-elevated text-dim' : 'bg-warning/10 text-warning'
                }`}
              >
                <Clock className="h-2.5 w-2.5" />
                {countdown === 'Event ended' ? 'Ended' : `in ${countdown}`}
              </span>
            )}
          </div>
          {isHost && (
            <button
              type="button"
              className="btn-icon h-7 w-7 shrink-0 border-transparent"
              onClick={() => setIsEditing(true)}
              aria-label="Edit event"
            >
              <Edit2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <h3 className="mt-2.5 text-[17px] font-semibold leading-snug text-ink">
          {event.title}
        </h3>

        {!compact && (
          <p className="clamp-3 mt-2 max-w-[68ch] text-[14px] leading-relaxed text-muted">
            {event.description}
          </p>
        )}

        <div className="mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11.5px] text-muted">
          <span className="inline-flex items-center gap-1.5">
            <Calendar className="h-3.5 w-3.5 text-dim" />
            {formatEventDateTime(event.event_date, event.event_time)}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 text-dim" />
            {event.duration} min
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5 text-dim" />
            <span className="font-medium text-ink">{event.rsvp_count ?? 0}</span> attending
          </span>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3.5">
          <button
            type="button"
            onClick={() => router.push(`/people/${event.host_id}`)}
            className="group flex min-w-0 items-center gap-2 text-left"
          >
            <UserAvatar src={event.host_avatar} name={event.host_name || 'Host'} size={28} />
            <span className="min-w-0">
              <span className="block truncate text-[12.5px] font-medium text-ink group-hover:underline">
                {event.host_name}
              </span>
              <span className="block text-[10.5px] text-dim">
                Host{event.host_usn ? ` · ${event.host_usn}` : ''}
              </span>
            </span>
          </button>

          <div className="flex items-center gap-2">
            {event.link && (
              <a
                href={event.link}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-soft btn-sm"
              >
                <Video className="h-3.5 w-3.5" />
                Join
                <ExternalLink className="h-3 w-3 opacity-60" />
              </a>
            )}
            <button
              type="button"
              onClick={() => toggleRsvpEvent(event.id)}
              aria-pressed={isRsvped}
              className={`btn btn-sm ${isRsvped ? 'btn-accent' : 'btn-outline'}`}
            >
              {isRsvped ? (
                <>
                  <Check className="h-3.5 w-3.5" /> Going
                </>
              ) : (
                'RSVP'
              )}
            </button>
          </div>
        </div>
      </div>
    </article>
  )
}
