import { AlertCircle, BadgeCheck } from 'lucide-react'
import { emailVerificationState } from '@/lib/logic/emailVerification'

/**
 * Renders the trusted Supabase Auth email-verification state.
 *
 * `unknown` (not loaded, or not authorised to see this member's status) renders
 * nothing. It must never be displayed as verified. Unverified is deliberately
 * distinct from faculty approval: an approved faculty member can still have an
 * unconfirmed email address.
 */
export default function EmailVerificationBadge({
  verified,
  className = '',
}: {
  verified: boolean | null | undefined
  className?: string
}) {
  const state = emailVerificationState(verified)
  if (state === 'unknown') return null

  if (state === 'verified') {
    return (
      <span
        className={`chip chip-accent py-0 text-[10px] ${className}`}
        title="Email address confirmed in Supabase Auth"
        aria-label="Email verified"
      >
        <BadgeCheck className="h-3 w-3" /> Email verified
      </span>
    )
  }

  return (
    <span
      className={`chip chip-warn py-0 text-[10px] ${className}`}
      title="Email address not confirmed in Supabase Auth"
      aria-label="Email not verified"
    >
      <AlertCircle className="h-3 w-3" /> Email not verified
    </span>
  )
}
