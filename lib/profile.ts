import type {
  ContactVisibility,
  FacultyStatus,
  MemberType,
  Profile,
  ProfileContact,
  UserRole,
} from '@/lib/types'

const ROLES: UserRole[] = ['student', 'faculty', 'admin']
const FACULTY_STATUSES: FacultyStatus[] = ['none', 'pending', 'approved', 'verified', 'rejected']
const CONTACT_VISIBILITIES: ContactVisibility[] = ['private', 'members', 'public']

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function asNullableString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

function asRole(value: unknown): UserRole {
  return ROLES.includes(value as UserRole) ? (value as UserRole) : 'student'
}

function asFacultyStatus(value: unknown): FacultyStatus {
  return FACULTY_STATUSES.includes(value as FacultyStatus) ? (value as FacultyStatus) : 'none'
}

function asMemberType(value: unknown, role: UserRole): MemberType {
  // A privileged role always wins. This keeps an inconsistent or stale
  // member_type from presenting faculty/admin rows as students.
  if (role === 'faculty' || role === 'admin') return 'faculty'
  if (value === 'alumni') return 'alumni'
  if (value === 'faculty') return 'faculty'
  // Legacy rows predate member_type. Everyone else is a student, never an
  // alumnus, because alumni identity cannot be inferred from a numeric year.
  return 'student'
}

function asGraduationYear(value: unknown): number | null {
  const year = asNumber(value)
  return year !== null && Number.isInteger(year) && year >= 1950 && year <= 2200
    ? year
    : null
}

function asContactVisibility(value: unknown): ContactVisibility {
  return CONTACT_VISIBILITIES.includes(value as ContactVisibility)
    ? (value as ContactVisibility)
    : 'private'
}

// External-link normalization. The database CHECK constraints from
// supabase/migrations/2026102201_member_identity_and_contacts.sql require an
// explicit http(s) scheme, an allowed host for the social links, no
// whitespace, and a length cap. Normalizing here keeps a valid user input
// from being rejected by the database, while unsafe schemes (javascript:,
// data:, vbscript:, file:, ftp:, ...) are always dropped.
const PORTFOLIO_URL_MAX_LENGTH = 500
const SOCIAL_URL_MAX_LENGTH = 300
const CONTACT_EMAIL_MAX_LENGTH = 320

export type ProfileLinkField = 'portfolio_url' | 'github_url' | 'linkedin_url'

export type ProfileLinkValues = Record<ProfileLinkField, string | null>

export type ProfileLinkErrors = Partial<Record<ProfileLinkField, string>>

const PROFILE_LINK_FIELDS: ProfileLinkField[] = [
  'portfolio_url',
  'github_url',
  'linkedin_url',
]

const SOCIAL_LINK_HOSTS: Partial<Record<ProfileLinkField, string>> = {
  github_url: 'github.com',
  linkedin_url: 'linkedin.com',
}

const LINK_ERROR_MESSAGES: Record<ProfileLinkField, string> = {
  portfolio_url: 'Enter a valid portfolio URL, for example https://your-site.dev.',
  github_url: 'Enter a valid GitHub URL, for example https://github.com/username.',
  linkedin_url: 'Enter a valid LinkedIn URL, for example https://linkedin.com/in/username.',
}

function maxLengthFor(field: ProfileLinkField): number {
  return field === 'portfolio_url' ? PORTFOLIO_URL_MAX_LENGTH : SOCIAL_URL_MAX_LENGTH
}

/**
 * Returns a safe http(s) URL for a profile link, or null. A missing scheme is
 * assumed to be https, so "github.com/username" becomes
 * "https://github.com/username". Only http(s) is accepted: URL schemes such
 * as javascript:, data:, and vbscript: are rejected before parsing, which
 * is what makes the rendered anchor safe.
 */
export function normalizeProfileLink(field: ProfileLinkField, value: unknown): string | null {
  const raw = asNullableString(value)
  if (!raw || raw.length > maxLengthFor(field)) return null

  // No whitespace or control characters. The DB constraint rejects spaces
  // too, and control characters can confuse URL parsers.
  if (/[\s\u0000-\u001f\u007f]/.test(raw)) return null

  let candidate = raw
  if (candidate.startsWith('//')) {
    candidate = `https:${candidate}`
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(candidate)) {
    // An explicit scheme is present. Reject everything that is not http(s)
    // (javascript:, data:, vbscript:, file:, ftp:, mailto:, ...).
    if (!/^https?:/i.test(candidate)) return null
  } else {
    // Common copy/paste input such as "me.dev" or "github.com/username".
    candidate = `https://${candidate}`
  }

  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    return null
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  if (!parsed.hostname) return null
  // Credentials in a public profile link are unnecessary and a phishing
  // smell; the database constraints do not need to allow them.
  if (parsed.username || parsed.password) return null

  const expectedHost = SOCIAL_LINK_HOSTS[field]
  if (expectedHost) {
    const host = parsed.hostname.toLowerCase()
    if (host !== expectedHost && host !== `www.${expectedHost}`) return null
    // The DB constraint requires "/<something>" for social links, so a bare
    // domain is not useful (github.com -> github.com/ would be rejected).
    if (!parsed.pathname || parsed.pathname === '/') return null
  }

  if (candidate.length > maxLengthFor(field)) return null
  return candidate
}

export function normalizeProfileLinks(input: {
  portfolio_url?: unknown
  github_url?: unknown
  linkedin_url?: unknown
}): { values: ProfileLinkValues; errors: ProfileLinkErrors } {
  const values: ProfileLinkValues = {
    portfolio_url: normalizeProfileLink('portfolio_url', input.portfolio_url),
    github_url: normalizeProfileLink('github_url', input.github_url),
    linkedin_url: normalizeProfileLink('linkedin_url', input.linkedin_url),
  }

  const errors: ProfileLinkErrors = {}
  for (const field of PROFILE_LINK_FIELDS) {
    const raw = asNullableString(input[field])
    if (raw && !values[field]) errors[field] = LINK_ERROR_MESSAGES[field]
  }

  return { values, errors }
}

function asHttpUrl(value: unknown): string | null {
  return normalizeProfileLink('portfolio_url', value)
}

function asGitHubUrl(value: unknown): string | null {
  return normalizeProfileLink('github_url', value)
}

function asLinkedInUrl(value: unknown): string | null {
  return normalizeProfileLink('linkedin_url', value)
}

// Matches the profile_contacts email/phone CHECK constraints (same source as
// lib/validation.ts's email pattern). Private contact details are validated
// and dropped to null — never carried on the public Profile object.
function asContactEmail(value: unknown): string | null {
  const email = asNullableString(value)
  if (!email || email.length > CONTACT_EMAIL_MAX_LENGTH) return null
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : null
}

function asPhone(value: unknown): string | null {
  const phone = asNullableString(value)
  if (!phone) return null
  return /^\+?[0-9][0-9 ()\-]{6,19}$/.test(phone) ? phone : null
}

export function displayName(profile?: { name?: string | null } | null): string {
  const name = profile?.name?.trim()
  return name && name.length > 0 ? name : 'Member'
}

/**
 * Compact alumni identity label derived from graduation_year:
 *   2024 -> "Alumni '24"
 *   missing/invalid -> "Alumni"
 * Students and faculty use their existing role labels instead.
 */
export function alumniTag(graduationYear?: number | null): string {
  if (typeof graduationYear !== 'number' || !Number.isInteger(graduationYear)) {
    return 'Alumni'
  }
  return `Alumni '${String(graduationYear).slice(-2).padStart(2, '0')}`
}

export function firstName(name?: string | null): string {
  const trimmed = (name || '').trim()
  if (!trimmed) return 'Member'
  return trimmed.split(/\s+/)[0] ?? 'Member'
}

/**
 * Faculty approval vocabulary.
 *
 * 'verified' is what the repo's original migrations wrote; the live UCC
 * database (and the Phase 6.1 brief) uses 'approved'. They mean the same
 * thing, so both are accepted everywhere. New approvals write 'approved'.
 */
export function isApprovedFacultyStatus(status: unknown): boolean {
  return status === 'approved' || status === 'verified'
}

/**
 * The single eligibility rule for approved faculty, used by the publisher
 * gate, the API route, the directory, the dashboard and middleware.
 * `profiles.role`/`faculty_status` are protected by the database trigger, so
 * this must be fed a profile read from the database, never client claims.
 */
export function isApprovedFaculty(
  profile?: { role?: unknown; faculty_status?: unknown } | null
): boolean {
  if (!profile) return false
  return (
    profile.role === 'admin' ||
    (profile.role === 'faculty' && isApprovedFacultyStatus(profile.faculty_status))
  )
}

export function isVerifiedFaculty(profile?: Profile | null): boolean {
  return isApprovedFaculty(profile)
}

export function isAdmin(profile?: Profile | null): boolean {
  return profile?.role === 'admin'
}

export function canPublishFacultyContent(profile?: Profile | null): boolean {
  return isApprovedFaculty(profile)
}

export function profileWritableFields(updated: Partial<Profile>) {
  // Normalize links at the write boundary too. The modal validates first and
  // shows field-level errors, but this keeps every caller (including future
  // ones) from sending a value the profiles CHECK constraints would reject.
  const links = normalizeProfileLinks(updated)
  return {
    name: updated.name,
    bio: updated.bio,
    avatar_url: updated.avatar_url,
    thumbhash: updated.thumbhash,
    skills: updated.skills,
    interests: updated.interests,
    section: updated.section,
    year: updated.year,
    // UCC 2.0 public links — the member may edit their own public links.
    portfolio_url: links.values.portfolio_url,
    github_url: links.values.github_url,
    linkedin_url: links.values.linkedin_url,
    // 'designation' is only settable by admins (via faculty application approval)
    // 'usn' is immutable after registration — protected by protect_profile_privileges trigger
    // member_type/graduation_year are also protected (trigger reverts non-admin writes),
    // so they are deliberately absent from this allowlist.
    updated_at: new Date().toISOString(),
  }
}

export function normalizeProfile(row: Record<string, unknown> | null | undefined): Profile | null {
  if (!row || typeof row !== 'object' || !row.id) return null
  const year = asNumber(row.year)
  const role = asRole(row.role)
  return {
    id: String(row.id),
    email: asNullableString(row.email),
    usn: asNullableString(row.usn),
    name: asString(row.name, 'Member') || 'Member',
    year: year !== null && year >= 1 && year <= 4 ? year : null,
    branch: asString(row.branch, 'CSE') || 'CSE',
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
    // UCC 2.0 identity: legacy rows predate member_type, so it is derived
    // from the existing role and never trusts self-asserted identity values.
    member_type: asMemberType(row.member_type, role),
    graduation_year: asGraduationYear(row.graduation_year),
    portfolio_url: asHttpUrl(row.portfolio_url),
    github_url: asGitHubUrl(row.github_url),
    linkedin_url: asLinkedInUrl(row.linkedin_url),
    // No private contact fields here: contact_email/phone/contact_visibility
    // live in public.profile_contacts and are handled by normalizeProfileContact.
    created_at: asString(row.created_at, new Date().toISOString()),
    updated_at: asNullableString(row.updated_at),
  }
}

/**
 * Normalizes a public.profile_contacts row. Private contact details are kept
 * strictly separate from normalizeProfile's output: the profiles table has a
 * public SELECT policy, so contact data on Profile would leak to everyone.
 */
export function normalizeProfileContact(
  row: Record<string, unknown> | null | undefined,
): ProfileContact | null {
  if (!row || typeof row !== 'object' || !row.profile_id) return null
  return {
    profile_id: String(row.profile_id),
    contact_email: asContactEmail(row.contact_email),
    phone: asPhone(row.phone),
    contact_visibility: asContactVisibility(row.contact_visibility),
    created_at: asString(row.created_at, new Date().toISOString()),
    updated_at: asNullableString(row.updated_at),
  }
}

export function fallbackProfileFromAuth(user: {
  id: string
  email?: string | null
  user_metadata?: Record<string, unknown>
}): Profile {
  const meta = user.user_metadata ?? {}
  // Normalize signup intent before interpreting it: casing, whitespace, or
  // missing values must not change who gets alumni identity or a pending
  // faculty application.
  const intent = asString(meta.intent).trim().toLowerCase()
  // member_type/graduation_year/external links are the only UCC 2.0 identity
  // fields a signup may set. role stays 'student' and faculty_status may only
  // become 'pending' through the explicit faculty-intent path — metadata can
  // never grant a privileged role or verified status. This mirrors the
  // handle_new_user() trigger in supabase/migrations.
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
    portfolio_url: asHttpUrl(meta.portfolio_url),
    github_url: asGitHubUrl(meta.github_url),
    linkedin_url: asLinkedInUrl(meta.linkedin_url),
    created_at: new Date().toISOString(),
  }
}
