import { describe, expect, it } from 'vitest'

import {
  HIDDEN_NOTIFICATION_TYPES,
  filterVisibleNotifications,
  isNotificationVisible,
  safeNotificationLink,
  selectPopupNotification,
} from './notifications'

const row = (overrides: Partial<{
  id: string
  type: string
  read: boolean
  created_at: string
}>) => ({
  id: 'n1',
  type: 'comment',
  read: false,
  created_at: '2026-10-25T10:00:00.000Z',
  ...overrides,
})

describe('notification visibility', () => {
  it('hides the removed messaging and connection types', () => {
    expect(HIDDEN_NOTIFICATION_TYPES).toEqual([
      'message',
      'connection_request',
      'connection_accepted',
    ])
    for (const type of HIDDEN_NOTIFICATION_TYPES) {
      expect(isNotificationVisible(type)).toBe(false)
    }
  })

  it('keeps real community notification types visible', () => {
    expect(isNotificationVisible('comment')).toBe(true)
    expect(isNotificationVisible('announcement')).toBe(true)
    expect(isNotificationVisible('event_published')).toBe(true)
    expect(isNotificationVisible('showcase_top2')).toBe(true)
  })

  it('never treats a missing or non-string type as visible', () => {
    expect(isNotificationVisible(undefined)).toBe(false)
    expect(isNotificationVisible(null)).toBe(false)
    expect(isNotificationVisible('')).toBe(false)
    expect(isNotificationVisible(7)).toBe(false)
  })

  it('filters hidden rows out of a list without dropping visible ones', () => {
    const rows = [
      row({ id: 'visible', type: 'comment' }),
      row({ id: 'hidden', type: 'connection_request' }),
      row({ id: 'announcement', type: 'announcement' }),
    ]

    expect(filterVisibleNotifications(rows).map(item => item.id)).toEqual([
      'visible',
      'announcement',
    ])
  })
})

describe('safe notification links', () => {
  it('accepts internal paths', () => {
    expect(safeNotificationLink('/')).toBe('/')
    expect(safeNotificationLink('/announcements')).toBe('/announcements')
    expect(safeNotificationLink('/post/abc')).toBe('/post/abc')
  })

  it('rejects external, protocol-relative, backslash and empty links', () => {
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
      expect(safeNotificationLink(link)).toBe('/')
    }
  })
})

describe('popup candidate selection', () => {
  it('picks the newest unread visible row not already seen', () => {
    const rows = [
      row({ id: 'older', type: 'comment', created_at: '2026-10-25T09:00:00.000Z' }),
      row({ id: 'newest', type: 'announcement', created_at: '2026-10-25T12:00:00.000Z' }),
      row({ id: 'read', type: 'event_published', read: true, created_at: '2026-10-25T13:00:00.000Z' }),
      row({ id: 'hidden', type: 'message', created_at: '2026-10-25T14:00:00.000Z' }),
    ]

    expect(selectPopupNotification(rows, new Set())?.id).toBe('newest')
    expect(selectPopupNotification(rows, new Set(['newest']))?.id).toBe('older')
  })

  it('returns null when there is nothing eligible', () => {
    expect(selectPopupNotification([], new Set())).toBeNull()
    expect(
      selectPopupNotification(
        [row({ id: 'seen' }), row({ id: 'read', read: true })],
        new Set(['seen'])
      )
    ).toBeNull()
  })
})
