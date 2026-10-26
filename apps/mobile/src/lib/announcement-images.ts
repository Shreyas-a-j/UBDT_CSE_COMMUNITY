/**
 * Pick and upload announcement images through the website's faculty-gated
 * `/api/announcements/upload` route.
 *
 * The app deliberately does not use the anonymous avatar upload route: this
 * one re-checks the caller's approved-faculty profile and writes under
 * `announcements/`. Images are uploaded as originals, within the same 5 MB and
 * MIME limits the website enforces.
 */

import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';

import {
  ANNOUNCEMENT_MAX_IMAGES,
  announcementImageName,
  imageMimeType,
  validateAnnouncementImage,
} from './announcement-image-rules';
import { websiteJson } from './website-api';

export interface PickedAnnouncementImage {
  id: string;
  uri: string;
  name: string;
  type: string;
}

interface UploadResponse {
  publicUrl?: unknown;
  key?: unknown;
  error?: unknown;
}

async function sizeForAsset(asset: ImagePicker.ImagePickerAsset): Promise<number> {
  if (typeof asset.fileSize === 'number' && asset.fileSize > 0) return asset.fileSize;
  const info = await FileSystem.getInfoAsync(asset.uri);
  return info.exists && typeof info.size === 'number' ? info.size : 0;
}

/**
 * Opens the system photo picker and returns validated local assets.
 *
 * `remaining` is the number of attachment slots left, so the picker can never
 * produce more images than the announcement can hold.
 */
export async function pickAnnouncementImages(
  remaining: number
): Promise<{ images: PickedAnnouncementImage[]; error: string | null }> {
  const limit = Math.max(0, Math.min(remaining, ANNOUNCEMENT_MAX_IMAGES));
  if (limit === 0) return { images: [], error: 'You can attach up to four images.' };

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: true,
    selectionLimit: limit,
    quality: 1,
    exif: false,
  });

  if (result.canceled) return { images: [], error: null };

  const images: PickedAnnouncementImage[] = [];
  for (const [index, asset] of result.assets.slice(0, limit).entries()) {
    const type = imageMimeType(asset);
    if (!type) {
      return {
        images,
        error:
          'Only PNG, JPEG, WebP and GIF images can be attached. Pick a different image.',
      };
    }

    const size = await sizeForAsset(asset);
    const validationError = validateAnnouncementImage({ type, size });
    if (validationError) return { images, error: validationError };

    images.push({
      id: `${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
      uri: asset.uri,
      name: announcementImageName(type, index, asset.fileName),
      type,
    });
  }

  return { images, error: null };
}

/** Upload one picked image and return its public R2 URL. */
export async function uploadAnnouncementImage(
  image: PickedAnnouncementImage
): Promise<string> {
  const validationError = validateAnnouncementImage({
    type: image.type,
    // The picker already checked the native file; the server repeats the
    // authoritative size/type check against the uploaded bytes.
    size: 1,
  });
  if (validationError) throw new Error(validationError);

  const form = new FormData();
  // React Native's FormData accepts this file descriptor shape. It streams the
  // file to OkHttp rather than reading it into JS memory.
  form.append('file', {
    uri: image.uri,
    name: image.name,
    type: image.type,
  } as unknown as Blob);

  const payload = await websiteJson<UploadResponse>('/api/announcements/upload', {
    method: 'POST',
    body: form,
  });

  if (typeof payload.publicUrl !== 'string' || !/^https:\/\//i.test(payload.publicUrl)) {
    throw new Error('The upload succeeded but the website did not return an image URL.');
  }
  return payload.publicUrl;
}
