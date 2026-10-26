/**
 * Discussion pin rules — pure-logic regression tests.
 *
 * The database tests prove authorization and concurrency. These tests pin
 * the client-side definition of "active" so an expired row can never keep
 * a pinned badge, a limit can never show more than three pins, and merging
 * pin state never reorders the regular feed.
 */
import { describe, expect, it } from 'vitest'
import type { DiscussionPin, Post } from '@/lib/types'
import {
  MAX_ACTIVE_DISCUSSION_PINS,
  PIN_LIMIT_MESSAGE,
  PIN_PERMISSION_MESSAGE,
  applyActivePinsToPosts,
  formatPinCountdown,
  isPinActive,
  mapDiscussionPin,
  pinErrorMessage,
  selectActivePins,
} from './discussionPins'

const NOW = new Date('2026-10-23T12:00:00.000Z')

function makePin(overrides: Partial<DiscussionPin> = {}): DiscussionPin {
  return {
    id: 'pin-1',
    discussion_id: 'post-1',
    pinned_by: 'faculty-1',
    pinned_at: '2026-10-23T10:00:00.000Z',
    pin_expires_at: '2026-10-30T10:00:00.000Z',
    unpinned_at: null,
    unpinned_by: null,
    ...overrides,
  }
}

function makePost(overrides: Partial<Post> = {}): Post {
  return {
    id: 'post-1',
    author_id: 'author-1',
    type: 'discussion',
    title: 'Post title',
    body: 'Post body',
    image_url: null,
    github_url: null,
    demo_url: null,
    tech_stack: [],
    tags: [],
    target_years: [1, 2, 3, 4],
    created_at: '2026-10-20T10:00:00.000Z',
    ...overrides,
  }
}

describe('isPinActive', () => {
  it('is active before its expiry instant', () => {
    expect(isPinActive(makePin(), NOW)).toBe(true)
  })

  it('is inactive exactly at the expiry instant and after it', () => {
    expect(isPinActive(makePin({ pin_expires_at: NOW.toISOString() }), NOW)).toBe(false)
    expect(isPinActive(makePin({ pin_expires_at: '2026-10-23T11:59:59.000Z' }), NOW)).toBe(false)
  })

  it('is inactive once explicitly unpinned, even before expiry', () => {
    expect(isPinActive(makePin({ unpinned_at: '2026-10-23T11:00:00.000Z' }), NOW)).toBe(false)
  })

  it('treats an unparseable expiry as inactive', () => {
    expect(isPinActive(makePin({ pin_expires_at: 'not-a-date' }), NOW)).toBe(false)
  })
})

describe('selectActivePins', () => {
  it('excludes expired and unpinned rows', () => {
    const pins = [
      makePin({ id: 'active', discussion_id: 'post-1' }),
      makePin({
        id: 'expired',
        discussion_id: 'post-2',
        pin_expires_at: '2026-10-23T11:00:00.000Z',
      }),
      makePin({
        id: 'unpinned',
        discussion_id: 'post-3',
        unpinned_at: '2026-10-23T11:30:00.000Z',
      }),
    ]

    expect(selectActivePins(pins, NOW).map(pin => pin.id)).toEqual(['active'])
  })

  it('returns at most three pins, newest first', () => {
    const pins = Array.from({ length: 5 }, (_, index) =>
      makePin({
        id: `pin-${index}`,
        discussion_id: `post-${index}`,
        pinned_at: `2026-10-23T0${index}:00:00.000Z`,
      })
    )

    const result = selectActivePins(pins, NOW)

    expect(result).toHaveLength(MAX_ACTIVE_DISCUSSION_PINS)
    expect(result.map(pin => pin.id)).toEqual(['pin-4', 'pin-3', 'pin-2'])
  })
})

describe('applyActivePinsToPosts', () => {
  it('adds pin fields without changing the feed order', () => {
    const posts = [
      makePost({ id: 'post-2' }),
      makePost({ id: 'post-1' }),
      makePost({ id: 'post-3' }),
    ]

    const result = applyActivePinsToPosts(posts, [makePin()], NOW)

    expect(result.map(post => post.id)).toEqual(['post-2', 'post-1', 'post-3'])
    expect(result[1]).toMatchObject({
      pinned_by: 'faculty-1',
      pinned_at: '2026-10-23T10:00:00.000Z',
      pin_expires_at: '2026-10-30T10:00:00.000Z',
    })
  })

  it('clears stale pin fields for posts with no active pin', () => {
    const post = makePost({
      pinned_by: 'faculty-1',
      pinned_at: '2026-10-01T10:00:00.000Z',
      pin_expires_at: '2026-10-08T10:00:00.000Z',
    })

    const [result] = applyActivePinsToPosts([post], [], NOW)

    expect(result.pinned_by).toBeNull()
    expect(result.pinned_at).toBeNull()
    expect(result.pin_expires_at).toBeNull()
  })
})

describe('mapDiscussionPin', () => {
  it('reads the canonical post_id column and exposes it as discussion_id', () => {
    expect(
      mapDiscussionPin({
        id: 'pin-1',
        post_id: 'post-1',
        pinned_by: 'faculty-1',
        pinned_at: '2026-10-23T10:00:00.000Z',
        pin_expires_at: '2026-10-30T10:00:00.000Z',
        unpinned_at: null,
      })
    ).toMatchObject({ id: 'pin-1', discussion_id: 'post-1', unpinned_at: null })
  })

  it('still accepts the legacy discussion_id field when post_id is absent', () => {
    expect(
      mapDiscussionPin({
        id: 'pin-1',
        discussion_id: 'post-1',
        pinned_by: 'faculty-1',
        pinned_at: '2026-10-23T10:00:00.000Z',
        pin_expires_at: '2026-10-30T10:00:00.000Z',
        unpinned_at: null,
      })
    ).toMatchObject({ id: 'pin-1', discussion_id: 'post-1' })
  })

  it('rejects incomplete rows instead of inventing values', () => {
    expect(mapDiscussionPin({ id: 'pin-1' })).toBeNull()
    expect(mapDiscussionPin({})).toBeNull()
  })

  it('rejects a row with neither post_id nor discussion_id', () => {
    expect(
      mapDiscussionPin({
        id: 'pin-1',
        pinned_by: 'faculty-1',
        pinned_at: '2026-10-23T10:00:00.000Z',
        pin_expires_at: '2026-10-30T10:00:00.000Z',
        unpinned_at: null,
      })
    ).toBeNull()
  })
})

describe('formatPinCountdown', () => {
  it('renders days and hours for a multi-day pin', () => {
    const now = new Date('2026-10-23T12:00:00.000Z')
    expect(formatPinCountdown('2026-10-30T11:00:00.000Z', now)).toBe('Expires in 6d 23h')
  })

  it('renders minutes and seconds under an hour', () => {
    const now = new Date('2026-10-23T12:00:00.000Z')
    expect(formatPinCountdown('2026-10-23T12:59:12.000Z', now)).toBe('Expires in 59m 12s')
  })

  it('renders seconds only under a minute', () => {
    const now = new Date('2026-10-23T12:00:00.000Z')
    expect(formatPinCountdown('2026-10-23T12:00:42.000Z', now)).toBe('Expires in 42s')
  })

  it('reports Expired at the exact expiry instant and for an invalid date', () => {
    const now = new Date('2026-10-23T12:00:00.000Z')
    expect(formatPinCountdown(now.toISOString(), now)).toBe('Expired')
    expect(formatPinCountdown('not-a-date', now)).toBe('Expired')
  })
})

describe('pinErrorMessage', () => {
  it('returns the exact global-limit message', () => {
    expect(
      pinErrorMessage(
        'The community already has 3 active pinned discussions. Wait for a pin to expire or unpin one first.'
      )
    ).toBe(PIN_LIMIT_MESSAGE)
  })

  it('maps authorization, duplicate and expiry failures', () => {
    expect(
      pinErrorMessage('Only admins and verified faculty can pin or unpin discussions.')
    ).toBe(PIN_PERMISSION_MESSAGE)
    expect(pinErrorMessage('Only verified faculty can pin or unpin discussions.')).toBe(
      PIN_PERMISSION_MESSAGE
    )
    expect(pinErrorMessage('This discussion is already pinned.')).toMatch(/already pinned/)
    expect(pinErrorMessage('This pin has already expired.')).toMatch(/already expired/)
    expect(pinErrorMessage('This discussion is not pinned.')).toMatch(/no longer pinned/)
  })

  it('keeps an unknown database message and gives network failures a fallback', () => {
    expect(pinErrorMessage('network down')).toBe('network down')
    expect(pinErrorMessage('')).toMatch(/Could not update the pin/)
  })
})
