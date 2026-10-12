import { rgbaToThumbHash, thumbHashToRGBA } from 'thumbhash';

/**
 * Resize an image file to max dimensions while maintaining aspect ratio,
 * convert to WebP, and generate a ThumbHash string.
 * Returns { blob, thumbHash } where thumbHash is base64-encoded.
 */
export async function compressAndTokenize(
  file: File,
  maxDim = 1200,
  quality = 0.7
): Promise<{ blob: Blob; thumbHash: string }> {
  const img = await loadImage(file);

  // --- 1. Full-size WebP (for upload) ---
  const { width, height } = getScaledDimensions(
    img.naturalWidth,
    img.naturalHeight,
    maxDim
  );

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context not available');
  ctx.drawImage(img, 0, 0, width, height);

  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('WebP conversion failed'))),
      'image/webp',
      quality
    );
  });

  // --- 2. Tiny thumbnail for ThumbHash ---
  const thumbHash = await generateThumbHash(img);

  return { blob, thumbHash };
}

/**
 * Generate a base64-encoded ThumbHash from an image.
 * Downscales to max 100px (ThumbHash best practice).
 */
async function generateThumbHash(img: HTMLImageElement): Promise<string> {
  const maxSize = 100;
  const scale = Math.min(1, maxSize / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context not available');
  ctx.drawImage(img, 0, 0, w, h);

  const { data: rgba } = ctx.getImageData(0, 0, w, h);
  const hashBytes = rgbaToThumbHash(w, h, rgba);

  // Base64-encode without Node's Buffer
  let binary = '';
  for (let i = 0; i < hashBytes.length; i++) {
    binary += String.fromCharCode(hashBytes[i]);
  }
  return btoa(binary);
}

/**
 * Convert a base64 ThumbHash string back to a PNG data URL for placeholder rendering.
 */
export function thumbHashToDataURL(thumbHash: string): string {
  const binary = atob(thumbHash);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  const { w, h, rgba } = thumbHashToRGBA(bytes);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context not available');

  const imgData = ctx.createImageData(w, h);
  imgData.data.set(rgba);
  ctx.putImageData(imgData, 0, 0);
  return canvas.toDataURL('image/png');
}

// ---------- helpers ----------

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}

function getScaledDimensions(
  origW: number,
  origH: number,
  maxDim: number
): { width: number; height: number } {
  if (origW <= maxDim && origH <= maxDim) return { width: origW, height: origH };
  const aspect = origW / origH;
  if (aspect >= 1) {
    return { width: maxDim, height: Math.round(maxDim / aspect) };
  }
  return { width: Math.round(maxDim * aspect), height: maxDim };
}