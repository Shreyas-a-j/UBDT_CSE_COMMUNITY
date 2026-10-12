interface SignedUrlResponse {
  uploadUrl: string;
  publicUrl: string;
  key: string;
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
      const { uploadUrl, publicUrl }: SignedUrlResponse = await response.json();

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

  const result = await fallbackResponse.json();
  return result.publicUrl;
}
