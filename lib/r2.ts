/**
 * Cloudflare R2 helpers shared by the announcement upload and delete routes.
 *
 * Credentials are read from the server environment and never leave this
 * module's return value. Callers must not log the config object.
 */
import { AwsClient } from 'aws4fetch'

export interface R2Config {
  accessKeyId: string
  secretAccessKey: string
  accountId: string
  bucketName: string
  publicDomain: string
}

/** Parses the R2 environment exactly as the upload route always has. */
export function r2Config(): R2Config | null {
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

/** The S3-compatible object URL for a key inside the configured bucket. */
export function r2ObjectEndpoint(config: R2Config, key: string): string {
  return `https://${config.accountId}.r2.cloudflarestorage.com/${config.bucketName}/${key}`
}

function normalizeDomain(publicDomain: string): string {
  return publicDomain
    .replace(/[<>]/g, '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '')
    .toLowerCase()
}

/**
 * Extracts the `announcements/<key>` object key from a public URL.
 *
 * Returns null for any URL that is not exactly on the configured public
 * domain, does not live under `announcements/`, or carries a query string,
 * fragment, backslash, or traversal segment. The caller counts a null as
 * "skipped", not as a storage failure.
 */
export function announcementKeyFromPublicUrl(
  url: string,
  publicDomain: string
): string | null {
  if (typeof url !== 'string' || !url) return null
  const domain = normalizeDomain(publicDomain)
  if (!domain) return null

  // Reject raw query/fragment/backslash before URL parsing normalizes them.
  if (url.includes('\\') || url.includes('?') || url.includes('#')) return null

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }

  if (parsed.protocol !== 'https:') return null
  if (parsed.host.toLowerCase() !== domain) return null
  if (!parsed.pathname.startsWith('/announcements/')) return null

  const key = parsed.pathname.slice(1)
  if (!key.startsWith('announcements/')) return null

  let decoded = key
  try {
    decoded = decodeURIComponent(key)
  } catch {
    return null
  }
  if (decoded.includes('\\') || decoded.includes('..')) return null

  const segments = decoded.split('/')
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) {
    return null
  }

  return key
}

/** Best-effort object deletion. Never throws and never logs credentials. */
export async function deleteR2Object(
  config: R2Config,
  key: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const aws = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: 's3',
    region: 'auto',
  })

  try {
    const response = await aws.fetch(r2ObjectEndpoint(config, key), { method: 'DELETE' })
    if (!response.ok) {
      return { ok: false, error: `Storage delete failed (${response.status}).` }
    }
    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? `Storage delete failed: ${error.message}` : 'Storage delete failed.',
    }
  }
}
