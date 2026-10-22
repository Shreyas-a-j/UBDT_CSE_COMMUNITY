import type { MemberType, Profile } from '@/lib/types'
import { isApprovedFaculty } from '@/lib/profile'

/**
 * The People directory uses one control for every category. Faculty and alumni
 * are intentionally not student-year buckets: an alumnus keeps their
 * graduation year in `graduation_year`, and `profiles.year` may still hold a
 * legacy batch value, so alumni must never leak into the 1st–4th Year filters.
 */
export type DirectoryFilter = 'all' | 'faculty' | 'alumni' | '1' | '2' | '3' | '4'

export interface DirectoryFilterOption {
  value: DirectoryFilter
  label: string
}

export const DIRECTORY_FILTERS: readonly DirectoryFilterOption[] = [
  { value: 'all', label: 'All Years' },
  { value: 'faculty', label: 'Faculty' },
  { value: 'alumni', label: 'Alumni' },
  { value: '1', label: '1st Year' },
  { value: '2', label: '2nd Year' },
  { value: '3', label: '3rd Year' },
  { value: '4', label: '4th Year' },
]

/**
 * Maps the `?filter=` query value to a known directory filter. Unknown or
 * missing values fall back to 'all' so a hand-edited URL cannot produce a
 * blank directory.
 */
export function parseDirectoryFilter(value: string | null | undefined): DirectoryFilter {
  const match = DIRECTORY_FILTERS.find(option => option.value === value)
  return match ? match.value : 'all'
}

export type DirectoryGroup = MemberType

type DirectoryMember = Pick<Profile, 'role' | 'member_type' | 'year' | 'faculty_status'>

/**
 * Classify a profile for the directory.
 *
 * The authorisation role wins over community identity: a faculty/admin row
 * must never be shown as a student just because `member_type` is NULL, stale,
 * or inconsistent. Only after that do we trust `member_type = 'alumni'`.
 * Rows that predate `member_type` therefore fall back to `role` safely.
 */
export function directoryGroup(profile: DirectoryMember): DirectoryGroup {
  if (profile.role === 'faculty' || profile.role === 'admin') return 'faculty'
  if (profile.member_type === 'faculty') return 'faculty'
  if (profile.member_type === 'alumni') return 'alumni'
  return 'student'
}

export function matchesDirectoryFilter(
  profile: DirectoryMember,
  filter: DirectoryFilter,
): boolean {
  if (filter === 'all') return true

  // The faculty directory is an approval-gated view. `member_type` is a
  // community label, not authorisation: a legacy or self-declared
  // member_type='faculty' student must not appear here. Admins are approved
  // by definition; faculty need role='faculty' plus an approved status.
  if (filter === 'faculty') return isApprovedFaculty(profile)

  const group = directoryGroup(profile)
  if (filter === 'alumni') return group === 'alumni'

  // Every remaining filter is a student academic year. Alumni and faculty are
  // excluded even if a legacy row still carries a numeric `year`.
  const year = Number(filter)
  return group === 'student' && Number(profile.year) === year
}

export function filterDirectoryPeople<T extends DirectoryMember>(
  people: readonly T[],
  filter: DirectoryFilter,
): T[] {
  return people.filter(person => matchesDirectoryFilter(person, filter))
}
