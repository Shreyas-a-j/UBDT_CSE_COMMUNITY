'use client'

import React, { useState } from 'react'
import { X, Calendar, Video } from 'lucide-react'
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
      <div className="modal-content" style={{ background: '#0b1220', border: '2px solid #00aaff', boxShadow: '6px 6px 0px #000, 0 0 24px rgba(0,170,255,0.18)', borderRadius: 0, outline: 'none' }}>
        {/* Header */}
        <div style={{ background: '#090e1c', borderBottom: '2px solid #1e3560', padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 34, height: 34, background: '#00ffcc', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '2px 2px 0px #000' }}>
              <Calendar style={{ width: 18, height: 18, color: '#060a14' }} />
            </div>
            <div>
              <h2 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#e8f4fd', letterSpacing: '0.02em', margin: 0 }}>
                Host New UCC Workshop / Event
              </h2>
              <p style={{ fontSize: '0.72rem', color: '#6bafd4', margin: 0 }}>
                Schedule a virtual workshop, review meeting, or study session
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setIsCreateEventOpen(false)}
            style={{ background: 'transparent', border: '2px solid #1e3560', padding: '5px', cursor: 'pointer', color: '#6bafd4', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = '#00aaff'; (e.currentTarget as HTMLElement).style.color = '#e8f4fd' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = '#1e3560'; (e.currentTarget as HTMLElement).style.color = '#6bafd4' }}
          >
            <X style={{ width: 16, height: 16 }} />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} style={{ padding: '18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label className="label">Event Title</label>
            <input
              type="text"
              required
              placeholder="e.g. Hands-on Docker & Kubernetes Workshop for Beginners"
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="input"
            />
          </div>

          <div>
            <label className="label">Description &amp; Agenda</label>
            <textarea
              required
              rows={3}
              placeholder="Outline what students will learn, prerequisites, and session expectations..."
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="textarea"
            />
          </div>

          {/* Type & Duration */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label className="label">Event Type</label>
              <select
                value={type}
                onChange={e => setType(e.target.value as any)}
                className="select"
              >
                <option value="Workshop">Hands-on Workshop</option>
                <option value="Meeting">Meeting / Study Group</option>
                <option value="Showcase">Project Showcase &amp; Review</option>
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
                className="input"
              />
            </div>
          </div>

          {/* Date & Time */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label className="label">Event Date</label>
              <input
                type="date"
                required
                value={eventDate}
                onChange={e => setEventDate(e.target.value)}
                className="input"
              />
            </div>
            <div>
              <label className="label">Time (IST)</label>
              <input
                type="time"
                required
                value={eventTime}
                onChange={e => setEventTime(e.target.value)}
                className="input"
              />
            </div>
          </div>

          {/* Virtual Link */}
          <div>
            <label className="label" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Video style={{ width: 14, height: 14, color: '#00aaff' }} />
              Virtual Link (Google Meet / Zoom)
            </label>
            <input
              type="url"
              placeholder="https://meet.google.com/xyz-abc-def"
              value={link}
              onChange={e => setLink(e.target.value)}
              className="input"
            />
          </div>

          {/* Target Years */}
          <div>
            <label className="label">Target Batch Audience</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
              {[1, 2, 3, 4].map(yr => {
                const active = targetYears.includes(yr)
                return (
                  <button
                    key={yr}
                    type="button"
                    onClick={() => handleYearToggle(yr)}
                    style={{
                      padding: '6px 12px', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer',
                      border: '2px solid', textTransform: 'uppercase', transition: 'all 0.05s steps(1)',
                      background: active ? '#00aaff' : 'transparent',
                      color: active ? '#060a14' : '#a8d4f0',
                      borderColor: active ? '#0088cc' : '#1e3560',
                      boxShadow: active ? '2px 2px 0px #003366' : 'none',
                    }}
                  >
                    {yr === 1 ? '1st' : yr === 2 ? '2nd' : yr === 3 ? '3rd' : '4th'} Year
                  </button>
                )
              })}
              <button
                type="button"
                onClick={() => setTargetYears([1, 2, 3, 4])}
                style={{ padding: '6px 10px', fontSize: '0.72rem', color: '#00ffcc', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', fontWeight: 600 }}
              >
                Select All
              </button>
            </div>
          </div>

          {/* Submit footer */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, paddingTop: 14, borderTop: '2px solid #1e3560' }}>
            <button
              type="button"
              onClick={() => setIsCreateEventOpen(false)}
              style={{ padding: '8px 14px', background: 'transparent', border: '2px solid #1e3560', color: '#a8d4f0', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer', textTransform: 'uppercase', boxShadow: '2px 2px 0px #000' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!title.trim() || !description.trim() || !eventDate}
              style={{
                padding: '8px 18px', background: '#00f5c4', color: '#060a14', border: '2px solid #00cca0',
                fontSize: '0.78rem', fontWeight: 800, cursor: 'pointer', textTransform: 'uppercase',
                boxShadow: '3px 3px 0px #006650', opacity: (!title.trim() || !description.trim() || !eventDate) ? 0.5 : 1,
                letterSpacing: '0.03em',
              }}
            >
              Schedule Workshop
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
