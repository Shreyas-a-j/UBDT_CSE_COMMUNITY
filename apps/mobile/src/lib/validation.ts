/**
 * Validation rules mirrored from the web app for Milestone 1.
 *
 * The web's `lib/validation.ts` transitively depends on UI-coupled helpers
 * (`lib/utils.ts` → tailwind-merge classnames), so only the two rules the
 * sign-in flow needs are ported here, with the exact same regexes:
 *   - email format (identical pattern to the web)
 *   - USN format `4UB24CS045` (identical pattern + roll bounds to the web)
 *
 * Shared single-source validation is planned for the Milestone-2 workspace
 * package. See docs/mobile/MILESTONE_1_AUDIT.md §5.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
