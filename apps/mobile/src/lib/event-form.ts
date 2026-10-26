/**
 * Event date/time form helpers.
 *
 * The database stores `event_date` as `YYYY-MM-DD` and `event_time` as
 * `HH:MM[:SS]`, and the whole app interprets those wall-clock values as IST
 * (see `feed-logic.ts`). Picker components work with `Date` objects in the
 * device's local calendar, so these helpers deliberately move calendar
 * components in and out without converting through UTC.
 */

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** Parses a stored event date into a local-midnight Date for the picker. */
export function eventDateToPickerDate(value: string): Date | null {
  const match = DATE_PATTERN.exec(value.trim());
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day, 0, 0, 0, 0);

  // Reject dates that JavaScript silently rolls over, such as 2026-02-31.
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

/** Parses a stored event time into a Date whose local hours/minutes are used. */
export function eventTimeToPickerDate(value: string): Date | null {
  const match = TIME_PATTERN.exec(value.trim());
  if (!match) return null;

  return new Date(2000, 0, 1, Number(match[1]), Number(match[2]), 0, 0);
}

/** Formats a picked local day as the stored `YYYY-MM-DD` value. */
export function dateToEventDate(value: Date): string {
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

/** Formats a picked local time as the stored 24-hour `HH:MM` value. */
export function timeToEventTime(value: Date): string {
  return `${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

/** Human-readable date for the non-editable field. Returns '' when invalid. */
export function formatEventDate(value: string): string {
  const date = eventDateToPickerDate(value);
  if (!date) return '';
  return `${WEEKDAYS[date.getDay()]}, ${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/** Human-readable 24-hour time for the non-editable field. Returns '' when invalid. */
export function formatEventTime(value: string): string {
  const time = eventTimeToPickerDate(value);
  if (!time) return '';
  return `${pad(time.getHours())}:${pad(time.getMinutes())} IST`;
}

/* -------------------------------- bounds --------------------------------- */

export const EVENT_SCHEDULE_YEARS = 5;
const IST_OFFSET_MS = 330 * 60_000;

export interface EventDateBounds {
  minimumDate: Date;
  maximumDate: Date;
}

/** The current IST calendar day, expressed as a local-midnight Date. */
function istCalendarDate(now: Date): Date {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  return new Date(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), 0, 0, 0, 0);
}

/**
 * Selectable date range for the picker. New events start from the current IST
 * day. When editing an existing event, its original date is always kept inside
 * the range so an old event can still be saved without changing its date.
 */
export function getEventDateBounds({
  now = new Date(),
  editingDate,
}: {
  now?: Date;
  editingDate?: string | null;
} = {}): EventDateBounds {
  const today = istCalendarDate(now);
  let minimumDate = today;
  let maximumDate = new Date(
    today.getFullYear() + EVENT_SCHEDULE_YEARS,
    today.getMonth(),
    today.getDate(),
    0,
    0,
    0,
    0
  );

  const existing = editingDate ? eventDateToPickerDate(editingDate) : null;
  if (existing && existing.getTime() < minimumDate.getTime()) minimumDate = existing;
  if (existing && existing.getTime() > maximumDate.getTime()) maximumDate = existing;

  return { minimumDate, maximumDate };
}

export function isEventDateAllowed(value: string, bounds: EventDateBounds): boolean {
  const date = eventDateToPickerDate(value);
  if (!date) return false;
  const time = date.getTime();
  return time >= bounds.minimumDate.getTime() && time <= bounds.maximumDate.getTime();
}

