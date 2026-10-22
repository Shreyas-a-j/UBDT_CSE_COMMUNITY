import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { normalizeEmailVerificationRows } from '@/lib/logic/emailVerification'

const ADMIN_PROFILE_COLUMNS =
  'id, name, avatar_url, role, faculty_status, designation, employee_id, member_type, branch, created_at'

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (profile?.role !== 'admin') {
    return NextResponse.json({ error: 'Administrator access required.' }, { status: 403 })
  }

  const { data, error } = await supabase
    .from('faculty_applications')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  const applications = data ?? []
  const userIds = Array.from(new Set(applications.map(application => application.user_id)))

  let profiles: Record<string, unknown>[] = []
  let emailVerified: Record<string, boolean> = {}
  let emailVerificationError: string | null = null

  if (userIds.length > 0) {
    // Admin RLS allows reading every applicant's profile. Selecting only the
    // display fields keeps this endpoint from widening the public profile
    // surface; the official email already comes from the application row.
    const { data: profileRows, error: profileError } = await supabase
      .from('profiles')
      .select(ADMIN_PROFILE_COLUMNS)
      .in('id', userIds)

    if (profileError) {
      return NextResponse.json({ error: profileError.message }, { status: 400 })
    }
    profiles = (profileRows ?? []) as Record<string, unknown>[]

    // Verification is read from Supabase Auth via a SECURITY DEFINER RPC. If a
    // database has not received migration 2026102212 yet, keep the review
    // list usable and report the missing status rather than failing the page.
    const { data: verificationRows, error: verificationError } = await supabase.rpc(
      'get_email_verification_status',
      { target_user_ids: userIds },
    )

    if (verificationError) {
      emailVerificationError = verificationError.message
    } else {
      emailVerified = normalizeEmailVerificationRows(verificationRows)
    }
  }

  return NextResponse.json({
    applications,
    profiles,
    emailVerified,
    emailVerificationError,
  })
}
