import { describe, expect, it } from 'vitest';

import {
  dateToEventDate,
  eventDateToPickerDate,
  eventTimeToPickerDate,
  formatEventDate,
  formatEventTime,
  getEventDateBounds,
  isEventDateAllowed,
  timeToEventTime,
} from './event-form';

describe('event form date/time conversion', () => {
  it('maps an event date to local picker components without a UTC shift', () => {
    const pickerDate = eventDateToPickerDate('2026-11-05');

    expect(pickerDate).not.toBeNull();
    expect(pickerDate?.getFullYear()).toBe(2026);
    expect(pickerDate?.getMonth()).toBe(10);
    expect(pickerDate?.getDate()).toBe(5);
    expect(pickerDate?.getHours()).toBe(0);
    expect(pickerDate?.getMinutes()).toBe(0);
  });

  it('maps a picked local day back to the stored event date', () => {
    expect(dateToEventDate(new Date(2026, 10, 5, 17, 30))).toBe('2026-11-05');
  });

  it('maps 24-hour event times to picker components', () => {
    const pickerTime = eventTimeToPickerDate('17:05');

    expect(pickerTime).not.toBeNull();
    expect(pickerTime?.getHours()).toBe(17);
    expect(pickerTime?.getMinutes()).toBe(5);
  });

  it('accepts stored times with seconds while editing', () => {
    const pickerTime = eventTimeToPickerDate('17:05:00');

    expect(pickerTime?.getHours()).toBe(17);
    expect(pickerTime?.getMinutes()).toBe(5);
  });

  it('maps a picked local time back to the stored 24-hour event time', () => {
    expect(timeToEventTime(new Date(2026, 10, 5, 17, 5))).toBe('17:05');
  });

  it('rejects impossible dates and times', () => {
    expect(eventDateToPickerDate('2026-02-31')).toBeNull();
    expect(eventDateToPickerDate('05/11/2026')).toBeNull();
    expect(eventTimeToPickerDate('24:00')).toBeNull();
    expect(eventTimeToPickerDate('17:60')).toBeNull();
  });

  it('formats readable, non-editable field values', () => {
    expect(formatEventDate('2026-11-05')).toBe('Thu, 5 Nov 2026');
    expect(formatEventTime('17:05')).toBe('17:05 IST');
    expect(formatEventDate('')).toBe('');
    expect(formatEventTime('')).toBe('');
  });
});

describe('event date bounds', () => {
  it('uses the current IST calendar day as the minimum for a new event', () => {
    const lateIstEvening = new Date('2026-10-25T18:29:00.000Z'); // 23:59 IST
    const justAfterIstMidnight = new Date('2026-10-25T18:30:00.000Z'); // 00:00 IST

    expect(dateToEventDate(getEventDateBounds({ now: lateIstEvening }).minimumDate)).toBe(
      '2026-10-25'
    );
    expect(dateToEventDate(getEventDateBounds({ now: justAfterIstMidnight }).minimumDate)).toBe(
      '2026-10-26'
    );
  });

  it('allows scheduling up to five years ahead', () => {
    const bounds = getEventDateBounds({ now: new Date('2026-10-25T06:00:00.000Z') });

    expect(dateToEventDate(bounds.maximumDate)).toBe('2031-10-25');
  });

  it('keeps an existing past event editable', () => {
    const bounds = getEventDateBounds({
      now: new Date('2026-10-25T06:00:00.000Z'),
      editingDate: '2024-03-01',
    });

    expect(dateToEventDate(bounds.minimumDate)).toBe('2024-03-01');
    expect(isEventDateAllowed('2024-03-01', bounds)).toBe(true);
  });

  it('accepts only values inside the selectable range', () => {
    const bounds = getEventDateBounds({ now: new Date('2026-10-25T06:00:00.000Z') });

    expect(isEventDateAllowed('2026-10-25', bounds)).toBe(true);
    expect(isEventDateAllowed('2031-10-25', bounds)).toBe(true);
    expect(isEventDateAllowed('2026-10-24', bounds)).toBe(false);
    expect(isEventDateAllowed('2031-10-26', bounds)).toBe(false);
    expect(isEventDateAllowed('not-a-date', bounds)).toBe(false);
  });
});
