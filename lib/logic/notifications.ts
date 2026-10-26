/**
 * Notification visibility and popup rules shared by the web list, the web
 * popup and the realtime subscription.
 *
 * The database can still emit messaging and connection notifications for
 * legacy rows and triggers, but the community product no longer has those
 * surfaces. Those rows must never reach the bell, a popup or a deep link.
 */

export const HIDDEN_NOTIFICATION_TYPES = [
  'message',
  'connection_request',
  'connection_accepted',
] as const

export function isNotificationVisible(type: unknown): boolean {
  return typeof type === 'string' && type.length > 0
    && !(HIDDEN_NOTIFICATION_TYPES as readonly string[]).includes(type)
}

export function filterVisibleNotifications<T extends { type: string }>(rows: T[]): T[] {
  return rows.filter(row => isNotificationVisible(row.type))
}

/**
 * Popup links are restricted to same-origin paths. Anything that could leave
 * the app, or use a protocol-relative/backslash path, falls back to the home
 * page instead of becoming a dead end.
 */
export function safeNotificationLink(link: string | null | undefined): string {
  if (!link) return '/'
  if (!link.startsWith('/')) return '/'
  if (link.startsWith('//') || link.startsWith('/\\')) return '/'
  if (link.includes('\\')) return '/'
  return link
}

export function selectPopupNotification<
  T extends { id: string; type: string; read: boolean; created_at: string }
>(rows: T[], seenIds: ReadonlySet<string>): T | null {
  const eligible = rows
    .filter(row => !row.read && isNotificationVisible(row.type) && !seenIds.has(row.id))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
  return eligible[0] ?? null
}
