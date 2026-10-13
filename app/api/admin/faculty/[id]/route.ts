import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params
  const body = (await request.json().catch(() => ({}))) as { decision?: string; notes?: string }
  const decision = body.decision === 'approved' || body.decision === 'rejected' ? body.decision : null
  if (!decision) {
    return NextResponse.json({ error: 'Decision must be approved or rejected.' }, { status: 400 })
  }

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
    .update({
      status: decision,
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
      notes: body.notes?.slice(0, 500) ?? null,
    })
    .eq('id', id)
    .eq('status', 'pending')
    .select()
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  if (!data) return NextResponse.json({ error: 'Application not found or already reviewed.' }, { status: 404 })
  return NextResponse.json({ application: data })
}
