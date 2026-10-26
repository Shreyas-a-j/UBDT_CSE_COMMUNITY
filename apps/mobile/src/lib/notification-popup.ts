/**
 * Pure selection and routing rules for the launch/foreground notification
 * popup. Kept framework-free so the popup component stays a thin shell and
 * the same rules can be tested without a React Native runtime.
 */

import { isNotificationVisible } from './notifications';
import { isSafeInternalPath, routeForNotification } from './notification-route';
import type { Notification } from './types';

export function selectPopupNotification(
  rows: Notification[],
  seenIds: ReadonlySet<string>
): Notification | null {
  const eligible = rows
    .filter((row) => !row.read && isNotificationVisible(row.type) && !seenIds.has(row.id))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  return eligible[0] ?? null;
}

export function popupHref(notification: Notification) {
  const safeLink = isSafeInternalPath(notification.link) ? notification.link : null;
  return routeForNotification({ ...notification, link: safeLink });
}
