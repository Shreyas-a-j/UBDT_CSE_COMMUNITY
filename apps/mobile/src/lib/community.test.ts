import { describe, expect, it } from 'vitest';
import { mapComment, mapEvent, mapPost } from './community';

/**
 * Identity mapping is the mobile equivalent of the web CommunityContext
 * mappers. `profiles.member_type` is the source of truth; the authorisation
 * role always wins, and graduation_year only decorates the label.
 */

const BASE_POST = {
  id: 'post-1',
  author_id: 'author-1',
  type: 'discussion',
  title: 'Rust resources',
  body: 'Sharing notes.',
  target_years: [1, 2, 3, 4],
  created_at: '2026-10-19T10:00:00.000Z',
};

const BASE_EVENT = {
  id: 'event-1',
  host_id: 'host-1',
  title: 'Systems workshop',
  description: 'Hands-on.',
  type: 'Workshop',
  event_date: '2099-10-24',
  event_time: '18:00',
  duration: 60,
  target_years: [1, 2, 3, 4],
  created_at: '2026-10-01T00:00:00.000Z',
};

describe('mapPost alumni identity', () => {
  it('carries a persisted alumni author and graduation year through', () => {
    const post = mapPost({
      ...BASE_POST,
      author: {
        id: 'author-1',
        name: 'Asha Rao',
        usn: null,
        role: 'student',
        member_type: 'alumni',
        graduation_year: 2024,
      },
    });

    expect(post.author_member_type).toBe('alumni');
    expect(post.author_graduation_year).toBe(2024);
  });

  it('does not turn a student with a graduation year into an alumnus', () => {
    const post = mapPost({
      ...BASE_POST,
      author: {
        id: 'author-1',
        name: 'Current Student',
        role: 'student',
        member_type: 'student',
        graduation_year: 2028,
      },
    });

    expect(post.author_member_type).toBe('student');
    // Preserved for display only; the badge gates on member_type.
    expect(post.author_graduation_year).toBe(2028);
  });

  it('keeps faculty precedence over a stale alumni value', () => {
    const post = mapPost({
      ...BASE_POST,
      author: {
        id: 'author-1',
        name: 'Dr Rao',
        role: 'faculty',
        member_type: 'alumni',
        graduation_year: 2018,
      },
    });

    expect(post.author_member_type).toBe('faculty');
    expect(post.author_graduation_year).toBe(2018);
  });

  it('treats a legacy author row without member_type as a student', () => {
    const post = mapPost({
      ...BASE_POST,
      author: {
        id: 'author-1',
        name: 'Legacy Member',
        role: 'student',
        graduation_year: 2024,
      },
    });

    expect(post.author_member_type).toBe('student');
  });

  it('accepts the embedded profile under the profiles key', () => {
    const post = mapPost({
      ...BASE_POST,
      profiles: {
        id: 'author-1',
        name: 'Asha Rao',
        role: 'student',
        member_type: 'alumni',
        graduation_year: '2022',
      },
    });

    expect(post.author_member_type).toBe('alumni');
    expect(post.author_graduation_year).toBe(2022);
  });
});

describe('mapComment alumni identity', () => {
  it('maps an alumni reply author', () => {
    const comment = mapComment({
      id: 'comment-1',
      post_id: 'post-1',
      author_id: 'author-2',
      body: 'A reply',
      parent_id: null,
      created_at: '2026-10-25T10:00:00.000Z',
      author: {
        id: 'author-2',
        name: 'Asha Rao',
        role: 'student',
        member_type: 'alumni',
        graduation_year: 2022,
      },
    });

    expect(comment.author_member_type).toBe('alumni');
    expect(comment.author_graduation_year).toBe(2022);
    expect(comment.author_name).toBe('Asha Rao');
  });

  it('defaults legacy comment authors to student', () => {
    const comment = mapComment({
      id: 'comment-2',
      post_id: 'post-1',
      author_id: 'author-3',
      body: 'Old reply',
      parent_id: null,
      created_at: '2026-10-25T10:00:00.000Z',
      author: { id: 'author-3', name: 'Legacy Member', role: 'student' },
    });

    expect(comment.author_member_type).toBe('student');
    expect(comment.author_graduation_year).toBeNull();
  });
});

describe('mapEvent host alumni identity', () => {
  it('carries a persisted alumni host through', () => {
    const event = mapEvent({
      ...BASE_EVENT,
      host: {
        id: 'host-1',
        name: 'Asha Rao',
        role: 'student',
        member_type: 'alumni',
        graduation_year: 2023,
      },
    });

    expect(event.host_member_type).toBe('alumni');
    expect(event.host_graduation_year).toBe(2023);
  });

  it('keeps faculty precedence on the host', () => {
    const event = mapEvent({
      ...BASE_EVENT,
      host: {
        id: 'host-1',
        name: 'Dr Rao',
        role: 'faculty',
        member_type: 'alumni',
        graduation_year: 2018,
      },
    });

    expect(event.host_member_type).toBe('faculty');
  });
});
