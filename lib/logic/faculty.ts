import type { FacultyApplicationStatus, Profile } from '@/lib/types'
import { isAdmin, isApprovedFaculty } from '@/lib/profile'
import { sanitizeText } from '@/lib/validation'

/**
 * Pure faculty-onboarding rules shared by the signup form and tests. The
 * admin view applies the same `isAdmin`/`isApprovedFaculty` rules directly.
 * Nothing here is an authorisation boundary: the database triggers and
 * RLS policies are. These helpers only keep the client from misrepresenting a
 * member's state and from sending privileged fields it must never send.
 */

export const FACULTY_APPLICATION_STATUSES: readonly FacultyApplicationStatus[] = [
  'pending',
  'approved',
  'rejected',
]

export type FacultyOnboardingState =
  | 'none'
  | 'student'
  | 'alumni'
  | 'pending'
  | 'approved'
  | 'rejected'

type FacultyStateProfile = Pick<Profile, 'role' | 'faculty_status' | 'member_type'>

/**
 * Classifies the account for onboarding UI purposes.
 *
 * Approval wins over every other state. A pending or rejected application is
 * reported as such even when the member is an alumnus, because the application
 * is what they are waiting on. `role` is authoritative for privileges: a
 * self-declared `member_type` alone never makes an account approved.
 */
export function facultyOnboardingState(
  profile?: FacultyStateProfile | null,
): FacultyOnboardingState {
  if (!profile) return 'none'
  if (isApprovedFaculty(profile)) return 'approved'
  if (profile.faculty_status === 'pending') return 'pending'
  if (profile.faculty_status === 'rejected') return 'rejected'
  if (profile.member_type === 'alumni') return 'alumni'
  return 'student'
}

/** Only an administrator may review, approve or reject an application. */
export function canReviewFacultyApplications(profile?: Profile | null): boolean {
  return isAdmin(profile)
}

export interface FacultySignupDetails {
  name: string
  department: string
  designation: string
  employeeId?: string
}

function cleanEmployeeId(value?: string): string | null {
  const cleaned = sanitizeText(value ?? '', 80)
  return cleaned.length ? cleaned : null
}

/**
 * The only metadata the faculty signup form may send. `intent` asks the
 * database trigger to create a pending application; it can never set `role`,
 * `faculty_status`, `member_type`, `reviewed_by` or any other privileged field.
 */
export function buildFacultySignupMetadata(input: FacultySignupDetails) {
  return {
    name: sanitizeText(input.name, 80),
    department: sanitizeText(input.department, 80),
    designation: sanitizeText(input.designation, 120),
    employee_id: cleanEmployeeId(input.employeeId),
    intent: 'faculty' as const,
  }
}

/**
 * The fallback application insert (for deployments where the database trigger
 * is not yet applied). The row is always pending and never carries reviewer
 * fields; the transition trigger rejects anything else.
 */
export function buildFacultyApplicationRow(
  userId: string,
  officialEmail: string,
  input: FacultySignupDetails,
) {
  return {
    user_id: userId,
    full_name: sanitizeText(input.name, 80),
    official_email: sanitizeText(officialEmail, 320),
    department: sanitizeText(input.department, 80),
    designation: sanitizeText(input.designation, 120),
    employee_id: cleanEmployeeId(input.employeeId),
    status: 'pending' as const,
  }
}

export type FacultyApplicationInsertOutcome =
  | 'created'
  | 'already-pending'
  | 'profile-not-ready'
  | 'failed'

/**
 * Maps the fallback insert's error to a user-visible outcome. A duplicate
 * pending application is success: the database trigger already created the
 * row during signUp, so the browser's fallback must not turn that into an
 * error.
 */
export function classifyFacultyApplicationInsert(
  error?: { code?: string | null } | null,
): FacultyApplicationInsertOutcome {
  if (!error) return 'created'
  if (error.code === '23505') return 'already-pending'
  if (error.code === '23503') return 'profile-not-ready'
  return 'failed'
}
