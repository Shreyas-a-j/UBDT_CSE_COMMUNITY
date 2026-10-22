/**
 * Popular / Trending showcase ranking (UCC 2.0 Phase 5, final spec)
 *
 * One shared rule set backs both the feed's labeled "Popular" section and
 * the sidebar's "Trending posts" section, so the two can never disagree:
 *
 *   eligibility = Project Showcase posts with at least one upvote
 *   order       = upvote_count desc → created_at desc (newer first) → id asc
 *   cap         = always at most two results
 *
 * Why this shape:
 * - Upvotes are the genuine engagement signal for showcases: a showcase
 *   card collects upvotes and a discussion card collects likes, each stored
 *   as one row per user/post pair, so one action can contribute at most one
 *   upvote and nothing is double-counted. No synthetic popularity score or
 *   fabricated metric is involved — ranking is the raw upvote count.
 * - Discussions are never eligible and never fill leftover slots: if fewer
 *   than two (even zero) projects qualify, that many are returned.
 * - Missing, null, negative, or non-numeric upvote counts are treated as 0,
 *   so badly shaped data can never throw and simply does not qualify.
 * - A project whose timestamp cannot be parsed stays eligible (upvotes are
 *   the actual ranking signal) but counts as the oldest instant, so it
 *   loses recency ties deterministically instead of disappearing.
 * - The comparator is a total order (upvotes, then time, then id), so the
 *   same data always produces the same list regardless of input order.
 */

export interface ShowcaseCandidate {
  id: string
  type?: string
  upvote_count?: number | null
  created_at: string
}

const MAX_POPULAR_SHOWCASES = 2

function asUpvotes(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return value > 0 ? value : 0
}

function createdAtMs(post: ShowcaseCandidate): number {
  const parsed = Date.parse(post.created_at)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * Returns up to two eligible Project Showcase posts ordered by upvote count
 * (desc), newest first on equal counts, then id ascending. The input array
 * is never mutated.
 */
export function rankPopularShowcases<T extends ShowcaseCandidate>(posts: T[]): T[] {
  const eligible = posts.filter(
    post => post.type === 'showcase' && asUpvotes(post.upvote_count) > 0
  )

  return eligible.sort((a, b) => {
    const upvotesA = asUpvotes(a.upvote_count)
    const upvotesB = asUpvotes(b.upvote_count)
    if (upvotesB !== upvotesA) return upvotesB - upvotesA
    const timeA = createdAtMs(a)
    const timeB = createdAtMs(b)
    if (timeB !== timeA) return timeB - timeA
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  }).slice(0, MAX_POPULAR_SHOWCASES)
}
