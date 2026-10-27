import { describe, expect, it } from 'vitest'
import { mapComment, mapEvent, mapPost } from './CommunityContext'

function postRow(author: Record<string, unknown> | null) {
  return {
    id: 'post-1',
    author_id: 'author-1',
    type: 'discussion',
    title: 'Hello',
    body: 'A discussion',
    image_url: null,
    github_url: null,
    demo_url: null,
    tech_stack: [],
    tags: [],
    target_years: [1, 2, 3, 4],
    created_at: '2026-10-25T10:00:00.000Z',
    author,
    likes: [{ count: 0 }],
    comments: [{ count: 0 }],
    upvotes: [{ count: 0 }],
  }
}

describe('community author identity mapping', () => {
  it('preserves persisted alumni identity from the joined profile', () => {
    const post = mapPost(postRow({
      name: 'Asha Rao',
      usn: null,
      avatar_url: null,
      year: null,
      role: 'student',
      member_type: 'alumni',
      graduation_year: 2024,
    }))

    expect(post.author_member_type).toBe('alumni')
    expect(post.author_graduation_year).toBe(2024)
  })

  it('does not infer alumni from a graduation year on a student row', () => {
    const post = mapPost(postRow({
      name: 'Current Student',
      usn: '4UB24CS001',
      avatar_url: null,
      year: 3,
      role: 'student',
      member_type: 'student',
      graduation_year: 2028,
    }))

    expect(post.author_member_type).toBe('student')
  })

  it('keeps faculty precedence over a stale alumni member type', () => {
    const post = mapPost(postRow({
      name: 'Dr. Faculty',
      usn: null,
      avatar_url: null,
      year: null,
      role: 'faculty',
      member_type: 'alumni',
      graduation_year: 2018,
    }))

    expect(post.author_member_type).toBe('faculty')
  })

  it('maps persisted alumni identity on comment authors', () => {
    const comment = mapComment({
      id: 'comment-1',
      post_id: 'post-1',
      author_id: 'author-1',
      body: 'A reply',
      parent_id: null,
      created_at: '2026-10-25T10:00:00.000Z',
      author: {
        name: 'Asha Rao',
        usn: null,
        avatar_url: null,
        year: null,
        role: 'student',
        member_type: 'alumni',
        graduation_year: 2022,
      },
    })

    expect(comment.author_member_type).toBe('alumni')
    expect(comment.author_graduation_year).toBe(2022)
  })

  it('maps persisted alumni identity on event hosts', () => {
    const event = mapEvent({
      id: 'event-1',
      host_id: 'author-1',
      title: 'Alumni meetup',
      description: 'Welcome back',
      type: 'Meeting',
      event_date: '2026-11-01',
      event_time: '18:00',
      duration: 60,
      link: null,
      target_years: [1, 2, 3, 4],
      created_at: '2026-10-25T10:00:00.000Z',
      host: {
        name: 'Asha Rao',
        usn: null,
        avatar_url: null,
        year: null,
        role: 'student',
        member_type: 'alumni',
        graduation_year: 2022,
      },
      event_rsvps: [{ count: 0 }],
    })

    expect(event.host_member_type).toBe('alumni')
    expect(event.host_graduation_year).toBe(2022)
  })
})
