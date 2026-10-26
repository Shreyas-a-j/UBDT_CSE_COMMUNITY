/**
 * Pure faculty-onboarding helpers ported from the website's
 * `lib/logic/faculty.ts`.
 *
 * Nothing here is an authorisation boundary. The database trigger and RLS
 * policies decide whether an application exists and whether faculty
 * permissions are granted. These helpers only keep the client from sending
 * privileged fields and from misreporting the insert outcome.
 */

import { sanitizeText } from './validation';

export type FacultyApplicationInsertOutcome =
  | 'created'
  | 'already-pending'
  | 'profile-not-ready'
  | 'failed';

export interface FacultySignupDetails {
  name: string;
  department: string;
  designation: string;
  employeeId?: string;
}

function cleanEmployeeId(value?: string): string | null {
  const cleaned = sanitizeText(value ?? '', 80);
  return cleaned.length ? cleaned : null;
}

/**
 * The only metadata the faculty form may send. `intent` asks the database
 * trigger to create a pending application; it can never set `role`,
 * `faculty_status`, `member_type`, `reviewed_by` or any other privileged
 * field.
 */
export function buildFacultySignupMetadata(input: FacultySignupDetails) {
  return {
    name: sanitizeText(input.name, 80),
    department: sanitizeText(input.department, 80),
    designation: sanitizeText(input.designation, 120),
    employee_id: cleanEmployeeId(input.employeeId),
    intent: 'faculty' as const,
  };
}

/**
 * Fallback application insert for deployments where the trigger is not yet
 * applied. The row is always pending and never carries reviewer fields.
 */
export function buildFacultyApplicationRow(
  userId: string,
  officialEmail: string,
  input: FacultySignupDetails
) {
  return {
    user_id: userId,
    full_name: sanitizeText(input.name, 80),
    official_email: sanitizeText(officialEmail, 320),
    department: sanitizeText(input.department, 80),
    designation: sanitizeText(input.designation, 120),
    employee_id: cleanEmployeeId(input.employeeId),
    status: 'pending' as const,
  };
}

/**
 * Maps the fallback insert's error to a user-visible outcome. A duplicate
 * pending application is success: the trigger already created the row during
 * signUp, so the client fallback must not turn that into an error.
 */
export function classifyFacultyApplicationInsert(
  error?: { code?: string | null } | null
): FacultyApplicationInsertOutcome {
  if (!error) return 'created';
  if (error.code === '23505') return 'already-pending';
  if (error.code === '23503') return 'profile-not-ready';
  return 'failed';
}
