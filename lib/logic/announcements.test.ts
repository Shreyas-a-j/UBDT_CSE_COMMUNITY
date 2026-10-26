import { describe, it, expect } from 'vitest'
import {
  ANNOUNCEMENT_IMAGE_MAX_BYTES,
  ANNOUNCEMENT_MAX_IMAGES,
  ANNOUNCEMENT_REACTIONS,
  canDeleteAnnouncement,
  canPublishAnnouncements,
  groupAnnouncementsByDay,
  isAnnouncementReaction,
  mapAnnouncement,
  normalizeImageUrls,
  summarizeReactions,
  totalReactions,
  validateAnnouncementImage,
} from './announcements'
import type { Announcement } from '@/lib/types'

const baseAnnouncement: Announcement = {
  id: 'a1',
  author_id: 'f1',
  title: 'Deadline',
  body: 'Submit by Friday.',
  image_urls: [],
  created_at: '2026-10-22T09:00:00.000Z',
  updated_at: '2026-10-22T09:00:00.000Z',
  author_name: 'Dr Rao',
  author_avatar: null,
  author_designation: 'Professor',
  reactions: [],
}

describe('reaction set', () => {
  it('is the small fixed set the UI renders', () => {
    expect(ANNOUNCEMENT_REACTIONS.map(reaction => reaction.type)).toEqual([
      'thumbs_up',
      'heart',
      'party',
      'clap',
    ])
  })

  it('recognizes only supported reactions', () => {
    expect(isAnnouncementReaction('heart')).toBe(true)
    expect(isAnnouncementReaction('angry')).toBe(false)
    expect(isAnnouncementReaction(null)).toBe(false)
    expect(isAnnouncementReaction(1)).toBe(false)
  })
})

describe('summarizeReactions', () => {
  const rows = [
    { user_id: 'u1', reaction: 'thumbs_up' },
    { user_id: 'u2', reaction: 'thumbs_up' },
    { user_id: 'u3', reaction: 'heart' },
  ]

  it('counts every type and reports the viewer reactions', () => {
    const summary = summarizeReactions(rows, 'u2')

    expect(summary.counts).toEqual({ thumbs_up: 2, heart: 1, party: 0, clap: 0 })
    expect(summary.mine).toEqual(['thumbs_up'])
    expect(totalReactions(summary.counts)).toBe(3)
  })

  it('reports no viewer reactions for signed-out visitors', () => {
    const summary = summarizeReactions(rows, null)

    expect(summary.counts.thumbs_up).toBe(2)
    expect(summary.mine).toEqual([])
  })

  it('ignores unknown reactions and duplicate rows instead of inflating counts', () => {
    const summary = summarizeReactions(
      [
        { user_id: 'u1', reaction: 'heart' },
        { user_id: 'u1', reaction: 'heart' },
        { user_id: 'u2', reaction: 'angry' },
        { user_id: 'u3', reaction: null },
        { user_id: null, reaction: 'clap' },
      ],
      'u1'
    )

    expect(summary.counts.heart).toBe(1)
    expect(summary.counts.clap).toBe(1)
    expect(summary.counts.party).toBe(0)
    expect(summary.mine).toEqual(['heart'])
  })

  it('counts at most one reaction per user and reports only the latest one as the viewer selection', () => {
    const summary = summarizeReactions(
      [
        { user_id: 'u1', reaction: 'heart', created_at: '2026-10-20T10:00:00.000Z' },
        { user_id: 'u1', reaction: 'clap', created_at: '2026-10-21T10:00:00.000Z' },
        { user_id: 'u2', reaction: 'heart' },
      ],
      'u1'
    )

    expect(summary.counts).toEqual({ thumbs_up: 0, heart: 1, party: 0, clap: 1 })
    expect(summary.mine).toEqual(['clap'])
    expect(totalReactions(summary.counts)).toBe(2)
  })

  it('handles missing data', () => {
    expect(summarizeReactions(undefined).counts).toEqual({
      thumbs_up: 0,
      heart: 0,
      party: 0,
      clap: 0,
    })
  })
})

describe('image validation', () => {
  it('accepts the supported image types at or below the size limit', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/webp', 'image/gif']) {
      expect(validateAnnouncementImage({ type, size: 1024 })).toBeNull()
    }
    expect(
      validateAnnouncementImage({ type: 'image/png', size: ANNOUNCEMENT_IMAGE_MAX_BYTES })
    ).toBeNull()
  })

  it('rejects other types, empty files and oversized files', () => {
    expect(validateAnnouncementImage({ type: 'application/pdf', size: 1024 })).toMatch(/PNG/)
    expect(validateAnnouncementImage({ type: 'image/svg+xml', size: 1024 })).toMatch(/PNG/)
    expect(validateAnnouncementImage({ type: 'image/png', size: 0 })).toMatch(/empty/)
    expect(
      validateAnnouncementImage({ type: 'image/png', size: ANNOUNCEMENT_IMAGE_MAX_BYTES + 1 })
    ).toMatch(/5 MB/)
  })

  it('normalizes image URL lists: http(s) only, capped at four', () => {
    expect(normalizeImageUrls(['https://cdn.example.com/a.png', ' http://x.test/b.jpg '])).toEqual([
      'https://cdn.example.com/a.png',
      'http://x.test/b.jpg',
    ])
    expect(normalizeImageUrls(['javascript:alert(1)', 'not a url', 42, null])).toEqual([])
    expect(
      normalizeImageUrls([
        'https://a.test/1.png',
        'https://a.test/2.png',
        'https://a.test/3.png',
        'https://a.test/4.png',
        'https://a.test/5.png',
      ])
    ).toHaveLength(ANNOUNCEMENT_MAX_IMAGES)
    expect(normalizeImageUrls('https://a.test/1.png')).toEqual([])
  })
})

describe('mapAnnouncement', () => {
  it('maps the row, author embed, images and reactions', () => {
    const mapped = mapAnnouncement({
      id: 'a1',
      author_id: 'f1',
      title: 'Deadline',
      body: 'Submit by Friday.',
      image_urls: ['https://cdn.test/one.png'],
      created_at: '2026-10-22T09:00:00.000Z',
      updated_at: '2026-10-22T10:00:00.000Z',
      author: { name: 'Dr Rao', avatar_url: null, designation: 'Professor' },
      reactions: [
        { user_id: 'u1', reaction: 'heart' },
        { user_id: 'u1', reaction: 'heart' },
        { user_id: 'u2', reaction: 'nope' },
      ],
    })

    expect(mapped.title).toBe('Deadline')
    expect(mapped.author_name).toBe('Dr Rao')
    expect(mapped.author_designation).toBe('Professor')
    expect(mapped.image_urls).toEqual(['https://cdn.test/one.png'])
    expect(mapped.reactions).toEqual([{ user_id: 'u1', reaction: 'heart' }])
  })

  it('normalizes legacy duplicate rows to one reaction per user, keeping the latest', () => {
    const mapped = mapAnnouncement({
      id: 'a3',
      author_id: 'f1',
      title: 'Deadline',
      body: 'Submit by Friday.',
      created_at: '2026-10-22T09:00:00.000Z',
      reactions: [
        { user_id: 'u1', reaction: 'heart', created_at: '2026-10-20T10:00:00.000Z' },
        { user_id: 'u1', reaction: 'party', created_at: '2026-10-21T10:00:00.000Z' },
        { user_id: 'u2', reaction: 'clap' },
      ],
    })

    expect(mapped.reactions).toEqual([
      { user_id: 'u1', reaction: 'party', created_at: '2026-10-21T10:00:00.000Z' },
      { user_id: 'u2', reaction: 'clap' },
    ])
  })

  it('survives missing embeds and an un-migrated row', () => {
    const mapped = mapAnnouncement({
      id: 'a2',
      author_id: 'f2',
      title: 'Hello',
      body: 'World',
      created_at: '2026-10-22T09:00:00.000Z',
    })

    expect(mapped.image_urls).toEqual([])
    expect(mapped.reactions).toEqual([])
    expect(mapped.author_name).toBeUndefined()
    expect(mapped.updated_at).toBe('2026-10-22T09:00:00.000Z')
  })
})

describe('canPublishAnnouncements', () => {
  it('allows verified faculty and admins', () => {
    expect(canPublishAnnouncements({ role: 'faculty', faculty_status: 'verified' })).toBe(true)
    expect(canPublishAnnouncements({ role: 'admin', faculty_status: null })).toBe(true)
  })

  it('allows approved faculty (the live database vocabulary)', () => {
    expect(canPublishAnnouncements({ role: 'faculty', faculty_status: 'approved' })).toBe(true)
  })

  it('rejects students, alumni, pending/rejected applicants and signed-out visitors', () => {
    expect(canPublishAnnouncements({ role: 'student' })).toBe(false)
    expect(canPublishAnnouncements({ role: 'alumni' })).toBe(false)
    expect(canPublishAnnouncements({ role: 'faculty', faculty_status: 'pending' })).toBe(false)
    expect(canPublishAnnouncements({ role: 'faculty', faculty_status: 'rejected' })).toBe(false)
    // A bare claimed role is never enough.
    expect(canPublishAnnouncements({ role: 'faculty' })).toBe(false)
    expect(canPublishAnnouncements(null)).toBe(false)
    expect(canPublishAnnouncements(undefined)).toBe(false)
  })
})

describe('groupAnnouncementsByDay', () => {
  const now = new Date()
  const daysAgo = (days: number) => {
    const date = new Date(now)
    date.setDate(date.getDate() - days)
    return date.toISOString()
  }

  const make = (id: string, createdAt: string): Announcement => ({
    ...baseAnnouncement,
    id,
    created_at: createdAt,
  })

  it('groups Today, Yesterday and older days while preserving order', () => {
    const groups = groupAnnouncementsByDay(
      [make('today-1', daysAgo(0)), make('today-2', daysAgo(0)), make('yesterday', daysAgo(1)), make('older', daysAgo(5))],
      now
    )

    expect(groups.map(group => group.label)).toEqual(['Today', 'Yesterday', expect.stringMatching(/\w+,\s\w+\s\d+/)])
    expect(groups[0].announcements.map(a => a.id)).toEqual(['today-1', 'today-2'])
    expect(groups[1].announcements.map(a => a.id)).toEqual(['yesterday'])
    expect(groups[2].announcements.map(a => a.id)).toEqual(['older'])
  })

  it('puts an unparseable timestamp in an "Earlier" group instead of throwing', () => {
    const groups = groupAnnouncementsByDay([make('broken', 'not-a-date')], now)

    expect(groups).toHaveLength(1)
    expect(groups[0].label).toBe('Earlier')
    expect(groups[0].key).toBe('unknown')
  })

  it('returns no groups for no announcements', () => {
    expect(groupAnnouncementsByDay([], now)).toEqual([])
  })
})

describe('canDeleteAnnouncement', () => {
  const authorId = 'faculty-1'

  it('allows the author', () => {
    expect(canDeleteAnnouncement({ id: 'faculty-1', role: 'faculty' }, authorId)).toBe(true)
  })

  it('allows an admin who is not the author', () => {
    expect(canDeleteAnnouncement({ id: 'admin-1', role: 'admin' }, authorId)).toBe(true)
  })

  it('rejects another student or faculty member', () => {
    expect(canDeleteAnnouncement({ id: 'student-1', role: 'student' }, authorId)).toBe(false)
    expect(canDeleteAnnouncement({ id: 'faculty-2', role: 'faculty' }, authorId)).toBe(false)
  })

  it('rejects a signed-out viewer', () => {
    expect(canDeleteAnnouncement(null, authorId)).toBe(false)
    expect(canDeleteAnnouncement(undefined, authorId)).toBe(false)
    expect(canDeleteAnnouncement({ role: 'admin' }, authorId)).toBe(false)
  })
})
