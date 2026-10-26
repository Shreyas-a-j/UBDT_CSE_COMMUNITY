import { describe, expect, it } from 'vitest';

import {
  ANNOUNCEMENT_IMAGE_MAX_BYTES,
  ANNOUNCEMENT_MAX_IMAGES,
  announcementImageName,
  extensionForImageType,
  imageMimeType,
  normalizeImageUrls,
  validateAnnouncementImage,
} from './announcement-image-rules';

describe('announcement image validation', () => {
  it('matches the server limits', () => {
    expect(ANNOUNCEMENT_MAX_IMAGES).toBe(4);
    expect(ANNOUNCEMENT_IMAGE_MAX_BYTES).toBe(5 * 1024 * 1024);
  });

  it('accepts the same PNG/JPEG/WebP/GIF formats as the upload route', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'IMAGE/PNG']) {
      expect(validateAnnouncementImage({ type, size: 1024 })).toBeNull();
    }
  });

  it('rejects unsupported formats, empty files and files over 5 MB', () => {
    expect(validateAnnouncementImage({ type: 'image/svg+xml', size: 1024 })).toBe(
      'Only PNG, JPEG, WebP and GIF images can be attached.'
    );
    expect(validateAnnouncementImage({ type: 'image/png', size: 0 })).toBe(
      'That image looks empty. Pick a different file.'
    );
    expect(
      validateAnnouncementImage({ type: 'image/png', size: ANNOUNCEMENT_IMAGE_MAX_BYTES + 1 })
    ).toContain('5 MB or smaller');
    expect(
      validateAnnouncementImage({ type: 'image/png', size: ANNOUNCEMENT_IMAGE_MAX_BYTES })
    ).toBeNull();
  });
});

describe('normalizeImageUrls', () => {
  it('keeps only http(s) URLs, trims them, and caps at four', () => {
    expect(
      normalizeImageUrls([
        ' https://cdn.example/a.png ',
        'http://cdn.example/b.png',
        'javascript:alert(1)',
        'data:image/png;base64,AAAA',
        42,
        null,
        'https://cdn.example/c.png',
        'https://cdn.example/d.png',
        'https://cdn.example/e.png',
      ])
    ).toEqual([
      'https://cdn.example/a.png',
      'http://cdn.example/b.png',
      'https://cdn.example/c.png',
      'https://cdn.example/d.png',
    ]);
  });

  it('returns an empty list for non-arrays', () => {
    expect(normalizeImageUrls(undefined)).toEqual([]);
    expect(normalizeImageUrls('https://cdn.example/a.png')).toEqual([]);
  });
});

describe('picker metadata fallbacks', () => {
  it('prefers a supported declared MIME type', () => {
    expect(imageMimeType({ mimeType: 'image/webp', fileName: 'photo.png' })).toBe('image/webp');
  });

  it('falls back to the filename or URI extension when Android omits the type', () => {
    expect(imageMimeType({ mimeType: null, fileName: 'photo.PNG' })).toBe('image/png');
    expect(imageMimeType({ uri: 'file:///cache/upload.jpeg?token=1' })).toBe('image/jpeg');
    expect(imageMimeType({ mimeType: 'image/svg+xml', fileName: 'drawing.gif' })).toBe('image/gif');
    expect(imageMimeType({ fileName: 'notes.txt' })).toBeNull();
  });

  it('builds safe upload names with the correct extension', () => {
    expect(extensionForImageType('image/jpeg')).toBe('jpg');
    expect(announcementImageName('image/jpeg', 0, 'My Photo!.jpeg')).toBe('My-Photo.jpg');
    expect(announcementImageName('image/png', 2)).toBe('announcement-3.png');
    expect(announcementImageName('image/gif', 1, '???.png')).toBe('announcement-2.gif');
  });
});
