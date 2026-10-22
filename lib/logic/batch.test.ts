/**
 * Batch attribution rules (UCC 2.0 Phase 6)
 *
 * Regression coverage for the bug this phase fixes: the old predicate treated
 * the default `target_years = [1,2,3,4]` as "matches every batch" and let
 * posts with an unknown author year skip the check entirely, so selecting a
 * batch never removed a single post.
 */
import { describe, it, expect } from 'vitest'
import {
  ALL_BATCHES,
  batchOfYear,
  deliberateAudience,
  eventAttribution,
  filterEventsByBatch,
  filterPostsByBatch,
  matchesBatch,
  normalizeBatch,
  postAttribution,
} from './batch'

describe('normalizeBatch', () => {
  it('keeps the four real batches and All batches', () => {
    expect(normalizeBatch(0)).toBe(0)
    expect(normalizeBatch(1)).toBe(1)
    expect(normalizeBatch(2)).toBe(2)
    expect(normalizeBatch(3)).toBe(3)
    expect(normalizeBatch(4)).toBe(4)
  })

  it('falls back to All batches for anything invalid instead of blanking the feed', () => {
    for (const value of [Number.NaN, -1, 5, 3.5, null, undefined, '', 'abc', {}, [], Infinity]) {
      expect(normalizeBatch(value)).toBe(ALL_BATCHES)
    }
  })

  it('accepts numeric strings from a <select>', () => {
    expect(normalizeBatch('3')).toBe(3)
  })
})

describe('batchOfYear', () => {
  it('reads a valid profile year', () => {
    expect(batchOfYear(2)).toBe(2)
    expect(batchOfYear('4')).toBe(4)
  })

  it('treats missing or malformed years as "no batch" rather than inventing one', () => {
    for (const value of [null, undefined, '', 'CSE', 0, 9, -3, Number.NaN]) {
      expect(batchOfYear(value)).toBeNull()
    }
  })
})

describe('deliberateAudience', () => {
  it('treats the default all-batches list as no signal', () => {
    expect(deliberateAudience([1, 2, 3, 4])).toBeNull()
    expect(deliberateAudience([4, 3, 2, 1, 1])).toBeNull()
    expect(deliberateAudience([])).toBeNull()
    expect(deliberateAudience(null)).toBeNull()
    expect(deliberateAudience(undefined)).toBeNull()
  })

  it('returns a narrowed, deduplicated and sorted audience', () => {
    expect(deliberateAudience([3, 1, 3])).toEqual([1, 3])
    expect(deliberateAudience([2])).toEqual([2])
  })

  it('ignores out-of-range entries', () => {
    expect(deliberateAudience([1, 9, null as unknown as number])).toEqual([1])
  })
})

describe('matchesBatch', () => {
  const allBatches = { authorBatch: 2, targetYears: [1, 2, 3, 4] }

  it('matches everything for All batches', () => {
    for (const authorBatch of [1, 2, 3, 4, null]) {
      expect(matchesBatch({ authorBatch, targetYears: [1, 2, 3, 4] }, 0)).toBe(true)
    }
  })

  it("filters by the author's batch even though target_years is the all-batches default", () => {
    // The old rule kept this post in every batch because target_years listed
    // all four years. It must now match only the author's own batch.
    expect(matchesBatch(allBatches, 2)).toBe(true)
    expect(matchesBatch(allBatches, 1)).toBe(false)
    expect(matchesBatch(allBatches, 3)).toBe(false)
    expect(matchesBatch(allBatches, 4)).toBe(false)
  })

  it('honors a deliberately narrowed audience across batches', () => {
    const targeted = { authorBatch: 4, targetYears: [1] }

    expect(matchesBatch(targeted, 4)).toBe(true) // the author's own batch
    expect(matchesBatch(targeted, 1)).toBe(true) // explicitly aimed at 1st years
    expect(matchesBatch(targeted, 2)).toBe(false)
  })

  it('keeps batch-agnostic content visible without inventing a batch', () => {
    // Faculty/alumni/legacy profiles have no year. Their posts are not
    // evidence of any batch, so they stay visible in every batch view.
    const facultyPost = { authorBatch: null, targetYears: [1, 2, 3, 4] }
    for (const batch of [1, 2, 3, 4] as const) {
      expect(matchesBatch(facultyPost, batch)).toBe(true)
    }
  })

  it('honors a narrowed audience when the author has no batch of their own', () => {
    const facultyTargeted = { authorBatch: null, targetYears: [3] }

    expect(matchesBatch(facultyTargeted, 3)).toBe(true)
    expect(matchesBatch(facultyTargeted, 1)).toBe(false)
  })

  it('treats a malformed author year as batch-agnostic instead of failing the filter', () => {
    const broken = { authorBatch: Number.NaN, targetYears: [1, 2, 3, 4] }
    expect(matchesBatch(broken, 3)).toBe(true)
  })

  it('treats an invalid selected batch as All batches', () => {
    expect(matchesBatch(allBatches, Number.NaN as never)).toBe(true)
  })
})

describe('attribution adapters', () => {
  it('maps a post and an event onto the shared shape', () => {
    expect(postAttribution({ author_year: 2, target_years: [1, 2, 3, 4] })).toEqual({
      authorBatch: 2,
      targetYears: [1, 2, 3, 4],
    })
    expect(eventAttribution({ host_year: 3, target_years: [3] })).toEqual({
      authorBatch: 3,
      targetYears: [3],
    })
    expect(eventAttribution({})).toEqual({ authorBatch: null, targetYears: null })
  })
})

describe('filter helpers', () => {
  const posts = [
    { id: 'y1', author_year: 1, target_years: [1, 2, 3, 4] },
    { id: 'y2', author_year: 2, target_years: [1, 2, 3, 4] },
    { id: 'y3', author_year: 3, target_years: [1, 2, 3, 4] },
    { id: 'faculty', author_year: null, target_years: [1, 2, 3, 4] },
  ]

  it('filters posts to the selected batch plus batch-agnostic content', () => {
    expect(filterPostsByBatch(posts, 3).map(post => post.id)).toEqual(['y3', 'faculty'])
  })

  it('restores the complete feed for All batches', () => {
    expect(filterPostsByBatch(posts, 0)).toHaveLength(posts.length)
  })

  it('does not mutate the input list', () => {
    const snapshot = [...posts]
    filterPostsByBatch(posts, 2)
    expect(posts).toEqual(snapshot)
  })

  it('filters events by host batch', () => {
    const events = [
      { id: 'e2', host_year: 2, target_years: [1, 2, 3, 4] },
      { id: 'e4', host_year: 4, target_years: [1, 2, 3, 4] },
      { id: 'staff', host_year: null, target_years: [1, 2, 3, 4] },
    ]

    expect(filterEventsByBatch(events, 4).map(event => event.id)).toEqual(['e4', 'staff'])
  })
})
