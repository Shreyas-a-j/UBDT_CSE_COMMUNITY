import { describe, expect, it } from 'vitest';

import type { Event } from './types';
import {
  EVENT_TIME_OFFSET,
  canDeleteAnnouncement,
  filterActiveEvents,
  filterFeedEvents,
  formatPinCountdown,
  getEventPhase,
  getEventTimes,
  sortEventsByStart,
} from './feed-logic';

const IST = EVENT_TIME_OFFSET;

function event(overrides: Partial<Event> = {}): Event {
  return {
    id: 'event-1',
    host_id: 'host-1',
    host_name: 'Host',
    host_avatar: null,
    host_year: 3,
    title: 'Workshop',
    description: 'A workshop',
    type: 'Workshop',
    event_date: '2026-10-24',
    event_time: '18:00',
    duration: 60,
    link: null,
    target_years: [1, 2, 3, 4],
    created_at: '2026-10-01T00:00:00.000Z',
    rsvp_count: 0,
    ...overrides,
  } as Event;
}

describe('IST event time derivation', () => {
  it('interprets event_date/time as IST, not device local time', () => {
    const times = getEventTimes(event());
    expect(times?.start.toISOString()).toBe('2026-10-24T12:30:00.000Z');
    expect(times?.end.toISOString()).toBe('2026-10-24T13:30:00.000Z');
    expect(IST).toBe('+05:30');
  });

  it('defaults a missing or invalid duration to 60 minutes', () => {
    expect(getEventTimes(event({ duration: 0 }))?.end.toISOString()).toBe(
      '2026-10-24T13:30:00.000Z'
    );
    expect(getEventTimes(event({ duration: Number.NaN }))?.end.toISOString()).toBe(
      '2026-10-24T13:30:00.000Z'
    );
  });

  it('uses the real duration when present', () => {
    expect(getEventTimes(event({ duration: 150 }))?.end.toISOString()).toBe(
      '2026-10-24T15:00:00.000Z'
    );
  });
});

describe('event phases at IST boundaries', () => {
  const at = (iso: string) => new Date(iso);

  it('is upcoming before start, live through the interval, ended at end', () => {
    expect(getEventPhase(event(), at('2026-10-24T12:29:59.999Z'))).toBe('upcoming');
    expect(getEventPhase(event(), at('2026-10-24T12:30:00.000Z'))).toBe('live');
    expect(getEventPhase(event(), at('2026-10-24T13:29:59.999Z'))).toBe('live');
    expect(getEventPhase(event(), at('2026-10-24T13:30:00.000Z'))).toBe('ended');
  });

  it('handles an event that just ended', () => {
    const justEnded = at('2026-10-24T13:30:01.000Z');
    expect(filterActiveEvents([event()], justEnded)).toHaveLength(0);
  });

  it('keeps ongoing and future events, including future events regardless of any registration state', () => {
    const now = at('2026-10-24T12:45:00.000Z');
    const future = event({
      id: 'future',
      event_date: '2027-01-01',
      event_time: '09:00',
    });
    const ongoing = event({ id: 'ongoing' });

    expect(filterActiveEvents([ongoing, future], now).map((row) => row.id)).toEqual([
      'ongoing',
      'future',
    ]);
  });

  it('never hides a future event because the current time is before it', () => {
    const now = at('2020-01-01T00:00:00.000Z');
    expect(filterActiveEvents([event()], now)).toHaveLength(1);
  });
});

describe('sorting and feed filtering', () => {
  it('sorts by start ascending and keeps unparseable rows last', () => {
    const later = event({ id: 'later', event_date: '2026-10-25' });
    const sooner = event({ id: 'sooner', event_date: '2026-10-23' });
    const broken = event({ id: 'broken', event_time: '' });
    expect(sortEventsByStart([later, broken, sooner]).map((row) => row.id)).toEqual([
      'sooner',
      'later',
      'broken',
    ]);
  });

  it('hides ended events from the feed selection while keeping live and future rows', () => {
    const now = new Date('2026-10-24T12:45:00.000Z');
    const ended = event({ id: 'ended', event_date: '2026-10-23' });
    const live = event({ id: 'live' });
    const future = event({ id: 'future', event_date: '2026-10-26' });

    const selected = filterFeedEvents(
      [ended, live, future],
      { feedFilter: 'all', batch: 0, searchQuery: '' },
      now
    );

    expect(selected.map((row) => row.id)).toEqual(['live', 'future']);
  });
});

describe('pin countdown', () => {
  const now = new Date('2026-10-23T12:00:00.000Z');

  it('renders days and hours for a multi-day pin', () => {
    expect(formatPinCountdown('2026-10-30T11:00:00.000Z', now)).toBe('Expires in 6d 23h');
  });

  it('renders minutes and seconds under an hour', () => {
    expect(formatPinCountdown('2026-10-23T12:59:12.000Z', now)).toBe('Expires in 59m 12s');
  });

  it('renders seconds only under a minute', () => {
    expect(formatPinCountdown('2026-10-23T12:00:42.000Z', now)).toBe('Expires in 42s');
  });

  it('reports Expired at the exact expiry instant and for an invalid date', () => {
    expect(formatPinCountdown(now.toISOString(), now)).toBe('Expired');
    expect(formatPinCountdown('not-a-date', now)).toBe('Expired');
  });
});

describe('canDeleteAnnouncement', () => {
  const authorId = 'faculty-1';

  it('allows the author', () => {
    expect(canDeleteAnnouncement({ id: 'faculty-1', role: 'faculty' }, authorId)).toBe(true);
  });

  it('allows an admin who is not the author', () => {
    expect(canDeleteAnnouncement({ id: 'admin-1', role: 'admin' }, authorId)).toBe(true);
  });

  it('rejects another student or faculty member', () => {
    expect(canDeleteAnnouncement({ id: 'student-1', role: 'student' }, authorId)).toBe(false);
    expect(canDeleteAnnouncement({ id: 'faculty-2', role: 'faculty' }, authorId)).toBe(false);
  });

  it('rejects a signed-out viewer', () => {
    expect(canDeleteAnnouncement(null, authorId)).toBe(false);
    expect(canDeleteAnnouncement(undefined, authorId)).toBe(false);
    expect(canDeleteAnnouncement({ role: 'admin' }, authorId)).toBe(false);
  });
});
