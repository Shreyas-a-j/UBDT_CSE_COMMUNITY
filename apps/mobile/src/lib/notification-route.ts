/**
 * Pure notification → route mapping shared by the in-app list and Android
 * push clicks. Keeping it framework-free makes the two entry points agree
 * and lets the rules run under Vitest without React Native.
 */

import type { Href } from 'expo-router';

import type { Notification } from './types';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

function uuidFrom(value: string | null | undefined, pattern: RegExp): string | null {
  if (!value) return null;
  return value.match(pattern)?.[1] ?? null;
}

export interface PushAdditionalData {
  notification_id?: unknown;
  content_type?: unknown;
  content_id?: unknown;
  link?: unknown;
  type?: unknown;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Same-origin path guard shared by the popup and any future link surface.
 * Rejects external URLs, protocol-relative paths and backslash tricks.
 */
export function isSafeInternalPath(link: string | null | undefined): boolean {
  if (!link) return false;
  if (!link.startsWith('/')) return false;
  if (link.startsWith('//') || link.startsWith('/\\')) return false;
  if (link.includes('\\')) return false;
  return true;
}

/**
 * Resolves a notification to the same content the website opens.
 * `content_type` / `content_id` are authoritative; legacy link shapes are
 * accepted when those columns are absent.
 */
export function routeForNotification(
  notification: Pick<Notification, 'type' | 'link' | 'content_type' | 'content_id'>
): Href {
  const contentId = notification.content_id ?? null;
  const contentType = notification.content_type ?? null;
  const link = notification.link ?? null;

  if (notification.type === 'faculty_decision') {
    return '/profile';
  }

  if (
    notification.type === 'announcement' ||
    contentType === 'announcement' ||
    link?.startsWith('/announcements')
  ) {
    return '/announcements';
  }

  if (
    notification.type === 'event_published' ||
    notification.type === 'event_reminder' ||
    notification.type === 'rsvp' ||
    contentType === 'event'
  ) {
    const eventId =
      contentId ??
      uuidFrom(link, new RegExp(`#event-(${UUID})`, 'i')) ??
      uuidFrom(link, new RegExp(`/events?/(${UUID})`, 'i'));
    return eventId ? { pathname: '/event/[id]', params: { id: eventId } } : '/events';
  }

  if (
    notification.type === 'comment' ||
    notification.type === 'like' ||
    notification.type === 'upvote' ||
    notification.type === 'showcase_top2' ||
    contentType === 'discussion' ||
    contentType === 'showcase'
  ) {
    const postId =
      contentId ??
      uuidFrom(link, new RegExp(`#(?:post|discussion|showcase)-(${UUID})`, 'i')) ??
      uuidFrom(link, new RegExp(`/posts?/(${UUID})`, 'i'));
    return postId ? { pathname: '/post/[id]', params: { id: postId } } : '/';
  }

  return '/';
}

/**
 * OneSignal click payload. Server code writes the same snake_case keys the
 * in-app notification uses. Unknown or malformed data safely falls back to
 * the home tab.
 */
export function routeForPushData(data: PushAdditionalData | null | undefined): Href {
  if (!data) return '/';

  return routeForNotification({
    type: (stringOrNull(data.type) as Notification['type']) ?? 'comment',
    link: stringOrNull(data.link),
    content_type: stringOrNull(data.content_type),
    content_id: stringOrNull(data.content_id),
  });
}
