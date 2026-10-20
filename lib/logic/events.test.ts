/**
 * Event phase / upcoming-events filtering tests (Bug 3 regression)
 *
 * Covers the shared completion rule in lib/logic/events.ts:
 *   - future events, in progress events, events finished earlier today,
 *     events finished on a previous day and exact end-instant boundaries
 *   - IST (UTC+5:30) handling at date/time boundaries
 *   - malformed records never get hidden
 */
import { describe, it, expect } from 'vitest'
import {
  getEventPhase,
  getEventTimes,
  isEventUpcoming,
} from './events'

function event(date: string, time: string, duration = 60) {
  return { event_date: date, event_time: time, duration }
}

// All "now" instants are written with explicit UTC offsets so the tests are
// deterministic regardless of the machine timezone the suite runs in.
const now = (iso: string) => new Date(iso)

describe('getEventTimes', () => {
  it('adds the duration to the IST start instant', () => {
    const times = getEventTimes(event('2026-10-20', '12:00:00', 45))
    expect(times?.start.toISOString()).toBe('2026-10-20T06:30:00.000Z')
    expect(times?.end.toISOString()).toBe('2026-10-20T07:15:00.000Z')
  })

  it('falls back to the 60 minute column default for missing/invalid durations', () => {
    const times = getEventTimes({ event_date: '2026-10-20', event_time: '12:00:00', duration: 0 })
    expect(times?.end.toISOString()).toBe('2026-10-20T07:30:00.000Z')
  })

  it('returns null for malformed input instead of fabricating a status', () => {
    expect(getEventTimes(event('', '12:00:00'))).toBeNull()
    expect(getEventTimes(event('not-a-date', '12:00:00'))).toBeNull()
    expect(getEventTimes(event('2026-10-20', ''))).toBeNull()
  })

  it('accepts HH:MM time strings', () => {
    const times = getEventTimes(event('2026-10-20', '17:00', 60))
    expect(times?.start.toISOString()).toBe('2026-10-20T11:30:00.000Z')
  })
})

describe('getEventPhase', () => {
  it('marks a future event as upcoming', () => {
    const e = event('2026-11-01', '17:00:00', 60)
    expect(getEventPhase(e, now('2026-10-20T06:30:00Z'))).toBe('upcoming')
    expect(isEventUpcoming(e, now('2026-10-20T06:30:00Z'))).toBe(true)
  })

  it('marks an in-progress event as live but still upcoming', () => {
    const e = event('2026-10-20', '12:00:00', 60)
    const midEvent = now('2026-10-20T06:50:00Z') // 12:20 IST
    expect(getEventPhase(e, midEvent)).toBe('live')
    expect(isEventUpcoming(e, midEvent)).toBe(true)
  })

  it('marks an event finished earlier today as ended', () => {
    const e = event('2026-10-20', '09:00:00', 45) // ends 09:45 IST
    expect(getEventPhase(e, now('2026-10-20T06:30:00Z'))).toBe('ended')
    expect(isEventUpcoming(e, now('2026-10-20T06:30:00Z'))).toBe(false)
  })

  it('marks an event finished on a previous day as ended', () => {
    const e = event('2026-10-14', '22:00:00', 45) // live database row
    expect(getEventPhase(e, now('2026-10-20T06:30:00Z'))).toBe('ended')
    expect(isEventUpcoming(e, now('2026-10-20T06:30:00Z'))).toBe(false)
  })

  it('treats the exact start instant as live', () => {
    const e = event('2026-10-20', '12:00:00', 45)
    expect(getEventPhase(e, now('2026-10-20T06:30:00Z'))).toBe('live')
  })

  it('treats the exact end instant as ended (boundary)', () => {
    const e = event('2026-10-20', '12:00:00', 45) // ends 12:45 IST = 07:15 UTC
    const boundary = new Date('2026-10-20T07:15:00.000Z')
    expect(getEventPhase(e, boundary)).toBe('ended')
    expect(isEventUpcoming(e, boundary)).toBe(false)
  })

  it('treats one millisecond before the end instant as still live', () => {
    const e = event('2026-10-20', '12:00:00', 45)
    const justBeforeEnd = new Date('2026-10-20T07:14:59.999Z')
    expect(getEventPhase(e, justBeforeEnd)).toBe('live')
    expect(isEventUpcoming(e, justBeforeEnd)).toBe(true)
  })

  it('stays IST-consistent at the date boundary: a 23:30 IST start crossing into the next day', () => {
    // Starts 23:30 IST on the 19th (= 18:00 UTC), runs 60 min so it ends
    // 00:30 IST on the 20th. At 23:50 IST it must still be live even though
    // the calendar date rolled over.
    const e = event('2026-10-19', '23:30:00', 60)
    const during = new Date('2026-10-19T18:20:00.000Z') // 23:50 IST
    expect(getEventPhase(e, during)).toBe('live')
    const after = new Date('2026-10-19T19:00:00.000Z') // 00:30 IST next day
    expect(getEventPhase(e, after)).toBe('ended')
  })

  it('reports malformed records as upcoming so they are never silently hidden', () => {
    expect(getEventPhase(event('', ''), now('2026-10-20T06:30:00Z'))).toBe('upcoming')
    expect(isEventUpcoming(event('garbage', 'xx'), now('2026-10-20T06:30:00Z'))).toBe(true)
  })
})
