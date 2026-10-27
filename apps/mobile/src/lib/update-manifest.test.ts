import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { parseUpdateManifest, resolveUpdateManifestUrl } from './app-update';

/**
 * Release guard: the checked-in manifest is what gets uploaded to R2 beside
 * the APK. If it drifts from app.json, the app could offer the wrong build or
 * point at a file that was never published.
 */
describe('checked-in Android update manifest', () => {
  const appConfig = JSON.parse(
    readFileSync(new URL('../../app.json', import.meta.url), 'utf8')
  ) as {
    expo: {
      version: string;
      android: { versionCode: number; package: string };
    };
  };
  const manifest = parseUpdateManifest(
    JSON.parse(
      readFileSync(
        new URL('../../update/android-update.json', import.meta.url),
        'utf8'
      )
    )
  );

  it('matches the version and versionCode in app.json', () => {
    expect(manifest.version).toBe(appConfig.expo.version);
    expect(manifest.versionCode).toBe(appConfig.expo.android.versionCode);
  });

  it('points at the direct public APK for this release', () => {
    const apkUrl = new URL(manifest.apkUrl);
    expect(apkUrl.protocol).toBe('https:');
    expect(apkUrl.pathname).toBe(
      `/app/ucc-android-v${manifest.version}.apk`
    );
  });

  it('uses the public R2 manifest endpoint by default', () => {
    expect(resolveUpdateManifestUrl(undefined)).toBe(
      'https://pub-984d3335c03543f6bbddf6400b88a737.r2.dev/app/android-update.json'
    );
  });
});
