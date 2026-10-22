import { NextRequest, NextResponse } from 'next/server'
import { AwsClient } from 'aws4fetch'
import { createClient } from '@/lib/supabase/server'
import { canPublishAnnouncements, validateAnnouncementImage } from '@/lib/logic/announcements'

/** File extensions for the accepted image types. */
const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

function r2Config() {
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.replace(/[<>]/g, '').trim()
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.replace(/[<>]/g, '').trim()
  const accountId = process.env.R2_ACCOUNT_ID?.replace(/[<>]/g, '').trim()
  const bucketName = process.env.R2_BUCKET_NAME?.replace(/[<>]/g, '').trim()
  const publicDomain = process.env.NEXT_PUBLIC_R2_PUBLIC_DOMAIN?.replace(/[<>]/g, '').trim()

  if (!accessKeyId || !secretAccessKey || !accountId || !bucketName || !publicDomain) {
    return null
  }

  return { accessKeyId, secretAccessKey, accountId, bucketName, publicDomain }
}

/**
 * Uploads one announcement image to Cloudflare R2.
 *
 * Reuses the existing R2 architecture (the project has no Supabase Storage
 * bucket) but is deliberately separate from the older anonymous avatar
 * endpoints: this route requires a signed-in verified-faculty member, validates
 * the MIME type and the 5 MB limit, and writes only under `announcements/`.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Sign in to upload an image.' }, { status: 401 })
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role, faculty_status')
    .eq('id', user.id)
    .maybeSingle()

  if (profileError) {
    return NextResponse.json({ error: 'Could not verify your account.' }, { status: 500 })
  }

  if (!canPublishAnnouncements(profile)) {
    return NextResponse.json(
      { error: 'Only approved faculty can upload announcement images.' },
      { status: 403 }
    )
  }

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid upload request.' }, { status: 400 })
  }

  const file = formData.get('file')
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: 'No image provided.' }, { status: 400 })
  }

  const validationError = validateAnnouncementImage(file)
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 })
  }

  const config = r2Config()
  if (!config) {
    return NextResponse.json({ error: 'Server storage configuration is missing.' }, { status: 500 })
  }

  const extension = EXTENSIONS[file.type.toLowerCase()] ?? 'webp'
  const key = `announcements/${crypto.randomUUID()}.${extension}`

  const aws = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: 's3',
    region: 'auto',
  })

  const endpoint = `https://${config.accountId}.r2.cloudflarestorage.com/${config.bucketName}/${key}`

  try {
    const bytes = await file.arrayBuffer()
    const upload = await aws.fetch(endpoint, {
      method: 'PUT',
      headers: {
        'Content-Type': file.type,
        // R2 rejects chunked PutObject requests with 411 MissingContentLength.
        // Next's patched fetch sends an ArrayBuffer body chunked unless this is
        // explicit (aws4fetch excludes content-length from the signature).
        'Content-Length': String(bytes.byteLength),
      },
      body: bytes,
    })

    if (!upload.ok) {
      const detail = await upload.text()
      return NextResponse.json(
        { error: `Image upload failed (${upload.status}): ${detail}` },
        { status: 502 }
      )
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: `Image upload failed: ${message}` }, { status: 502 })
  }

  const cleanDomain = config.publicDomain.replace(/^https?:\/\//, '').replace(/\/$/, '')

  return NextResponse.json({ publicUrl: `https://${cleanDomain}/${key}`, key })
}
