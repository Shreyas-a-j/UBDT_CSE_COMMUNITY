/**
 * Safe Supabase error logger — port of the web `lib/supabase/errors.ts`.
 * Logs only the safe metadata fields (message/code/details/hint) so
 * operators can distinguish constraint violations from transient failures
 * while guaranteeing access tokens, cookies, and keys are never logged.
 */

export function logSupabaseError(label: string, err: unknown): void {
  if (!err || typeof err !== 'object') {
    console.error(`${label}: ${String(err)}`);
    return;
  }
  const e = err as Record<string, unknown>;
  console.error(`${label}:`, {
    message: e.message,
    code: e.code,
    details: e.details,
    hint: e.hint,
  });
}
