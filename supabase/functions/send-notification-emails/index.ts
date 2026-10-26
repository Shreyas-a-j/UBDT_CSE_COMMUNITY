// Supabase Edge Function: send-notification-emails (DISABLED)
//
// Email delivery was removed from the publish flow on 2026-10-24. The
// database also blocks new inserts into notification_email_outbox and the
// Database Webhook trigger has been dropped by 2026102403.
//
// This tombstone intentionally has no provider client and no secrets. It
// returns 410 for every request, including a correctly authenticated one,
// so a stale deployment or a missed webhook removal cannot send mail.
//
// Historical email rows and this function's former template/policy modules
// remain for audit and for a deliberate future re-enable migration.

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

Deno.serve((): Response => {
  return json(410, {
    error: 'Email delivery is disabled. Android push uses send-push-notifications.',
    enqueue_enabled: false,
  })
})
