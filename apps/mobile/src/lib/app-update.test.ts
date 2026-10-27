import { describe, expect, it, vi } from 'vitest';

import {
  checkForUpdate,
  compareVersions,
  evaluateUpdate,
  parseUpdateManifest,
  resolveUpdateManifestUrl,
  shouldShowUpdate,
  updatePromptReducer,
  type AvailableUpdate,
  type UpdateManifest,
} from './app-update';

const manifest: UpdateManifest = {
  version: '1.2.0',
  versionCode: 12,
  apkUrl: 'https://pub-984d3335c03543f6bbddf6400b88a737.r2.dev/app/ucc-android-v1.2.0.apk',
  releaseNotes: ['Faster feed loading.', 'Fixed notification routing.'],
  mandatory: false,
};

const installed = { version: '1.1.0', versionCode: 11 };

const update: AvailableUpdate = { manifest, installed };

describe('compareVersions', () => {
  it('orders ordinary release versions numerically', () => {
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.0.1', '1.0.0')).toBe(1);
    expect(compareVersions('1.0.0', '1.0.1')).toBe(-1);
    expect(compareVersions('1.10.0', '1.9.9')).toBe(1);
    expect(compareVersions('2.0', '1.99.99')).toBe(1);
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
  });

  it('treats a prerelease as older than the matching release', () => {
    expect(compareVersions('1.0.0-beta.2', '1.0.0')).toBe(-1);
    expect(compareVersions('1.0.0', '1.0.0-beta.2')).toBe(1);
    expect(compareVersions('1.0.0-beta.10', '1.0.0-beta.2')).toBe(1);
    expect(compareVersions('1.0.0-beta', '1.0.0-alpha')).toBe(1);
  });

  it('rejects values that are not version numbers', () => {
    expect(() => compareVersions('latest', '1.0.0')).toThrow();
    expect(() => compareVersions('1.0.0', '')).toThrow();
    expect(() => compareVersions('1.0.0.0.0', '1.0.0')).toThrow();
  });
});

describe('parseUpdateManifest', () => {
  it('accepts a complete manifest and normalizes the APK URL', () => {
    expect(parseUpdateManifest(manifest)).toEqual(manifest);
  });

  it('rejects malformed payloads', () => {
    expect(() => parseUpdateManifest(null)).toThrow();
    expect(() => parseUpdateManifest([])).toThrow();
    expect(() => parseUpdateManifest({ ...manifest, version: undefined })).toThrow();
    expect(() => parseUpdateManifest({ ...manifest, versionCode: 0 })).toThrow();
    expect(() => parseUpdateManifest({ ...manifest, versionCode: 1.5 })).toThrow();
    expect(() => parseUpdateManifest({ ...manifest, releaseNotes: [] })).toThrow();
    expect(() => parseUpdateManifest({ ...manifest, releaseNotes: ['ok', ''] })).toThrow();
    expect(() => parseUpdateManifest({ ...manifest, mandatory: 'yes' })).toThrow();
  });

  it('rejects insecure, credentialed, or non-APK download URLs', () => {
    expect(() =>
      parseUpdateManifest({ ...manifest, apkUrl: 'http://example.com/ucc.apk' })
    ).toThrow();
    expect(() =>
      parseUpdateManifest({ ...manifest, apkUrl: 'https://user:pass@example.com/ucc.apk' })
    ).toThrow();
    expect(() =>
      parseUpdateManifest({ ...manifest, apkUrl: 'https://example.com/ucc.zip' })
    ).toThrow();
    expect(() =>
      parseUpdateManifest({ ...manifest, apkUrl: 'javascript:alert(1)' })
    ).toThrow();
  });
});

describe('evaluateUpdate', () => {
  it('returns an available update when the APK versionCode is newer', () => {
    expect(evaluateUpdate(manifest, installed)).toEqual(update);
  });

  it('does not offer the same, older, or misconfigured build', () => {
    expect(evaluateUpdate({ ...manifest, versionCode: 11 }, installed)).toBeNull();
    expect(evaluateUpdate({ ...manifest, versionCode: 10 }, installed)).toBeNull();
    expect(
      evaluateUpdate({ ...manifest, version: '1.0.0', versionCode: 12 }, installed)
    ).toBeNull();
  });
});

describe('shouldShowUpdate', () => {
  it('shows optional updates unless that version was dismissed this session', () => {
    expect(
      shouldShowUpdate(update, {
        dismissedVersionCodes: new Set(),
        initiatedVersionCodes: new Set(),
      })
    ).toBe(true);
    expect(
      shouldShowUpdate(update, {
        dismissedVersionCodes: new Set([12]),
        initiatedVersionCodes: new Set(),
      })
    ).toBe(false);
  });

  it('keeps showing mandatory updates until the update process is initiated', () => {
    const mandatory = { ...update, manifest: { ...manifest, mandatory: true } };
    expect(
      shouldShowUpdate(mandatory, {
        dismissedVersionCodes: new Set([12]),
        initiatedVersionCodes: new Set(),
      })
    ).toBe(true);
    expect(
      shouldShowUpdate(mandatory, {
        dismissedVersionCodes: new Set(),
        initiatedVersionCodes: new Set([12]),
      })
    ).toBe(false);
  });
});

describe('updatePromptReducer', () => {
  it('allows Later for an optional update', () => {
    const shown = updatePromptReducer(null, { type: 'show', update });
    expect(shown).toMatchObject({ phase: 'idle', error: null });
    expect(updatePromptReducer(shown, { type: 'dismiss' })).toBeNull();
  });

  it('never allows a mandatory update to be dismissed before installation starts', () => {
    const mandatory = { ...update, manifest: { ...manifest, mandatory: true } };
    const shown = updatePromptReducer(null, { type: 'show', update: mandatory });
    expect(updatePromptReducer(shown, { type: 'dismiss' })).toBe(shown);

    const opening = updatePromptReducer(shown, { type: 'download-started' });
    expect(opening?.phase).toBe('opening');
    expect(updatePromptReducer(opening, { type: 'dismiss' })).toBe(opening);

    const opened = updatePromptReducer(opening, { type: 'download-opened' });
    expect(opened?.phase).toBe('opened');
    expect(updatePromptReducer(opened, { type: 'continue' })).toBeNull();
  });

  it('allows retrying the download after the browser hand-off', () => {
    const shown = updatePromptReducer(null, { type: 'show', update });
    const opening = updatePromptReducer(shown, { type: 'download-started' });
    const opened = updatePromptReducer(opening, { type: 'download-opened' });
    expect(opened?.phase).toBe('opened');

    const retried = updatePromptReducer(opened, { type: 'download-started' });
    expect(retried?.phase).toBe('opening');
    expect(retried?.error).toBeNull();
  });

  it('keeps the dialog open with an error when the download cannot be opened', () => {
    const shown = updatePromptReducer(null, { type: 'show', update });
    const opening = updatePromptReducer(shown, { type: 'download-started' });
    const failed = updatePromptReducer(opening, {
      type: 'download-failed',
      message: 'Could not open the download.',
    });
    expect(failed).toMatchObject({
      phase: 'idle',
      error: 'Could not open the download.',
    });
  });

  it('ignores out-of-order events', () => {
    const shown = updatePromptReducer(null, { type: 'show', update });
    expect(updatePromptReducer(shown, { type: 'download-opened' })).toBe(shown);
    expect(updatePromptReducer(shown, { type: 'continue' })).toBe(shown);
    expect(updatePromptReducer(null, { type: 'download-started' })).toBeNull();
  });
});

describe('resolveUpdateManifestUrl', () => {
  it('defaults to the public R2 manifest and accepts an HTTPS override', () => {
    expect(resolveUpdateManifestUrl(undefined)).toBe(
      'https://pub-984d3335c03543f6bbddf6400b88a737.r2.dev/app/android-update.json'
    );
    expect(
      resolveUpdateManifestUrl(
        'https://updates.example.com/ucc/android.json'
      )
    ).toBe('https://updates.example.com/ucc/android.json');
  });

  it('rejects insecure or credentialed manifest URLs', () => {
    expect(() =>
      resolveUpdateManifestUrl('http://example.com/android.json')
    ).toThrow();
    expect(() =>
      resolveUpdateManifestUrl('https://user:pass@example.com/android.json')
    ).toThrow();
    expect(() => resolveUpdateManifestUrl(undefined, 'http://example.com')).toThrow();
  });
});

describe('checkForUpdate', () => {
  function response(body: unknown, init: ResponseInit = {}) {
    return new Response(JSON.stringify(body), {
      headers: { 'content-type': 'application/json' },
      ...init,
    });
  }

  it('returns the available update for a valid manifest', async () => {
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => response(manifest)
    );
    const result = await checkForUpdate({
      manifestUrl: 'https://example.com/android.json',
      installed,
      fetchImpl,
    });

    expect(result).toEqual({ status: 'available', update });
    const requestUrl = String(fetchImpl.mock.calls[0][0]);
    expect(requestUrl).toContain('https://example.com/android.json');
    expect(requestUrl).toMatch(/[?&]_=\d+/);
  });

  it('returns up-to-date when the installed build is current', async () => {
    const fetchImpl = vi.fn(async () => response({ ...manifest, versionCode: 11, version: '1.1.0' }));
    const result = await checkForUpdate({
      manifestUrl: 'https://example.com/android.json',
      installed,
      fetchImpl,
    });
    expect(result).toEqual({ status: 'up-to-date' });
  });

  it('fails open when the server is unreachable', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Network request failed');
    });
    const result = await checkForUpdate({
      manifestUrl: 'https://example.com/android.json',
      installed,
      fetchImpl,
    });
    expect(result).toMatchObject({ status: 'unavailable', reason: 'network' });
  });

  it('fails open on timeouts', async () => {
    const fetchImpl = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const error = new Error('Aborted');
            error.name = 'AbortError';
            reject(error);
          });
        })
    );
    const result = await checkForUpdate({
      manifestUrl: 'https://example.com/android.json',
      installed,
      fetchImpl,
      timeoutMs: 5,
    });
    expect(result).toMatchObject({ status: 'unavailable', reason: 'timeout' });
  });

  it('fails open on non-OK responses and unreadable JSON', async () => {
    const notFound = await checkForUpdate({
      manifestUrl: 'https://example.com/android.json',
      installed,
      fetchImpl: vi.fn(async () => new Response('missing', { status: 404 })),
    });
    expect(notFound).toMatchObject({ status: 'unavailable', reason: 'server' });

    const notJson = await checkForUpdate({
      manifestUrl: 'https://example.com/android.json',
      installed,
      fetchImpl: vi.fn(async () => new Response('<html>oops</html>', { status: 200 })),
    });
    expect(notJson).toMatchObject({ status: 'unavailable', reason: 'invalid-response' });
  });

  it('fails open on an invalid manifest payload', async () => {
    const result = await checkForUpdate({
      manifestUrl: 'https://example.com/android.json',
      installed,
      fetchImpl: vi.fn(async () => response({ ...manifest, apkUrl: 'http://example.com/ucc.apk' })),
    });
    expect(result).toMatchObject({ status: 'unavailable', reason: 'invalid-manifest' });
  });

  it('fails open when the manifest URL is insecure', async () => {
    const fetchImpl = vi.fn();
    const result = await checkForUpdate({
      manifestUrl: 'http://example.com/android.json',
      installed,
      fetchImpl,
    });
    expect(result).toMatchObject({ status: 'unavailable', reason: 'configuration' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
