/**
 * Validation rules mirrored from the web app.
 *
 * The web's `lib/validation.ts` transitively depends on UI-coupled helpers
 * (`lib/utils.ts` → tailwind-merge classnames), so the rules needed by the
 * mobile auth flows are ported here with the exact same messages and limits:
 *   - email format (identical pattern to the web)
 *   - USN format `4UB24CS045` (identical pattern + roll bounds to the web)
 *   - student / alumni / faculty registration
 *   - comma-separated skill tags
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const ADMISSION_NUMBER_PATTERN = /^[A-Z0-9][A-Z0-9/-]{2,22}[A-Z0-9]$/;

export function normalizeAdmissionNumber(value: string): string {
  return value.trim().toUpperCase();
}

export function validateAdmissionNumber(value: string): boolean {
  return ADMISSION_NUMBER_PATTERN.test(normalizeAdmissionNumber(value));
}

/** Exact port of web lib/utils.ts:validateUSN pattern `4UB24CS045`. */
export function validateUSN(usn: string): boolean {
  const match = usn.trim().match(/^4UB(\d{2})CS(\d{1,3})$/i);
  if (!match) return false;
  const admissionYearTwoDigits = parseInt(match[1], 10);
  const roll = parseInt(match[2], 10);
  if (roll === 0 || roll > 999) return false;
  const currentYearTwoDigits = new Date().getFullYear() % 100;
  return admissionYearTwoDigits <= currentYearTwoDigits;
}

/** Mirrors the web sign-in page's client-side checks verbatim. */
export function validateSignIn(input: { email: string; password: string }): string | null {
  if (!input.email.trim()) return 'Please enter your email address.';
  if (!input.password || input.password.length < 6) {
    return 'Password must be at least 6 characters.';
  }
  return null;
}

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim());
}

export function sanitizeText(value: string, max = 4000): string {
  return value.replace(/\u0000/g, '').trim().slice(0, max);
}

/** Exact port of the web's `getYearFromUSN` (lib/utils.ts). */
export function getYearFromUSN(usn: string): number | null {
  const match = usn.trim().match(/^4UB(\d{2})CS(\d{1,3})$/i);
  if (!match) return null;

  const admissionYearTwoDigits = parseInt(match[1], 10);
  const roll = parseInt(match[2], 10);
  const currentYear = new Date().getFullYear();
  const currentYearTwoDigits = currentYear % 100;
  if (admissionYearTwoDigits > currentYearTwoDigits) return null;
  if (roll < 1 || roll > 999) return null;

  const admissionFullYear = 2000 + admissionYearTwoDigits;
  const diff = currentYear - admissionFullYear + 1;
  if (diff >= 1 && diff <= 4) return diff;
  if (diff > 4) return 4;
  return 1;
}

/** Mirrors the web's student-registration rules. */
export function validateStudentSignup(input: {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
  usn: string;
  admissionNumber?: string;
  year: number;
  section?: string;
}): string | null {
  if (!input.name.trim()) return 'Please enter your full name.';
  if (input.name.trim().length < 2) return 'Name must be at least 2 characters.';
  if (!isValidEmail(input.email)) return 'Please enter a valid email address.';
  const usn = input.usn.trim();
  const admissionNumber = (input.admissionNumber ?? '').trim();
  if (usn && !validateUSN(usn)) return 'Invalid USN. Expected format: 4UB24CS045';
  if (admissionNumber && !validateAdmissionNumber(admissionNumber)) {
    return 'Enter a valid admission number. Use 4-24 letters, digits, hyphens or slashes.';
  }
  if (![1, 2, 3, 4].includes(input.year)) return 'Select a valid academic year.';
  if (input.year === 1 && !usn && !admissionNumber) {
    return 'First-year students need either a USN or an admission number.';
  }
  if (input.year !== 1 && !usn) {
    return 'A USN is required for students in years 2-4.';
  }
  if (!input.password || input.password.length < 6) {
    return 'Password must be at least 6 characters.';
  }
  if (input.password !== input.confirmPassword) return 'Passwords do not match.';
  return null;
}

/** Mirrors the web's alumni-registration rules. */
export function validateAlumniSignup(input: {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
  graduationYear: number;
  section?: string;
}): string | null {
  if (!input.name.trim()) return 'Please enter your full name.';
  if (input.name.trim().length < 2) return 'Name must be at least 2 characters.';
  if (!isValidEmail(input.email)) return 'Please enter a valid email address.';
  const currentYear = new Date().getFullYear();
  if (
    !Number.isInteger(input.graduationYear) ||
    input.graduationYear < 1950 ||
    input.graduationYear > currentYear
  ) {
    return `Graduation year must be between 1950 and ${currentYear}.`;
  }
  if (!input.password || input.password.length < 6) {
    return 'Password must be at least 6 characters.';
  }
  if (input.password !== input.confirmPassword) return 'Passwords do not match.';
  return null;
}

/** Mirrors the web's faculty-access-request rules. */
export function validateFacultySignup(input: {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
  designation: string;
  department: string;
}): string | null {
  if (!input.name.trim()) return 'Please enter your full name.';
  if (!isValidEmail(input.email)) return 'Please enter a valid institutional email.';
  if (!input.designation.trim()) return 'Please enter your designation.';
  if (!input.department.trim()) return 'Please enter your department.';
  if (!input.password || input.password.length < 6) {
    return 'Password must be at least 6 characters.';
  }
  if (input.password !== input.confirmPassword) return 'Passwords do not match.';
  return null;
}

export function validateAcademicYear(year: unknown): string | null {
  return typeof year === 'number' && Number.isInteger(year) && year >= 1 && year <= 4
    ? null
    : 'Select a valid academic year.';
}

/** Mirrors the web's `parseTagList`: comma-separated, no leading #. */
export function parseTagList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim().replace(/^#/, ''))
    .filter(Boolean)
    .slice(0, 20);
}
