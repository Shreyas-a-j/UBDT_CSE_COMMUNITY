/**
 * Announcement image rules — ported from the website's
 * `lib/logic/announcements.ts` so the mobile picker rejects exactly what the
 * faculty-gated server upload route rejects.
 */

export const ANNOUNCEMENT_MAX_IMAGES = 4;
export const ANNOUNCEMENT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const ANNOUNCEMENT_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
] as const;

export type AnnouncementImageType = (typeof ANNOUNCEMENT_IMAGE_TYPES)[number];

/** Human-readable reason a file cannot be attached, or null when it can. */
export function validateAnnouncementImage(file: {
  type?: string;
  size?: number;
}): string | null {
  const type = (file.type ?? '').toLowerCase();
  if (!(ANNOUNCEMENT_IMAGE_TYPES as readonly string[]).includes(type)) {
    return 'Only PNG, JPEG, WebP and GIF images can be attached.';
  }
  const size = typeof file.size === 'number' ? file.size : 0;
  if (size <= 0) return 'That image looks empty. Pick a different file.';
  if (size > ANNOUNCEMENT_IMAGE_MAX_BYTES) {
    return `Images must be 5 MB or smaller (this one is ${(size / (1024 * 1024)).toFixed(1)} MB).`;
  }
  return null;
}

/** Keeps only well-formed public URLs, at most four. */
export function normalizeImageUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const urls = value.filter(
    (item): item is string => typeof item === 'string' && /^https?:\/\/\S+$/i.test(item.trim())
  );
  return urls.slice(0, ANNOUNCEMENT_MAX_IMAGES).map((url) => url.trim());
}

const MIME_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

const EXTENSION_MIME: Record<string, AnnouncementImageType> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};

/** MIME type for a picker asset, using its name/URI when Android omits it. */
export function imageMimeType(asset: {
  mimeType?: string | null;
  fileName?: string | null;
  uri?: string | null;
}): AnnouncementImageType | null {
  const declared = asset.mimeType?.toLowerCase();
  if (declared && (ANNOUNCEMENT_IMAGE_TYPES as readonly string[]).includes(declared)) {
    return declared as AnnouncementImageType;
  }

  const source = asset.fileName || asset.uri || '';
  const extension = source.split('?')[0]?.split('.').pop()?.toLowerCase() ?? '';
  return EXTENSION_MIME[extension] ?? null;
}

export function extensionForImageType(type: AnnouncementImageType): string {
  return MIME_EXTENSIONS[type] ?? 'jpg';
}

export function announcementImageName(
  type: AnnouncementImageType,
  index: number,
  originalName?: string | null
): string {
  const extension = extensionForImageType(type);
  const base =
    originalName
      ?.replace(/\.[^.]+$/, '')
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || `announcement-${index + 1}`;
  return `${base}.${extension}`;
}
