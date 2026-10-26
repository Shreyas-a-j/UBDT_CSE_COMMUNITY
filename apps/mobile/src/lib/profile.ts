/**
 * Profile normalization and helpers — ported from the web app's
 * `lib/profile.ts`. The row is always coerced defensively so a partially
 * provisioned profile can never crash the app.
 */

import type { FacultyStatus, MemberType, Profile, UserRole } from './types';

const ROLES: UserRole[] = ['student', 'faculty', 'admin'];
const FACULTY_STATUSES: FacultyStatus[] = ['none', 'pending', 'approved', 'verified', 'rejected'];

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

function asMemberType(value: unknown, role: UserRole): MemberType {
  if (role === 'faculty' || role === 'admin') return 'faculty';
  if (value === 'alumni') return 'alumni';
  if (value === 'faculty') return 'faculty';
  return 'student';
}

function asGraduationYear(value: unknown): number | null {
  const year = asNumber(value);
  return year !== null && Number.isInteger(year) && year >= 1950 && year <= 2200 ? year : null;
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

/** Administrative faculty approval, not email verification. */
export function isApprovedFaculty(profile?: { role?: unknown; faculty_status?: unknown } | null): boolean {
  if (!profile) return false;
  return (
    profile.role === 'admin' ||
    (profile.role === 'faculty' &&
      (profile.faculty_status === 'approved' || profile.faculty_status === 'verified'))
  );
}

/** Legacy web name for the same administrative approval check. */
export function isVerifiedFaculty(profile?: Profile | null): boolean {
  return isApprovedFaculty(profile);
}

export function isAdmin(profile?: Profile | null): boolean {
  return profile?.role === 'admin';
}

/**
 * Mirror of the website export route's stricter rule: the role must be
 * faculty/admin AND the database status must be an approved spelling. This
 * only controls whether the button is shown; the server re-checks.
 */
export function canExportCommunityActivity(
  profile?: { role?: unknown; faculty_status?: unknown } | null
): boolean {
  if (!profile) return false;
  const approved =
    profile.faculty_status === 'approved' || profile.faculty_status === 'verified';
  return approved && (profile.role === 'faculty' || profile.role === 'admin');
}

export function canPublishFacultyContent(profile?: Profile | null): boolean {
  return isApprovedFaculty(profile);
}

export function canManageDiscussionPins(profile?: Profile | null): boolean {
  return profile?.role === 'admin' || isApprovedFaculty(profile);
}

export function alumniTag(graduationYear?: number | null): string {
  if (typeof graduationYear !== 'number' || !Number.isInteger(graduationYear)) return 'Alumni';
  return `Alumni '${String(graduationYear).slice(-2).padStart(2, '0')}`;
}

/* -------------------------- External profile links ------------------------ */

export type ProfileLinkField = 'portfolio_url' | 'github_url' | 'linkedin_url';
export type ProfileLinkValues = Record<ProfileLinkField, string | null>;
export type ProfileLinkErrors = Partial<Record<ProfileLinkField, string>>;

const PORTFOLIO_URL_MAX_LENGTH = 500;
const SOCIAL_URL_MAX_LENGTH = 300;
const PROFILE_LINK_FIELDS: ProfileLinkField[] = ['portfolio_url', 'github_url', 'linkedin_url'];
const SOCIAL_LINK_HOSTS: Partial<Record<ProfileLinkField, string>> = {
  github_url: 'github.com',
  linkedin_url: 'linkedin.com',
};
const LINK_ERROR_MESSAGES: Record<ProfileLinkField, string> = {
  portfolio_url: 'Enter a valid portfolio URL, for example https://your-site.dev.',
  github_url: 'Enter a valid GitHub URL, for example https://github.com/username.',
  linkedin_url: 'Enter a valid LinkedIn URL, for example https://linkedin.com/in/username.',
};

function maxLengthFor(field: ProfileLinkField): number {
  return field === 'portfolio_url' ? PORTFOLIO_URL_MAX_LENGTH : SOCIAL_URL_MAX_LENGTH;
}

/**
 * Returns a safe http(s) URL, or null. A missing scheme is assumed to be
 * https. Only http(s) is accepted; javascript:, data:, vbscript:, file: and
 * other schemes are rejected before parsing.
 */
export function normalizeProfileLink(field: ProfileLinkField, value: unknown): string | null {
  const raw = asNullableString(value);
  if (!raw || raw.length > maxLengthFor(field)) return null;
  if (/[\s\u0000-\u001f\u007f]/.test(raw)) return null;

  let candidate = raw;
  if (candidate.startsWith('//')) {
    candidate = `https:${candidate}`;
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(candidate)) {
    if (!/^https?:/i.test(candidate)) return null;
  } else {
    candidate = `https://${candidate}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (!parsed.hostname) return null;
  if (parsed.username || parsed.password) return null;

  const expectedHost = SOCIAL_LINK_HOSTS[field];
  if (expectedHost) {
    const host = parsed.hostname.toLowerCase();
    if (host !== expectedHost && host !== `www.${expectedHost}`) return null;
    if (!parsed.pathname || parsed.pathname === '/') return null;
  }

  if (candidate.length > maxLengthFor(field)) return null;
  return candidate;
}

export function normalizeProfileLinks(input: {
  portfolio_url?: unknown;
  github_url?: unknown;
  linkedin_url?: unknown;
}): { values: ProfileLinkValues; errors: ProfileLinkErrors } {
  const values: ProfileLinkValues = {
    portfolio_url: normalizeProfileLink('portfolio_url', input.portfolio_url),
    github_url: normalizeProfileLink('github_url', input.github_url),
    linkedin_url: normalizeProfileLink('linkedin_url', input.linkedin_url),
  };

  const errors: ProfileLinkErrors = {};
  for (const field of PROFILE_LINK_FIELDS) {
    const raw = asNullableString(input[field]);
    if (raw && !values[field]) errors[field] = LINK_ERROR_MESSAGES[field];
  }

  return { values, errors };
}

/**
 * Allowlist of columns a member may write to their own profile row. Mirrors
 * the website's `profileWritableFields` so both clients send the same shape.
 *
 * `usn`, `designation`, `member_type` and `graduation_year` are deliberately
 * absent: the database's `protect_profile_privileges` trigger reverts
 * non-admin writes to those columns.
 */
export function profileWritableFields(updated: Partial<Profile>) {
  const links = normalizeProfileLinks(updated);
  return {
    name: updated.name,
    bio: updated.bio,
    avatar_url: updated.avatar_url,
    thumbhash: updated.thumbhash,
    skills: updated.skills,
    interests: updated.interests,
    section: updated.section,
    year: updated.year,
    portfolio_url: links.values.portfolio_url,
    github_url: links.values.github_url,
    linkedin_url: links.values.linkedin_url,
    updated_at: new Date().toISOString(),
  };
}

export function normalizeProfile(row: Record<string, unknown> | null | undefined): Profile | null {
  if (!row || typeof row !== 'object' || !row.id) return null;
  const year = asNumber(row.year);
  const role = asRole(row.role);
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
    role,
    faculty_status: asFacultyStatus(row.faculty_status),
    designation: asNullableString(row.designation),
    employee_id: asNullableString(row.employee_id),
    expertise: asStringArray(row.expertise),
    member_type: asMemberType(row.member_type, role),
    graduation_year: asGraduationYear(row.graduation_year),
    portfolio_url: normalizeProfileLink('portfolio_url', row.portfolio_url),
    github_url: normalizeProfileLink('github_url', row.github_url),
    linkedin_url: normalizeProfileLink('linkedin_url', row.linkedin_url),
    created_at: asString(row.created_at, new Date().toISOString()),
    updated_at: asNullableString(row.updated_at),
  };
}

/**
 * Builds a provisional profile from the auth user's metadata when the
 * `public.profiles` row is missing. Mirrors the web's `fallbackProfileFromAuth`
 * and the database's `handle_new_user()` trigger mapping.
 */
export function fallbackProfileFromAuth(user: {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown>;
}): Profile {
  const meta = user.user_metadata ?? {};
  const intent = asString(meta.intent).trim().toLowerCase();
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
    faculty_status: intent === 'faculty' ? 'pending' : 'none',
    designation: intent === 'faculty' ? asNullableString(meta.designation) : null,
    employee_id: intent === 'faculty' ? asNullableString(meta.employee_id) : null,
    expertise: [],
    member_type: intent === 'alumni' ? 'alumni' : 'student',
    graduation_year: asGraduationYear(meta.graduation_year),
    portfolio_url: normalizeProfileLink('portfolio_url', meta.portfolio_url),
    github_url: normalizeProfileLink('github_url', meta.github_url),
    linkedin_url: normalizeProfileLink('linkedin_url', meta.linkedin_url),
    created_at: new Date().toISOString(),
  };
}
