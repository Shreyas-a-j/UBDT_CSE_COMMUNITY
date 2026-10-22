/**
 * Profile normalization and helpers — ported from the web app's
 * `lib/profile.ts` (see docs/mobile/MILESTONE_1_AUDIT.md §5). The web also
 * uses these to decide what mobile must display: the row is always coerced
 * defensively so a partially-provisioned profile can never crash the app.
 */

import type { FacultyStatus, Profile, UserRole } from './types';

const ROLES: UserRole[] = ['student', 'faculty', 'admin'];
const FACULTY_STATUSES: FacultyStatus[] = ['none', 'pending', 'verified', 'rejected'];

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNullableString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function asRole(value: unknown): UserRole {
  return ROLES.includes(value as UserRole) ? (value as UserRole) : 'student';
}

function asFacultyStatus(value: unknown): FacultyStatus {
  return FACULTY_STATUSES.includes(value as FacultyStatus) ? (value as FacultyStatus) : 'none';
}

export function displayName(profile?: { name?: string | null } | null): string {
  const name = profile?.name?.trim();
  return name && name.length > 0 ? name : 'Member';
}

export function firstName(name?: string | null): string {
  const trimmed = (name || '').trim();
  if (!trimmed) return 'Member';
  return trimmed.split(/\s+/)[0] ?? 'Member';
}

export function isVerifiedFaculty(profile?: Profile | null): boolean {
  if (!profile) return false;
  return profile.role === 'admin' || (profile.role === 'faculty' && profile.faculty_status === 'verified');
}

export function isAdmin(profile?: Profile | null): boolean {
  return profile?.role === 'admin';
}

export function canPublishFacultyContent(profile?: Profile | null): boolean {
  return isVerifiedFaculty(profile) || isAdmin(profile);
}

export function normalizeProfile(row: Record<string, unknown> | null | undefined): Profile | null {
  if (!row || typeof row !== 'object' || !row.id) return null;
  const year = asNumber(row.year);
  return {
    id: String(row.id),
    email: asNullableString(row.email),
    usn: asNullableString(row.usn),
    name: asString(row.name, 'Member') || 'Member',
    year: year !== null && year >= 1 && year <= 4 ? year : null,
    branch: asString(row.branch) || asString(row.department, 'CSE') || 'CSE',
    section: asNullableString(row.section),
    bio: asNullableString(row.bio),
    avatar_url: asNullableString(row.avatar_url),
    thumbhash: asNullableString(row.thumbhash),
    skills: asStringArray(row.skills),
    interests: asStringArray(row.interests),
    role: asRole(row.role),
    faculty_status: asFacultyStatus(row.faculty_status),
    designation: asNullableString(row.designation),
    employee_id: asNullableString(row.employee_id),
    expertise: asStringArray(row.expertise),
    created_at: asString(row.created_at, new Date().toISOString()),
    updated_at: asNullableString(row.updated_at),
    connection_count: asNumber(row.connection_count) ?? undefined,
  };
}

/**
 * Builds a provisional profile from the auth user's metadata when the
 * `public.profiles` row is missing. Mirrors the web's `fallbackProfileFromAuth`
 * and the database's `handle_new_user()` trigger mapping
 * (`intent = 'faculty'` → `faculty_status = 'pending'`).
 */
export function fallbackProfileFromAuth(user: {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown>;
}): Profile {
  const meta = user.user_metadata ?? {};
  return {
    id: user.id,
    email: user.email ?? null,
    usn: asNullableString(meta.usn),
    name: asString(meta.name, user.email?.split('@')[0] || 'Member') || 'Member',
    year: asNumber(meta.year),
    branch: asString(meta.department, 'CSE') || 'CSE',
    section: asNullableString(meta.section),
    bio: null,
    avatar_url: null,
    skills: asStringArray(meta.skills),
    interests: asStringArray(meta.interests),
    role: 'student',
    faculty_status: meta.intent === 'faculty' ? 'pending' : 'none',
    designation: asNullableString(meta.designation),
    employee_id: asNullableString(meta.employee_id),
    expertise: [],
    created_at: new Date().toISOString(),
  };
}
