/**
 * Batch (academic year) attribution rules — UCC 2.0 Phase 6
 *
 * One rule set backs every batch-filtered surface in the product: the feed's
 * Popular and Latest sections, the sidebar's Trending and Upcoming-events
 * widgets, and the per-batch counters in the community sidebar. Keeping a
 * single derivation is what makes "select a batch" mean the same thing
 * everywhere.
 *
 * Why the author's batch decides:
 *
 * 1. `posts.target_years` is the *audience* a post was aimed at, but its
 *    database default is `'{1,2,3,4}'` and the composer always writes
 *    `[1, 2, 3, 4]`. Treating "the audience includes this batch" as a match
 *    therefore matched *every* post in *every* batch — the original filter
 *    never removed anything. The audience may only widen a post's reach when
 *    it is a deliberate narrowing (a strict subset of the four batches), which
 *    is what a human-targeted row looks like.
 * 2. `profiles.year` is real, member-owned data set at sign-up. That is the
 *    only batch signal that cannot silently mean "all batches".
 * 3. Members without a batch (faculty, admins, alumni, legacy rows with no
 *    year) are never assigned one. Their content is batch-agnostic: it stays
 *    visible in every batch view, unless they deliberately narrowed the
 *    audience to specific batches, in which case that audience is honored
 *    because it is the only batch signal available.
 *
 * Invalid or missing selections normalize to All batches (0), so a corrupted
 * value can never blank the feed.
 */
import type { YearFilter } from '@/lib/types'

/** The unfiltered view. Mirrors the `YearFilter` union in lib/types.ts. */
export const ALL_BATCHES = 0 satisfies YearFilter

/** Every batch a member or a piece of content can belong to. */
export const BATCH_YEARS = [1, 2, 3, 4] as const

export type BatchYear = (typeof BATCH_YEARS)[number]

/** Everything needed to decide which batch a piece of content belongs to. */
export interface BatchAttribution {
  /** The author's batch (`profiles.year`), or null when the member has none. */
  authorBatch: number | null
  /** The audience the content was aimed at, or null/undefined when unset. */
  targetYears: number[] | null | undefined
}

function isBatchYear(value: unknown): value is BatchYear {
  return typeof value === 'number' && (BATCH_YEARS as readonly number[]).includes(value)
}

/**
 * Coerces anything into a valid filter value. `0` (All batches) is the safe
 * fallback: NaN, out-of-range numbers, null, blank strings and junk all mean
 * "show everything" rather than "show nothing".
 */
export function normalizeBatch(value: unknown): YearFilter {
  const numeric =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim().length > 0
        ? Number(value)
        : Number.NaN

  return isBatchYear(numeric) ? numeric : ALL_BATCHES
}

/**
 * Reads a member's batch from a database value. Missing, malformed and
 * out-of-range years are "no batch" — never a guessed one.
 */
export function batchOfYear(value: unknown): BatchYear | null {
  const numeric = typeof value === 'string' && value.trim().length > 0 ? Number(value) : value
  return isBatchYear(numeric) ? numeric : null
}

/**
 * Returns the deliberately targeted batches, or null when the audience is
 * unset, malformed, or the default "every batch" list. A post or event aimed
 * at all four batches carries no batch signal and must not widen a match.
 */
export function deliberateAudience(targetYears: number[] | null | undefined): BatchYear[] | null {
  if (!Array.isArray(targetYears)) return null

  const unique = Array.from(
    new Set(targetYears.filter((year): year is BatchYear => isBatchYear(year)))
  ).sort((a, b) => a - b)

  if (unique.length === 0 || unique.length >= BATCH_YEARS.length) return null
  return unique
}

/**
 * The single batch-membership rule.
 *
 * - All batches (`0`) matches everything.
 * - A known author batch matches that batch, plus any batch the author
 *   deliberately narrowed the audience to.
 * - An author with no batch contributes no batch signal: a deliberate
 *   audience is honored, otherwise the content is batch-agnostic and stays
 *   visible in every batch view.
 */
export function matchesBatch(attribution: BatchAttribution, batch: YearFilter): boolean {
  const selected = normalizeBatch(batch)
  if (selected === ALL_BATCHES) return true

  const authorBatch = batchOfYear(attribution.authorBatch)
  const audience = deliberateAudience(attribution.targetYears)

  if (authorBatch === null) {
    return audience === null ? true : audience.includes(selected)
  }

  if (authorBatch === selected) return true
  return audience !== null && audience.includes(selected)
}

export function postAttribution(post: {
  author_year?: number | null
  target_years?: number[] | null
}): BatchAttribution {
  return { authorBatch: post.author_year ?? null, targetYears: post.target_years ?? null }
}

export function eventAttribution(event: {
  host_year?: number | null
  target_years?: number[] | null
}): BatchAttribution {
  return { authorBatch: event.host_year ?? null, targetYears: event.target_years ?? null }
}

/** Filters any attributed list; returns a new array (the input is untouched). */
export function filterByBatch<T>(
  items: T[],
  batch: YearFilter,
  attributionOf: (item: T) => BatchAttribution
): T[] {
  return items.filter(item => matchesBatch(attributionOf(item), batch))
}

export function filterPostsByBatch<T extends { author_year?: number | null; target_years?: number[] | null }>(
  posts: T[],
  batch: YearFilter
): T[] {
  return filterByBatch(posts, batch, postAttribution)
}

export function filterEventsByBatch<T extends { host_year?: number | null; target_years?: number[] | null }>(
  events: T[],
  batch: YearFilter
): T[] {
  return filterByBatch(events, batch, eventAttribution)
}
