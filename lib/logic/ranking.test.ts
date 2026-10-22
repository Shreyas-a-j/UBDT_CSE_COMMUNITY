/**
 * Popular / Trending showcase ranking tests (UCC 2.0 Phase 5, final spec)
 *
 * Covers the shared rule in lib/logic/ranking.ts, used by both the feed's
 * "Popular" section and the sidebar's "Trending posts" section:
 *   - eligibility: Project Showcase posts with at least one upvote only;
 *     discussions are never eligible and never fill leftover slots
 *   - missing/null/negative/non-numeric upvote data treated as 0, no throws
 *   - ranking by actual upvote count, highest first
 *   - deterministic tie-breaking: newer project first, then id ascending
 *   - hard cap of two results; fewer when fewer qualify
 *   - unparseable timestamps stay eligible but lose recency ties
 *   - input array never mutated
 *
 * All instants are written with explicit UTC offsets so the tests are
 * deterministic regardless of the machine timezone the suite runs in.
 */
import { describe, it, expect } from 'vitest'
import { rankPopularShowcases } from './ranking'

function showcase(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    type: 'showcase',
    upvote_count: 1,
    created_at: '2026-10-21T12:00:00Z',
    ...overrides,
  }
}

describe('rankPopularShowcases', () => {
  it('ranks eligible projects by upvote count, highest first', () => {
    const low = showcase({ id: 'low', upvote_count: 2 })
    const high = showcase({ id: 'high', upvote_count: 9 })

    // Input order is low→high; ranking must invert it by upvotes.
    expect(rankPopularShowcases([low, high]).map(p => p.id)).toEqual(['high', 'low'])
  })

  it('excludes projects with no upvotes', () => {
    const quiet = showcase({ id: 'quiet', upvote_count: 0 })
    const liked = showcase({ id: 'liked', upvote_count: 1 })

    expect(rankPopularShowcases([quiet, liked]).map(p => p.id)).toEqual(['liked'])
  })

  it('never includes ordinary discussion posts, even ones with engagement', () => {
    const discussion = showcase({
      id: 'disc',
      type: 'discussion',
      upvote_count: 99,
      like_count: 12,
    })
    const untitled = { id: 'mystery', upvote_count: 5, created_at: '2026-10-21T12:00:00Z' }
    const project = showcase({ id: 'project', upvote_count: 1 })

    const ranked = rankPopularShowcases([
      discussion,
      untitled as unknown as ReturnType<typeof showcase>,
      project,
    ])
    expect(ranked.map(p => p.id)).toEqual(['project'])
  })

  it('treats missing, null, negative, or non-numeric upvote counts as zero without throwing', () => {
    const missing = { id: 'missing', type: 'showcase', created_at: '2026-10-21T12:00:00Z' }
    const nullish = showcase({ id: 'nullish', upvote_count: null })
    const negative = showcase({ id: 'negative', upvote_count: -4 })
    const broken = showcase({ id: 'broken', upvote_count: Number.NaN })
    const valid = showcase({ id: 'valid', upvote_count: 3 })

    let ranked: Array<{ id: string }> = []
    expect(() => {
      ranked = rankPopularShowcases([
        missing,
        nullish,
        negative,
        broken,
        valid,
      ] as unknown as Array<ReturnType<typeof showcase>>)
    }).not.toThrow()
    expect(ranked.map(p => p.id)).toEqual(['valid'])
  })

  it('breaks upvote ties deterministically: newer project first', () => {
    const older = showcase({ id: 'older', upvote_count: 4, created_at: '2026-10-19T12:00:00Z' })
    const newer = showcase({ id: 'newer', upvote_count: 4, created_at: '2026-10-21T12:00:00Z' })

    expect(rankPopularShowcases([older, newer]).map(p => p.id)).toEqual(['newer', 'older'])
  })

  it('breaks full ties by id ascending, independent of input order', () => {
    const a = showcase({ id: 'aaa', upvote_count: 4, created_at: '2026-10-21T12:00:00Z' })
    const b = showcase({ id: 'bbb', upvote_count: 4, created_at: '2026-10-21T12:00:00Z' })

    expect(rankPopularShowcases([a, b]).map(p => p.id)).toEqual(['aaa', 'bbb'])
    expect(rankPopularShowcases([b, a]).map(p => p.id)).toEqual(['aaa', 'bbb'])
    expect(rankPopularShowcases([b, a])).toEqual(rankPopularShowcases([b, a]))
  })

  it('returns at most two projects', () => {
    const posts = [1, 2, 3, 4].map(n =>
      showcase({ id: `p-${n}`, upvote_count: n })
    )

    expect(rankPopularShowcases(posts).map(p => p.id)).toEqual(['p-4', 'p-3'])
  })

  it('returns fewer than two when fewer qualify', () => {
    const only = showcase({ id: 'only', upvote_count: 7 })

    expect(rankPopularShowcases([only]).map(p => p.id)).toEqual(['only'])
  })

  it('returns an empty list when nothing qualifies', () => {
    const quiet = showcase({ id: 'quiet', upvote_count: 0 })
    const discussion = showcase({ id: 'disc', type: 'discussion', upvote_count: 8 })

    expect(rankPopularShowcases([quiet, discussion])).toEqual([])
    expect(rankPopularShowcases([])).toEqual([])
  })

  it('keeps projects with unparseable timestamps eligible, ranked by upvotes first', () => {
    const stale = showcase({ id: 'stale', upvote_count: 9, created_at: 'not-a-date' })
    const fresh = showcase({ id: 'fresh', upvote_count: 1 })

    expect(rankPopularShowcases([fresh, stale]).map(p => p.id)).toEqual(['stale', 'fresh'])
  })

  it('treats unparseable timestamps as oldest when upvotes tie', () => {
    const broken = showcase({ id: 'broken', upvote_count: 4, created_at: 'not-a-date' })
    const valid = showcase({ id: 'valid', upvote_count: 4, created_at: '2026-10-21T12:00:00Z' })

    expect(rankPopularShowcases([broken, valid]).map(p => p.id)).toEqual(['valid', 'broken'])
  })

  it('does not mutate the input array', () => {
    const input = [
      showcase({ id: 'low', upvote_count: 1 }),
      showcase({ id: 'high', upvote_count: 9 }),
    ]
    const snapshot = [...input]

    rankPopularShowcases(input)
    expect(input).toEqual(snapshot)
  })
})
