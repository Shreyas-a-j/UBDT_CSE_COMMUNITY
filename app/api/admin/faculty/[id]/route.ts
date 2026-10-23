import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

type ReviewDecision = 'approve' | 'reject'
type ReviewStatus = 'approved' | 'rejected'
type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

interface RpcErrorLike {
  message?: unknown
  code?: unknown
}

interface PersistedApplication {
  id?: unknown
  status?: unknown
  [key: string]: unknown
}

const REVIEW_RPC = 'review_faculty_application'
const EXPECTED_STATUS: Record<ReviewDecision, ReviewStatus> = {
  approve: 'approved',
  reject: 'rejected',
}

/**
 * Supabase returns a scalar JSONB RPC as the value itself. Some deployments or
 * proxies wrap a single row in an array; accept that only when the array has
 * exactly one element. Anything else is ambiguous and must be confirmed
 * against the persisted row rather than treated as success.
 */
function parseRpcResult(data: unknown): Record<string, unknown> | null {
  let value = data

  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return null
    }
  }

  if (Array.isArray(value)) {
    if (value.length !== 1) return null
    value = value[0]
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function confirmedByRpc(
  result: Record<string, unknown> | null,
  applicationId: string,
  expectedStatus: ReviewStatus,
): boolean {
  return (
    result?.success === true &&
    result.application_id === applicationId &&
    result.status === expectedStatus
  )
}

function errorMessage(error: unknown, fallback: string): string {
  const candidate =
    error && typeof error === 'object' && 'message' in error
      ? (error as { message?: unknown }).message
      : error instanceof Error
        ? error.message
        : error

  if (typeof candidate !== 'string') return fallback
  const message = candidate.replace(/\s+/g, ' ').trim()
  return message ? message.slice(0, 500) : fallback
}

function isPermissionError(error: unknown): boolean {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? (error as { code?: unknown }).code
      : null
  if (code === '42501') return true
  return /administrator access required|permission denied|not authorized/i.test(
    errorMessage(error, ''),
  )
}

function isTransportError(error: unknown): boolean {
  return /fetch|network|timeout|timed out|abort|econn|socket|connection/i.test(
    errorMessage(error, ''),
  )
}

async function readPersistedApplication(
  supabase: SupabaseServerClient,
  applicationId: string,
): Promise<{ application: PersistedApplication | null; error: unknown }> {
  const { data, error } = await supabase
    .from('faculty_applications')
    .select('*')
    .eq('id', applicationId)
    .maybeSingle()

  if (error) return { application: null, error }
  return { application: (data as PersistedApplication | null) ?? null, error: null }
}

function successResponse(
  applicationId: string,
  decision: ReviewDecision,
  status: ReviewStatus,
  application?: PersistedApplication | null,
) {
  return NextResponse.json({
    outcome: status,
    decision,
    status,
    application_id: applicationId,
    application: application ?? null,
  })
}

function notConfirmedResponse(
  message: string,
  application: PersistedApplication | null,
  statusCode: number,
) {
  return NextResponse.json(
    {
      error: message,
      status: 'pending',
      application,
    },
    { status: statusCode },
  )
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params
  const body = (await request.json().catch(() => ({}))) as {
    decision?: string
    notes?: string | null
  }

  // The database RPC uses the imperative vocabulary: approve / reject.
  // The stored application status is approved / rejected; only the RPC maps
  // between the two. Never accept "approved"/"rejected" or title case here.
  const decision: ReviewDecision | null =
    body.decision === 'approve' || body.decision === 'reject' ? body.decision : null
  if (!decision) {
    return NextResponse.json({ error: 'Decision must be approve or reject.' }, { status: 400 })
  }

  const notes = typeof body.notes === 'string' ? body.notes.slice(0, 500) : null
  const expectedStatus = EXPECTED_STATUS[decision]

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 })

  // The route re-reads the caller's role so a hidden UI control is never the
  // authorisation boundary. The RPC repeats this check against auth.uid().
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()
  if (profile?.role !== 'admin') {
    return NextResponse.json({ error: 'Administrator access required.' }, { status: 403 })
  }

  // Temporary development diagnostic: inspect the exact argument values and
  // the RPC data/error separately. No names, emails or free-text notes.
  if (process.env.NODE_ENV !== 'production') {
    console.info('[admin-faculty-review] rpc-arguments', {
      p_application_id: id,
      p_decision: decision,
      p_decision_type: typeof decision,
      p_notes_provided: notes !== null,
      p_notes_length: notes?.length ?? 0,
    })
  }

  let data: unknown = null
  let rpcError: RpcErrorLike | null = null
  let thrownError: unknown = null

  try {
    const response = await supabase.rpc(REVIEW_RPC, {
      p_application_id: id,
      p_decision: decision,
      p_notes: notes,
    })
    data = response.data
    rpcError = response.error
  } catch (error) {
    thrownError = error
  }

  if (process.env.NODE_ENV !== 'production') {
    console.info('[admin-faculty-review] rpc-data', {
      applicationId: id,
      decision,
      data,
    })
    console.info('[admin-faculty-review] rpc-error', {
      applicationId: id,
      decision,
      error: rpcError,
      thrown: thrownError instanceof Error ? thrownError.message : thrownError,
    })
  }

  const result = parseRpcResult(data)
  const bodyError =
    result && result.success === false
      ? errorMessage(result.error ?? result.message, '')
      : ''

  // A permission denial is not an ambiguous result: do not hide it behind a
  // persisted-status check.
  if (
    isPermissionError(rpcError) ||
    isPermissionError(thrownError) ||
    isPermissionError(bodyError)
  ) {
    return NextResponse.json(
      {
        error: errorMessage(
          rpcError ?? thrownError ?? bodyError,
          'Administrator access required.',
        ),
      },
      { status: 403 },
    )
  }

  // The normal path. The RPC's success, application ID and stored status must
  // all agree with the requested decision.
  if (!rpcError && !thrownError && confirmedByRpc(result, id, expectedStatus)) {
    return successResponse(id, decision, expectedStatus)
  }

  // Anything else is ambiguous: an RPC error, a lost response, a malformed
  // payload, a mismatched ID/status, or an unexpected array shape. Never
  // resubmit. Read the persisted row and let the database state decide.
  const persisted = await readPersistedApplication(supabase, id)
  const failure = rpcError ?? thrownError ?? bodyError
  const rpcFailureMessage =
    rpcError || thrownError
      ? errorMessage(rpcError ?? thrownError, 'The review could not be completed.')
      : bodyError || null

  if (persisted.error) {
    if (rpcFailureMessage) {
      return NextResponse.json(
        {
          error: `${rpcFailureMessage} The persisted result could not be confirmed.`,
        },
        { status: isTransportError(failure) ? 502 : 400 },
      )
    }

    return NextResponse.json(
      {
        error:
          'The review result could not be confirmed. Refresh the list before retrying.',
      },
      { status: 502 },
    )
  }

  const application = persisted.application
  if (!application) {
    return NextResponse.json(
      {
        error: 'Application not found. The review was not confirmed.',
        status: 'missing',
        application: null,
      },
      { status: 404 },
    )
  }

  if (String(application.id ?? '') !== id) {
    return NextResponse.json(
      {
        error:
          'The persisted review could not be matched to this application. Refresh the list before retrying.',
      },
      { status: 502 },
    )
  }

  const actualStatus = application.status

  // The database is the source of truth. A persisted expected status confirms
  // the decision even when the RPC response was lost or malformed.
  if (actualStatus === expectedStatus) {
    return successResponse(id, decision, expectedStatus, application)
  }

  if (actualStatus === 'pending') {
    const message = rpcFailureMessage
      ? `${rpcFailureMessage} The application is still pending; the review was not confirmed. You can retry.`
      : 'The review result could not be confirmed. The application is still pending. You can retry.'

    return notConfirmedResponse(
      message,
      application,
      isTransportError(failure) || !failure ? 502 : 400,
    )
  }

  const actualLabel = String(actualStatus ?? 'in an unknown state')
  return NextResponse.json(
    {
      error: `This application is already ${actualLabel}.`,
      status: actualStatus ?? null,
      application,
    },
    { status: 409 },
  )
}
