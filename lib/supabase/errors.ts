/**
 * Log a Supabase error object with all available detail fields.
 * Supabase errors carry message, code, details, and hint — log
 * each one so operators can distinguish constraint violations
 * from transient failures. Only these safe metadata fields are
 * logged; access tokens, cookies, and keys are never included.
 */
export function logSupabaseError(label: string, err: unknown): void {
  if (!err || typeof err !== 'object') {
    // Log unexpected non-object errors with message if available
    const message = typeof err === 'object' ? JSON.stringify(err) : String(err)
    console.error(`${label}: ${message}`)
    return
  }
  const e = err as Record<string, unknown>
  console.error(`${label}:`, {
    message: e.message,
    code: e.code,
    details: e.details,
    hint: e.hint,
  })
}
