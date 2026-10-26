import { describe, expect, it } from 'vitest';

import type { DirectoryFilter } from './directory';
import {
  PEOPLE_COLUMNS,
  PEOPLE_FALLBACK_COLUMNS,
  filterPeople,
  matchesDirectoryFilter,
} from './directory';

interface Row {
  id: string;
  name: string;
  usn: string | null;
  bio: string | null;
  skills: string[];
  interests: string[];
  role: 'student' | 'faculty' | 'admin';
  faculty_status: 'none' | 'pending' | 'approved' | 'verified' | 'rejected';
  member_type: 'student' | 'faculty' | 'alumni';
  year: number | null;
}

function person(overrides: Partial<Row> = {}): Row {
  return {
    id: 'person-1',
    name: 'Asha Rao',
    usn: '1UB21CS001',
    bio: 'Interested in distributed systems',
    skills: ['React Native'],
    interests: ['Open source'],
    role: 'student',
    faculty_status: 'none',
    member_type: 'student',
    year: 2,
    ...overrides,
  };
}

function ids(rows: Row[]): string[] {
  return rows.map((row) => row.id);
}

const noFilters = {
  query: '',
  skill: '',
  directoryFilter: 'all' as DirectoryFilter,
  viewerId: null,
};

describe('website People columns', () => {
  it('selects only the public profile projection', () => {
    expect(PEOPLE_COLUMNS).toContain('member_type');
    expect(PEOPLE_COLUMNS).toContain('graduation_year');
    expect(PEOPLE_COLUMNS).not.toContain('email');
    expect(PEOPLE_COLUMNS).not.toContain('employee_id');
    expect(PEOPLE_FALLBACK_COLUMNS).not.toContain('member_type');
    expect(PEOPLE_FALLBACK_COLUMNS).not.toContain('email');
  });
});

describe('directory filters', () => {
  it('gates faculty on approval, not a self-declared member type', () => {
    const approved = person({ id: 'approved', role: 'faculty', faculty_status: 'approved' });
    const legacy = person({ id: 'legacy', role: 'faculty', faculty_status: 'verified' });
    const pending = person({ id: 'pending', role: 'faculty', faculty_status: 'pending' });
    const declared = person({ id: 'declared', member_type: 'faculty' });
    const admin = person({ id: 'admin', role: 'admin', member_type: 'faculty' });

    expect(matchesDirectoryFilter(approved, 'faculty')).toBe(true);
    expect(matchesDirectoryFilter(legacy, 'faculty')).toBe(true);
    expect(matchesDirectoryFilter(pending, 'faculty')).toBe(false);
    expect(matchesDirectoryFilter(declared, 'faculty')).toBe(false);
    expect(matchesDirectoryFilter(admin, 'faculty')).toBe(true);
  });

  it('keeps alumni out of student year buckets even with a legacy year', () => {
    const alumni = person({ id: 'alumni', member_type: 'alumni', year: 2 });
    expect(matchesDirectoryFilter(alumni, '2')).toBe(false);
    expect(matchesDirectoryFilter(alumni, 'alumni')).toBe(true);
    expect(matchesDirectoryFilter(alumni, 'all')).toBe(true);
  });
});

describe('People filtering parity', () => {
  it('excludes the viewer', () => {
    const rows = [person({ id: 'me' }), person({ id: 'other' })];
    expect(ids(filterPeople(rows, { ...noFilters, viewerId: 'me' }))).toEqual(['other']);
  });

  it('searches only name, USN and bio', () => {
    const rows = [
      person({ id: 'name', name: 'Nisha' }),
      person({ id: 'usn', usn: '2UB22CS999', name: 'Other' }),
      person({ id: 'bio', name: 'Other', bio: 'Loves compilers' }),
      person({ id: 'skill-only', name: 'Other', bio: '', skills: ['Rust'] }),
    ];

    expect(ids(filterPeople(rows, { ...noFilters, query: 'nisha' }))).toEqual(['name']);
    expect(ids(filterPeople(rows, { ...noFilters, query: '2ub22' }))).toEqual(['usn']);
    expect(ids(filterPeople(rows, { ...noFilters, query: 'compilers' }))).toEqual(['bio']);
    expect(ids(filterPeople(rows, { ...noFilters, query: 'rust' }))).toEqual([]);
  });

  it('matches the separate skill control against skills or interests', () => {
    const rows = [
      person({ id: 'skill', skills: ['Machine Learning'], interests: [] }),
      person({ id: 'interest', skills: [], interests: ['Machine Learning'] }),
      person({ id: 'none', skills: ['React'], interests: ['Design'] }),
    ];

    expect(ids(filterPeople(rows, { ...noFilters, skill: 'machine' }))).toEqual([
      'skill',
      'interest',
    ]);
  });

  it('combines search, skill and directory filters without reordering', () => {
    const rows = [
      person({ id: 'z', name: 'Zara', year: 3, skills: ['Python'] }),
      person({ id: 'a', name: 'Aarav', year: 3, skills: ['Python'] }),
      person({ id: 'b', name: 'Byron', year: 4, skills: ['Python'] }),
      person({ id: 'c', name: 'Cara', year: 3, skills: ['Java'] }),
    ];

    expect(
      ids(
        filterPeople(rows, {
          query: 'a',
          skill: 'python',
          directoryFilter: '3',
          viewerId: null,
        })
      )
    ).toEqual(['z', 'a']);
  });
});
