interface SignedUrlResponse {
  uploadUrl: string;
  publicUrl: string;
  key: string;
}

/** Shape of the server-side upload fallback response. */
interface R2UploadResponse {
  publicUrl?: unknown;
  key?: unknown;
}

function isR2UploadResponse(value: unknown): value is R2UploadResponse {
  return typeof value === 'object' && value !== null;
}

function isSignedUrlResponse(value: unknown): value is SignedUrlResponse {
  if (!isR2UploadResponse(value)) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.uploadUrl === 'string' &&
    typeof obj.publicUrl === 'string' &&
    typeof obj.key === 'string'
  );
}

/**
 * Uploads a WebP Blob to Cloudflare R2 via an Edge presigned URL endpoint.
 *
 * @param blob - The compressed WebP Blob
 * @param path - The desired filename or path identifier
 * @returns The CDN public URL of the uploaded asset
 */
export async function uploadToR2(blob: Blob, path: string): Promise<string> {
  const filename = path.split('/').pop() || `${Date.now()}.webp`;

  // 1. Attempt direct upload via presigned URL
  try {
    const response = await fetch('/api/r2-signed-url', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        filename,
        contentType: blob.type || 'image/webp',
      }),
    });

    if (response.ok) {
      const body: unknown = await response.json();
      if (!isSignedUrlResponse(body)) {
        throw new Error('Invalid signed-URL response from server');
      }
      const { uploadUrl, publicUrl } = body;

      const uploadResponse = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': blob.type || 'image/webp',
        },
        body: blob,
      });

      if (uploadResponse.ok) {
        return publicUrl;
      }
      console.warn(
        `Direct presigned PUT failed (${uploadResponse.status}). Attempting server upload fallback...`
      );
    }
  } catch (err) {
    console.warn(
      'Direct client-to-R2 upload failed (usually browser CORS not enabled on R2 bucket). Using server upload fallback:',
      err
    );
  }

  // 2. Server-side upload fallback (bypasses browser CORS restrictions completely)
  const formData = new FormData();
  formData.append('file', blob, filename);
  formData.append('filename', filename);

  const fallbackResponse = await fetch('/api/r2-upload', {
    method: 'POST',
    body: formData,
  });

  if (!fallbackResponse.ok) {
    const errorText = await fallbackResponse.text();
    throw new Error(`Upload failed (${fallbackResponse.status}): ${errorText}`);
  }

  const result: unknown = await fallbackResponse.json();
  if (!isR2UploadResponse(result) || typeof result.publicUrl !== 'string') {
    throw new Error('Invalid upload response from server');
  }
  return result.publicUrl;
}

/**
 * Uploads one announcement image through the faculty-gated server route
 * (`/api/announcements/upload`).
 *
 * The generic avatar endpoints are anonymous and always write `avatars/`
 * keys, so announcements use their own route: it re-checks the caller's
 * database role, validates the MIME type and size, and writes only under
 * `announcements/`.
 */
export async function uploadAnnouncementImage(blob: Blob, filename?: string): Promise<string> {
  const extension =
    blob.type === 'image/png'
      ? 'png'
      : blob.type === 'image/jpeg'
        ? 'jpg'
        : blob.type === 'image/gif'
          ? 'gif'
          : 'webp'
  const name = filename || `${Date.now()}.${extension}`

  const formData = new FormData()
  formData.append('file', blob, name)

  const response = await fetch('/api/announcements/upload', {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(payload?.error || `Upload failed (${response.status})`)
  }

  const result: unknown = await response.json()
  if (!isR2UploadResponse(result) || typeof result.publicUrl !== 'string') {
    throw new Error('Invalid upload response from server')
  }

  return result.publicUrl
}
