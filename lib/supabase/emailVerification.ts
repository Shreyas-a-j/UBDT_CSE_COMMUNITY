import type { SupabaseClient } from '@supabase/supabase-js'
import {
  normalizeEmailVerificationRows,
  uniqueVerificationIds,
} from '@/lib/logic/emailVerification'

export const EMAIL_VERIFICATION_RPC = 'get_email_verification_status'

/**
 * Reads trusted email-verification state for a batch of profile ids.
 *
 * The RPC is the only source: it reads auth.users.email_confirmed_at and
 * silently omits ids the caller may not see. A missing id therefore means
 * "unknown", not "unverified". Callers must surface the error rather than
 * rendering a badge from partial data.
 */
export async function fetchEmailVerificationStatus(
  supabase: SupabaseClient,
  userIds: readonly string[],
): Promise<Record<string, boolean>> {
  const ids = uniqueVerificationIds(userIds)
  if (ids.length === 0) return {}

  const { data, error } = await supabase.rpc(EMAIL_VERIFICATION_RPC, {
    target_user_ids: ids,
  })

  if (error) throw error
  return normalizeEmailVerificationRows(data)
}
