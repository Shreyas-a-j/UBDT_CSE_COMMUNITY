import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { canPublishAnnouncements, normalizeImageUrls } from '@/lib/logic/announcements'
import { sanitizeText } from '@/lib/validation'

const ANNOUNCEMENT_EMBED = `
  *,
  author:profiles!author_id (name, avatar_url, designation),
  reactions:announcement_reactions (user_id, reaction, created_at)
`

interface PublishBody {
  title?: unknown
  body?: unknown
  image_urls?: unknown
}

/**
 * Publishes a faculty announcement.
 *
 * Authorization is decided here, on the server, from the caller's database
 * profile — never from anything the client sends. `profiles.role` and
 * `profiles.faculty_status` are protected by the protect_profile_privileges()
 * trigger, so a member cannot self-escalate. The announcements RLS insert
 * policy (`auth.uid() = author_id and is_verified_faculty(auth.uid())`) is the
 * second, independent layer.
 */
export async function POST(request: Request) {
  const supabase = await createClient()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Sign in to publish an announcement.' }, { status: 401 })
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role, faculty_status')
    .eq('id', user.id)
    .maybeSingle()

  if (profileError) {
    return NextResponse.json(
      { error: 'Could not verify your account. Try again.' },
      { status: 500 }
    )
  }

  if (!canPublishAnnouncements(profile)) {
    return NextResponse.json(
      { error: 'Only approved faculty can publish announcements.' },
      { status: 403 }
    )
  }

  let payload: PublishBody
  try {
    payload = (await request.json()) as PublishBody
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const title = sanitizeText(typeof payload.title === 'string' ? payload.title : '', 200)
  const body = sanitizeText(typeof payload.body === 'string' ? payload.body : '', 5000)

  if (!title) {
    return NextResponse.json({ error: 'A title is required.' }, { status: 400 })
  }
  if (!body) {
    return NextResponse.json({ error: 'A message is required.' }, { status: 400 })
  }

  // normalizeImageUrls drops anything that is not an http(s) URL and caps the
  // list at four; reject a non-empty list that became empty rather than
  // silently publishing an announcement missing its attachments.
  const rawImages = Array.isArray(payload.image_urls) ? payload.image_urls : []
  const imageUrls = normalizeImageUrls(rawImages)
  if (rawImages.length > 0 && imageUrls.length === 0) {
    return NextResponse.json({ error: 'The attached images are not valid URLs.' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('announcements')
    .insert({ author_id: user.id, title, body, image_urls: imageUrls })
    .select(ANNOUNCEMENT_EMBED)
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  return NextResponse.json({ announcement: data }, { status: 201 })
}
