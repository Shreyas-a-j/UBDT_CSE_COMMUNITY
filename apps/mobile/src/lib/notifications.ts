/**
 * Notification visibility rules.
 *
 * The database still emits messaging and connection notifications for legacy
 * rows and triggers, but the community product no longer has any messaging or
 * connection surface. Those rows must never reach the mobile UI, the unread
 * badge, or a deep link, so every notification query excludes them server-side
 * and realtime inserts are checked against the same list.
 *
 * This module is pure so the rule can be unit-tested without React Native.
 */

/** Server-side PostgREST `not in` list. */
export const HIDDEN_NOTIFICATION_TYPES = [
  'message',
  'connection_request',
  'connection_accepted',
] as const;

/** Ready-to-use value for `.not('type', 'in', ...)`. */
export const HIDDEN_NOTIFICATION_FILTER = `(${HIDDEN_NOTIFICATION_TYPES.join(',')})`;

const HIDDEN = new Set<string>(HIDDEN_NOTIFICATION_TYPES);

export function isNotificationVisible(type: unknown): boolean {
  return typeof type === 'string' && type.length > 0 && !HIDDEN.has(type);
}
