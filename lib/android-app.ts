/**
 * Public Android build metadata for the website download card.
 *
 * Keep `version` and `packageName` in sync with apps/mobile/app.json.
 * `apkUrl` must be the direct, public HTTPS APK object — never the website
 * URL, an EAS dashboard URL, or a local development file.
 *
 * The current build is the v1.0.0 release-variant APK hosted on the public
 * R2 bucket used by the site. If the APK is removed, set `apkUrl` to null:
 * the card then renders a clearly unavailable state instead of a broken link.
 */
export interface AndroidAppInfo {
  name: string;
  version: string;
  packageName: string;
  apkUrl: string | null;
  iconSrc: string;
  qrSrc: string;
}

export const ANDROID_APP: AndroidAppInfo = {
  name: 'UCC',
  version: '1.0.0',
  packageName: 'com.ucc.community',
  apkUrl:
    'https://pub-984d3335c03543f6bbddf6400b88a737.r2.dev/app/ucc-android-v1.0.0.apk',
  iconSrc: '/android/ucc-icon.png',
  qrSrc: '/android/ucc-qr.svg',
};
