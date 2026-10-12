import { encode, decode } from 'thumbhash';

/**
 * Resize an image file to max dimensions (width/height) while maintaining aspect ratio,
 * convert to WebP format with the given quality, and generate a ThumbHash token.
 * Returns a Promise resolving to an object containing the WebP Blob and the thumbHash string.
 */
export async function compressAndTokenize(file: File, maxDim = 1200, quality = 0.7): Promise<{ blob: Blob; thumbHash: string }> {
  // Load image into an HTMLImageElement
  const img = await loadImage(file);

  // Compute target dimensions
  const { width, height } = getScaledDimensions(img.naturalWidth, img.naturalHeight, maxDim);

  // Draw to canvas
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context not available');
  ctx.drawImage(img, 0, 0, width, height);

  // Get image data for thumbhash
  const imageData = ctx.getImageData(0, 0, width, height);
  const thumbHashBytes = encode(imageData.data, width, height);
  const thumbHash = Buffer.from(thumbHashBytes).toString('base64'); // ~30 chars

  // Convert canvas to WebP Blob
  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (b) resolve(b);
        else reject(new Error('WebP conversion failed'));
      },
      'image/webp',
      quality
    );
  });

  return { blob, thumbHash };
}

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

function getScaledDimensions(origW: number, origH: number, maxDim: number): { width: number; height: number } {
  if (origW <= maxDim && origH <= maxDim) return { width: origW, height: origH };
  const aspect = origW / origH;
  if (aspect >= 1) {
    return { width: maxDim, height: Math.round(maxDim / aspect) };
  } else {
    return { width: Math.round(maxDim * aspect), height: maxDim };
  }
}

/**
 * Convert a ThumbHash base64 string back to a PNG data URL for placeholder rendering.
 */
export function thumbHashToDataURL(thumbHash: string): string {
  const bytes = Uint8Array.from(Buffer.from(thumbHash, 'base64'));
  const { width, height, rgba } = decode(bytes);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context not available');
  const imgData = ctx.createImageData(width, height);
  imgData.data.set(rgba);
  ctx.putImageData(imgData, 0, 0);
  return canvas.toDataURL('image/png');
}
