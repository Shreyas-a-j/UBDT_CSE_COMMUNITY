/**
 * People-directory classification ported from the website's `lib/directory.ts`.
 *
 * The authorisation role wins over community identity so a faculty/admin row
 * can never appear as a student, and alumni never leak into 1st–4th year
 * buckets just because a legacy row still carries `year`.
 */

import { isApprovedFaculty } from './profile';
import type { MemberType, Profile } from './types';

export type DirectoryFilter = 'all' | 'faculty' | 'alumni' | '1' | '2' | '3' | '4';

export const DIRECTORY_FILTERS: readonly { value: DirectoryFilter; label: string }[] = [
  { value: 'all', label: 'All years' },
  { value: 'faculty', label: 'Faculty' },
  { value: 'alumni', label: 'Alumni' },
  { value: '1', label: '1st year' },
  { value: '2', label: '2nd year' },
  { value: '3', label: '3rd year' },
  { value: '4', label: '4th year' },
];

type DirectoryMember = Pick<Profile, 'role' | 'member_type' | 'year' | 'faculty_status'>;

export function directoryGroup(profile: DirectoryMember): MemberType {
  if (profile.role === 'faculty' || profile.role === 'admin') return 'faculty';
  if (profile.member_type === 'faculty') return 'faculty';
  if (profile.member_type === 'alumni') return 'alumni';
  return 'student';
}

export function matchesDirectoryFilter(
  profile: DirectoryMember,
  filter: DirectoryFilter
): boolean {
  if (filter === 'all') return true;

  // Faculty is an approval-gated view. A self-declared member_type alone is
  // not authorisation.
  if (filter === 'faculty') return isApprovedFaculty(profile);

  const group = directoryGroup(profile);
  if (filter === 'alumni') return group === 'alumni';

  const year = Number(filter);
  return group === 'student' && Number(profile.year) === year;
}

/* ---------------------------- website parity ----------------------------- */

/**
 * The website's explicit profile projection. Selecting columns keeps the
 * directory from widening the public profile surface; the fallback below
 * supports deployments that predate `member_type` / `graduation_year`.
 */
export const PEOPLE_COLUMNS =
  'id, usn, name, year, branch, section, bio, avatar_url, skills, interests, role, faculty_status, designation, member_type, graduation_year, created_at';

export const PEOPLE_FALLBACK_COLUMNS =
  'id, usn, name, year, branch, section, bio, avatar_url, skills, interests, role, faculty_status, designation, created_at';

export interface PeopleFilterInput {
  query: string;
  /** Separate skill/interest control, matching the website. */
  skill: string;
  directoryFilter: DirectoryFilter;
  viewerId?: string | null;
}

/**
 * Website filter semantics:
 *  - Exclude the viewer.
 *  - Search only name, USN and bio.
 *  - Match the skill control against skills *or* interests.
 *  - Apply the role/year directory filter.
 *  - Preserve the server's `created_at` descending order.
 */
export function filterPeople<T extends Pick<Profile, 'id' | 'name' | 'usn' | 'bio' | 'skills' | 'interests'> & DirectoryMember>(
  people: readonly T[],
  input: PeopleFilterInput
): T[] {
  const query = input.query.trim().toLowerCase();
  const skill = input.skill.trim().toLowerCase();

  return people.filter((person) => {
    if (input.viewerId && person.id === input.viewerId) return false;
    if (!matchesDirectoryFilter(person, input.directoryFilter)) return false;

    if (query) {
      const matchesSearch =
        person.name.toLowerCase().includes(query) ||
        (person.usn ?? '').toLowerCase().includes(query) ||
        (person.bio ?? '').toLowerCase().includes(query);
      if (!matchesSearch) return false;
    }

    if (skill) {
      const matchesSkill =
        person.skills.some((value) => value.toLowerCase().includes(skill)) ||
        person.interests.some((value) => value.toLowerCase().includes(skill));
      if (!matchesSkill) return false;
    }

    return true;
  });
}
