import { describe, expect, it } from 'vitest';

import { popupHref, selectPopupNotification } from './notification-popup';
import type { Notification } from './types';

const POST_ID = '3d4e5f60-7182-493a-9c4d-5e6f70819203';

function notification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: 'n1',
    user_id: 'user-1',
    type: 'comment',
    title: 'New reply',
    body: 'Someone replied to your discussion.',
    link: '/',
    read: false,
    created_at: '2026-10-25T10:00:00.000Z',
    content_type: null,
    content_id: null,
    ...overrides,
  };
}

describe('mobile popup candidate selection', () => {
  it('picks the newest unread visible row not already seen', () => {
    const rows = [
      notification({ id: 'older', created_at: '2026-10-25T09:00:00.000Z' }),
      notification({
        id: 'newest',
        type: 'announcement',
        created_at: '2026-10-25T12:00:00.000Z',
      }),
      notification({
        id: 'read',
        read: true,
        created_at: '2026-10-25T13:00:00.000Z',
      }),
      notification({
        id: 'hidden',
        type: 'message' as Notification['type'],
        created_at: '2026-10-25T14:00:00.000Z',
      }),
    ];

    expect(selectPopupNotification(rows, new Set())?.id).toBe('newest');
    expect(selectPopupNotification(rows, new Set(['newest']))?.id).toBe('older');
  });

  it('returns null when every row is read, hidden or already seen', () => {
    expect(selectPopupNotification([], new Set())).toBeNull();
    expect(
      selectPopupNotification(
        [
          notification({ id: 'seen' }),
          notification({ id: 'read', read: true }),
          notification({ id: 'hidden', type: 'connection_request' as Notification['type'] }),
        ],
        new Set(['seen'])
      )
    ).toBeNull();
  });
});

describe('mobile popup href', () => {
  it('routes a valid internal notification to its Expo destination', () => {
    expect(
      popupHref(
        notification({
          type: 'announcement',
          link: '/announcements',
        })
      )
    ).toBe('/announcements');
  });

  it('uses authoritative content ids even when the legacy link is unsafe', () => {
    expect(
      popupHref(
        notification({
          type: 'comment',
          content_type: 'discussion',
          content_id: POST_ID,
          link: 'https://evil.example/post',
        })
      )
    ).toEqual({ pathname: '/post/[id]', params: { id: POST_ID } });
  });

  it('falls back to home when an unsafe link has no usable content id', () => {
    expect(
      popupHref(
        notification({
          type: 'comment',
          content_type: null,
          content_id: null,
          link: 'https://evil.example/post',
        })
      )
    ).toBe('/');
  });
});
