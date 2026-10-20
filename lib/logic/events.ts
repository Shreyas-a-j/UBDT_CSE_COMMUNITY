import type { Event } from '@/lib/types'

/**
 * Event scheduling is stored as three fields:
 *   event_date (date)  — calendar date of the start, in IST
 *   event_time (time)  — start time on that date, in IST
 *   duration  (minutes)— how long the session runs
 *
 * The UI labels the time field "IST" (see EventCard), so every phase
 * calculation uses a fixed UTC+5:30 offset. India does not observe DST,
 * which makes this safe to encode as a constant offset instead of a
 * full TZ database conversion.
 */
export const EVENT_TIME_OFFSET = '+05:30'

export type EventPhase = 'upcoming' | 'live' | 'ended'

export type EventTiming = Pick<Event, 'event_date' | 'event_time' | 'duration'>

function startInstant(event: EventTiming): Date | null {
  const date = event.event_date?.trim()
  const time = event.event_time?.trim()
  if (!date || !time) return null
  const timePart = time.length === 8 ? time : `${time}:00`
  const parsed = new Date(`${date}T${timePart}${EVENT_TIME_OFFSET}`)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/**
 * Exact instant at which an event starts and finishes. `duration` defaults
 * to 60 to match the database column default (schema.sql) when absent.
 */
export function getEventTimes(event: EventTiming): { start: Date; end: Date } | null {
  const start = startInstant(event)
  if (!start) return null
  const minutes = Number.isFinite(event.duration) && event.duration > 0 ? event.duration : 60
  return { start, end: new Date(start.getTime() + minutes * 60_000) }
}

/**
 * One shared rule for where an event currently stands:
 *  - upcoming: starts at or after `now`
 *  - live:     started but its end instant has not passed yet
 *  - ended:    the end instant has passed
 *
 * Events whose stored date/time cannot be parsed are reported as
 * 'upcoming' so malformed records are never silently hidden.
 */
export function getEventPhase(event: EventTiming, now: Date = new Date()): EventPhase {
  const times = getEventTimes(event)
  if (!times) return 'upcoming'
  if (now.getTime() < times.start.getTime()) return 'upcoming'
  if (now.getTime() < times.end.getTime()) return 'live'
  return 'ended'
}

/**
 * True when the event is not finished yet — i.e. it is either still to
 * come or currently in progress. Every "upcoming events" surface should
 * filter on this so the rule stays consistent app-wide.
 */
export function isEventUpcoming(event: EventTiming, now: Date = new Date()): boolean {
  return getEventPhase(event, now) !== 'ended'
}
