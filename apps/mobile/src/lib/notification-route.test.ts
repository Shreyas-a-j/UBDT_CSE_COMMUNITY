import { describe, expect, it } from 'vitest';

import {
  isSafeInternalPath,
  routeForNotification,
  routeForPushData,
} from './notification-route';

const ANNOUNCEMENT_ID = '1b2c3d4e-5f60-4718-9a2b-3c4d5e6f7081';
const EVENT_ID = '2c3d4e5f-6071-4829-8b3c-4d5e6f708192';
const POST_ID = '3d4e5f60-7182-493a-9c4d-5e6f70819203';

describe('notification routing', () => {
  it('routes announcements by content type', () => {
    expect(
      routeForNotification({
        type: 'announcement',
        content_type: 'announcement',
        content_id: ANNOUNCEMENT_ID,
        link: null,
      })
    ).toBe('/announcements');
  });

  it('routes events by content id', () => {
    expect(
      routeForNotification({
        type: 'event_published',
        content_type: 'event',
        content_id: EVENT_ID,
        link: null,
      })
    ).toEqual({ pathname: '/event/[id]', params: { id: EVENT_ID } });
  });

  it('routes a showcase top-two result to the project', () => {
    expect(
      routeForNotification({
        type: 'showcase_top2',
        content_type: 'showcase',
        content_id: POST_ID,
        link: `/#showcase-${POST_ID}`,
      })
    ).toEqual({ pathname: '/post/[id]', params: { id: POST_ID } });
  });

  it('falls back to legacy link shapes and safe list routes', () => {
    expect(
      routeForNotification({
        type: 'comment',
        content_type: null,
        content_id: null,
        link: `/#post-${POST_ID}`,
      })
    ).toEqual({ pathname: '/post/[id]', params: { id: POST_ID } });
    expect(
      routeForNotification({
        type: 'event_reminder',
        content_type: null,
        content_id: null,
        link: '/events',
      })
    ).toBe('/events');
  });

  it('maps OneSignal snake_case data exactly like the in-app row', () => {
    expect(
      routeForPushData({
        notification_id: 'ignored',
        content_type: 'showcase',
        content_id: POST_ID,
        type: 'showcase_top2',
      })
    ).toEqual({ pathname: '/post/[id]', params: { id: POST_ID } });
  });

  it('never throws on malformed push data', () => {
    expect(routeForPushData(null)).toBe('/');
    expect(routeForPushData({ content_type: 7, content_id: {}, type: [] })).toBe('/');
  });
});

describe('safe internal notification paths', () => {
  it('accepts same-origin paths', () => {
    expect(isSafeInternalPath('/')).toBe(true);
    expect(isSafeInternalPath('/announcements')).toBe(true);
    expect(isSafeInternalPath('/post/abc')).toBe(true);
  });

  it('rejects external, protocol-relative, backslash and empty paths', () => {
    for (const link of [
      '//evil.example',
      '/\\evil.example',
      'https://evil.example',
      'javascript:alert(1)',
      '/a\\b',
      '',
      null,
      undefined,
    ]) {
      expect(isSafeInternalPath(link)).toBe(false);
    }
  });
});
