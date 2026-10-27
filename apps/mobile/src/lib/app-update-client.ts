/**
 * Native bindings for the pure update logic.
 *
 * Installed version values come from the built APK, not from a remote
 * manifest. On a standalone Android build, `nativeBuildVersion` is the
 * versionCode Android will enforce at install time; in Expo Go/dev builds we
 * fall back to the embedded Expo config.
 */

import Constants from 'expo-constants';
import { Linking } from 'react-native';

import {
  checkForUpdate,
  normalizeApkUrl,
  resolveUpdateManifestUrl,
  type InstalledAppVersion,
  type UpdateCheckResult,
} from './app-update';

function positiveVersionCode(raw: string | number | null | undefined): number {
  const parsed =
    typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? ''), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

/** The version and versionCode embedded in the running APK. */
export function getInstalledAppVersion(): InstalledAppVersion {
  const standalone = Constants.executionEnvironment === 'standalone';
  const nativeVersion = Constants.nativeAppVersion;
  const config = Constants.expoConfig;

  const version =
    (standalone ? nativeVersion : null) ??
    config?.version ??
    nativeVersion ??
    '0.0.0';

  const rawVersionCode = standalone
    ? (Constants.nativeBuildVersion ?? config?.android?.versionCode)
    : (config?.android?.versionCode ?? Constants.nativeBuildVersion);

  return {
    version,
    versionCode: positiveVersionCode(rawVersionCode),
  };
}

/**
 * Check the configured manifest. Configuration errors are returned as a normal
 * `unavailable` result so a bad build-time env value can never crash startup.
 */
export async function checkForAppUpdate(): Promise<UpdateCheckResult> {
  let manifestUrl: string;
  try {
    manifestUrl = resolveUpdateManifestUrl(
      process.env.EXPO_PUBLIC_UPDATE_MANIFEST_URL
    );
  } catch {
    return {
      status: 'unavailable',
      reason: 'configuration',
      message: 'Update checking is not configured correctly.',
    };
  }

  return checkForUpdate({
    manifestUrl,
    installed: getInstalledAppVersion(),
  });
}

/**
 * Hand the APK URL to Android's browser/DownloadManager. The URL is validated
 * again here so no caller can send a non-HTTPS or non-APK target to Linking.
 */
export async function openApkDownload(apkUrl: string): Promise<void> {
  const url = normalizeApkUrl(apkUrl);
  await Linking.openURL(url);
}
