'use client'

import React, { useState } from 'react'
import { X, Calendar, Video, Clock, Users } from 'lucide-react'
import { useCommunity } from '@/contexts/CommunityContext'

export default function CreateEventModal() {
  const { isCreateEventOpen, setIsCreateEventOpen, createEvent } = useCommunity()

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [type, setType] = useState<'Workshop' | 'Meeting' | 'Showcase'>('Workshop')
  const [eventDate, setEventDate] = useState('')
  const [eventTime, setEventTime] = useState('17:00')
  const [duration, setDuration] = useState(60)
  const [link, setLink] = useState('')
  const [targetYears, setTargetYears] = useState<number[]>([1, 2, 3, 4])

  if (!isCreateEventOpen) return null

  const handleYearToggle = (yr: number) => {
    if (targetYears.includes(yr)) {
      if (targetYears.length > 1) {
        setTargetYears(targetYears.filter(y => y !== yr))
      }
    } else {
      setTargetYears([...targetYears, yr].sort())
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() || !description.trim() || !eventDate) return

    createEvent({
      title: title.trim(),
      description: description.trim(),
      type,
      event_date: eventDate,
      event_time: eventTime,
      duration: Number(duration),
      link: link.trim() || null,
      target_years: targetYears,
      host_id: '',
    })

    // Reset & close
    setTitle('')
    setDescription('')
    setLink('')
    setIsCreateEventOpen(false)
  }

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-[#1e3a5f]" />
            <h2 className="text-base font-bold text-slate-900">Host New CSE Event / Workshop</h2>
          </div>
          <button
            type="button"
            onClick={() => setIsCreateEventOpen(false)}
            className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-4 space-y-3.5 text-xs">
          <div>
            <label className="label">Event Title</label>
            <input
              type="text"
              required
              placeholder="e.g. Hands-on Docker & Kubernetes Workshop for Beginners"
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="input text-xs"
            />
          </div>

          <div>
            <label className="label">Description & Agenda</label>
            <textarea
              required
              rows={3}
              placeholder="Outline what students will learn, prerequisites, and session expectations..."
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="textarea text-xs"
            />
          </div>

          {/* Type & Duration */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Event Type</label>
              <select
                value={type}
                onChange={e => setType(e.target.value as any)}
                className="select text-xs"
              >
                <option value="Workshop">Hands-on Workshop</option>
                <option value="Meeting">Meeting / Study Group</option>
                <option value="Showcase">Project Showcase & Review</option>
              </select>
            </div>
            <div>
              <label className="label">Duration (Minutes)</label>
              <input
                type="number"
                min="15"
                max="240"
                step="15"
                value={duration}
                onChange={e => setDuration(Number(e.target.value))}
                className="input text-xs"
              />
            </div>
          </div>

          {/* Date & Time */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Event Date</label>
              <input
                type="date"
                required
                value={eventDate}
                onChange={e => setEventDate(e.target.value)}
                className="input text-xs"
              />
            </div>
            <div>
              <label className="label">Time (IST)</label>
              <input
                type="time"
                required
                value={eventTime}
                onChange={e => setEventTime(e.target.value)}
                className="input text-xs"
              />
            </div>
          </div>

          {/* Virtual Link */}
          <div>
            <label className="label flex items-center gap-1">
              <Video className="w-3.5 h-3.5 text-indigo-600" />
              Virtual Link (Google Meet / Zoom)
            </label>
            <input
              type="url"
              placeholder="https://meet.google.com/xyz-abc-def"
              value={link}
              onChange={e => setLink(e.target.value)}
              className="input text-xs"
            />
          </div>

          {/* Target Years */}
          <div>
            <label className="label">Target Year Audience</label>
            <div className="flex flex-wrap gap-2 mt-1">
              {[1, 2, 3, 4].map(yr => {
                const active = targetYears.includes(yr)
                return (
                  <button
                    key={yr}
                    type="button"
                    onClick={() => handleYearToggle(yr)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border ${
                      active
                        ? 'bg-[#1e3a5f] text-white border-[#1e3a5f]'
                        : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    {yr}st/nd/rd/th Year
                  </button>
                )
              })}
              <button
                type="button"
                onClick={() => setTargetYears([1, 2, 3, 4])}
                className="px-2.5 py-1.5 text-xs text-indigo-600 hover:underline font-semibold"
              >
                Select All
              </button>
            </div>
          </div>

          {/* Submit footer */}
          <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setIsCreateEventOpen(false)}
              className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!title.trim() || !description.trim() || !eventDate}
              className="px-4 py-1.5 rounded-lg bg-[#1e3a5f] hover:bg-[#152e4d] text-white font-bold transition-all disabled:opacity-50"
            >
              Schedule Event
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
