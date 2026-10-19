'use client'

import React, { useState } from 'react'
import { Calendar, Video } from 'lucide-react'
import { useCommunity } from '@/contexts/CommunityContext'
import Modal, { ModalCloseButton } from '@/components/Modal'

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

  const close = () => setIsCreateEventOpen(false)

  const handleYearToggle = (year: number) => {
    if (targetYears.includes(year)) {
      if (targetYears.length > 1) setTargetYears(targetYears.filter(y => y !== year))
    } else {
      setTargetYears([...targetYears, year].sort())
    }
  }

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
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

    setTitle('')
    setDescription('')
    setLink('')
    close()
  }

  return (
    <Modal open={isCreateEventOpen} onClose={close} labelledBy="create-event-title">
      <div className="modal-head">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-accent/30 bg-accent-soft text-accent-hover">
            <Calendar className="h-4 w-4" />
          </span>
          <div>
            <h2 id="create-event-title" className="text-[16px] font-semibold text-ink">
              Host an event
            </h2>
            <p className="mt-0.5 text-[12px] text-muted">
              Schedule a workshop, review session or study group.
            </p>
          </div>
        </div>
        <ModalCloseButton onClick={close} />
      </div>

      <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
        <div className="modal-body space-y-4">
          <div>
            <label className="label" htmlFor="event-title">Title</label>
            <input
              id="event-title"
              type="text"
              required
              placeholder="e.g. Hands-on Docker workshop for beginners"
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="field"
            />
          </div>

          <div>
            <label className="label" htmlFor="event-description">Agenda</label>
            <textarea
              id="event-description"
              required
              rows={3}
              placeholder="What will students learn? Any prerequisites?"
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="field-area"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="event-type">Type</label>
              <select
                id="event-type"
                value={type}
                onChange={e => setType(e.target.value as typeof type)}
                className="field-select"
              >
                <option value="Workshop">Hands-on workshop</option>
                <option value="Meeting">Meeting / study group</option>
                <option value="Showcase">Project showcase &amp; review</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="event-duration">Duration, minutes</label>
              <input
                id="event-duration"
                type="number"
                min="15"
                max="240"
                step="15"
                value={duration}
                onChange={e => setDuration(Number(e.target.value))}
                className="field"
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="event-date">Date</label>
              <input
                id="event-date"
                type="date"
                required
                value={eventDate}
                onChange={e => setEventDate(e.target.value)}
                className="field"
              />
            </div>
            <div>
              <label className="label" htmlFor="event-time">Time, IST</label>
              <input
                id="event-time"
                type="time"
                required
                value={eventTime}
                onChange={e => setEventTime(e.target.value)}
                className="field"
              />
            </div>
          </div>

          <div>
            <label className="label flex items-center gap-1.5" htmlFor="event-link">
              <Video className="h-3 w-3" /> Virtual link
            </label>
            <input
              id="event-link"
              type="url"
              placeholder="https://meet.google.com/…"
              value={link}
              onChange={e => setLink(e.target.value)}
              className="field"
            />
          </div>

          <div>
            <span className="label">Who is this for?</span>
            <div className="flex flex-wrap gap-1.5">
              {[1, 2, 3, 4].map(year => {
                const active = targetYears.includes(year)
                return (
                  <button
                    key={year}
                    type="button"
                    onClick={() => handleYearToggle(year)}
                    aria-pressed={active}
                    className={`btn h-8 ${active ? 'btn-accent' : 'btn-outline'}`}
                  >
                    {year === 1 ? '1st' : year === 2 ? '2nd' : year === 3 ? '3rd' : '4th'} year
                  </button>
                )
              })}
              {targetYears.length < 4 && (
                <button
                  type="button"
                  onClick={() => setTargetYears([1, 2, 3, 4])}
                  className="btn btn-ghost h-8 text-accent"
                >
                  Select all
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={close}>
            Cancel
          </button>
          <button
            type="submit"
            disabled={!title.trim() || !description.trim() || !eventDate}
            className="btn btn-accent"
          >
            Schedule event
          </button>
        </div>
      </form>
    </Modal>
  )
}
