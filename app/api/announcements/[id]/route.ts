import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { announcementKeyFromPublicUrl, deleteR2Object, r2Config } from '@/lib/r2'

const GONE_MESSAGE = 'This announcement is already gone.'
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Defensive parser for `announcements.image_urls`. The column is normally a
 * text array, but an old or hand-edited row must never crash the route.
 */
function parseImageUrls(value: unknown): string[] {
  let candidate: unknown = value
  if (typeof value === 'string') {
    try {
      candidate = JSON.parse(value)
    } catch {
      return []
    }
  }
  if (!Array.isArray(candidate)) return []
  return candidate.filter(
    (item): item is string => typeof item === 'string' && item.trim().length > 0
  )
}

/**
 * Shape-only key detector used when storage configuration is missing. It lets
 * the route report "candidate images failed" without knowing the bucket
 * domain, while still refusing traversal or non-announcement paths.
 */
function announcementKeyShape(url: string): string | null {
  if (!url || url.includes('\\') || url.includes('?') || url.includes('#')) return null
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:') return null
  if (!parsed.pathname.startsWith('/announcements/')) return null
  const key = parsed.pathname.slice(1)
  if (key.includes('..')) return null
  return key
}

/**
 * Deletes an announcement and then best-effort removes its R2 images.
 *
 * The row is deleted through the caller-scoped client, so the existing RLS
 * policy (author or admin) remains a second authorization layer. The row is
 * removed before object cleanup: a storage outage must never leave a row that
 * cannot be deleted. Image failures are reported in the response, not as a
 * request failure.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: rawId } = await params
  const id = typeof rawId === 'string' ? rawId.trim() : ''
  if (!id || !UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: 'Invalid announcement id.' }, { status: 400 })
  }

  const supabase = await createClient()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Sign in to delete an announcement.' }, { status: 401 })
  }

  const { data: row, error: readError } = await supabase
    .from('announcements')
    .select('id, author_id, image_urls')
    .eq('id', id)
    .maybeSingle()

  if (readError) {
    return NextResponse.json({ error: 'Could not read the announcement.' }, { status: 500 })
  }
  if (!row) {
    return NextResponse.json({ error: GONE_MESSAGE }, { status: 404 })
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()

  if (profileError) {
    return NextResponse.json({ error: 'Could not verify your account.' }, { status: 500 })
  }

  const authorId = typeof row.author_id === 'string' ? row.author_id : ''
  const isAdmin = profile?.role === 'admin'
  if (user.id !== authorId && !isAdmin) {
    return NextResponse.json(
      { error: 'You cannot delete this announcement.' },
      { status: 403 }
    )
  }

  const { data: deleted, error: deleteError } = await supabase
    .from('announcements')
    .delete()
    .eq('id', id)
    .select('id')

  if (deleteError) {
    return NextResponse.json({ error: 'Could not delete the announcement.' }, { status: 500 })
  }
  if (!Array.isArray(deleted) || deleted.length === 0) {
    // PostgREST reports a policy-filtered DELETE as 200 with zero rows, not
    // as an error. If the row is still readable, the delete did NOT happen
    // (missing DELETE policy, grant, or a trigger); reporting "already gone"
    // here made the UI hide a row that still exists. Only a row that is
    // genuinely absent is a 404.
    const { data: stillThere, error: recheckError } = await supabase
      .from('announcements')
      .select('id')
      .eq('id', id)
      .maybeSingle()

    if (recheckError) {
      return NextResponse.json(
        { error: 'Could not confirm the announcement was deleted.' },
        { status: 500 }
      )
    }
    if (stillThere) {
      return NextResponse.json(
        {
          error:
            'The announcement could not be deleted. It is still in the database; refresh and try again.',
        },
        { status: 409 }
      )
    }
    return NextResponse.json({ error: GONE_MESSAGE }, { status: 404 })
  }

  const config = r2Config()
  const urls = parseImageUrls(row.image_urls)
  let imagesDeleted = 0
  let imagesFailed = 0
  let imagesSkipped = 0
  let imageCleanupError: string | null = null

  for (const url of urls) {
    if (!config) {
      if (announcementKeyShape(url)) {
        imagesFailed += 1
        imageCleanupError = 'Server storage configuration is missing.'
      } else {
        imagesSkipped += 1
      }
      continue
    }

    const key = announcementKeyFromPublicUrl(url, config.publicDomain)
    if (!key) {
      imagesSkipped += 1
      continue
    }

    const result = await deleteR2Object(config, key)
    if (result.ok) {
      imagesDeleted += 1
    } else {
      imagesFailed += 1
      if (!imageCleanupError) imageCleanupError = result.error
    }
  }

  return NextResponse.json({
    deleted: true,
    imagesDeleted,
    imagesFailed,
    imagesSkipped,
    imageCleanupError,
  })
}
