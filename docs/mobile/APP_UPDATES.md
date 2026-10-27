# Android In-App Updates

Date: 2026-10-27
Applies to: `apps/mobile` (Android only)
Current release: **1.0.2 (versionCode 3)**

## What it does

On launch, the Android app fetches a public JSON manifest, compares the
manifest's `versionCode` with the installed APK, and shows a native dialog when
a newer build exists. The dialog shows installed/latest versions and release
notes.

- **Update now** hands a validated HTTPS `.apk` URL to Android's browser /
  DownloadManager via `Linking.openURL`.
- **Later** dismisses an optional update for the current app session. The next
  launch checks again.
- A **mandatory** update cannot be dismissed until the browser hand-off has
  happened. UCC still cannot install the APK silently: the user finishes the
  download and approves installation in Android's installer.
- Every network, timeout, server, or malformed-manifest failure is **fail-open**.
  The app continues to open normally.

The implementation is split into:

- `src/lib/app-update.ts` — pure version, manifest, network, and prompt logic.
- `src/lib/app-update-client.ts` — installed-version lookup and `Linking`.
- `src/components/app-update-dialog.tsx` — presentation.
- `src/components/app-update-gate.tsx` — launch check and session policy.

## Manifest

Default public URL:

```text
https://pub-984d3335c03543f6bbddf6400b88a737.r2.dev/app/android-update.json
```

Source of truth in this repository:

```text
apps/mobile/update/android-update.json
```

Schema:

```json
{
  "version": "1.0.2",
  "versionCode": 3,
  "apkUrl": "https://pub-984d3335c03543f6bbddf6400b88a737.r2.dev/app/ucc-android-v1.0.2.apk",
  "releaseNotes": [
    "A short, user-facing change."
  ],
  "mandatory": false
}
```

Validation rules enforced by the client:

- `version`: 1–4 numeric segments, optional prerelease suffix (for example
  `1.2.3-beta.1`).
- `versionCode`: positive integer no larger than Android's maximum.
- `apkUrl`: absolute HTTPS URL with no embedded credentials, ending in `.apk`.
- `releaseNotes`: 1–20 non-empty strings, each at most 500 characters.
- `mandatory`: boolean.

Unknown fields are ignored. The manifest is public: never put credentials,
private URLs, or internal notes in it.

`EXPO_PUBLIC_UPDATE_MANIFEST_URL` can override the default at build time. It must
also be an HTTPS URL. Invalid configuration fails open without crashing startup.

## Release checklist

1. **Bump the app version.** In `apps/mobile/app.json`, increment
   `expo.version` and always increase `expo.android.versionCode`. Android uses
   `versionCode` to decide whether an APK is an upgrade.
2. **Update the checked-in manifest**
   (`apps/mobile/update/android-update.json`) so `version` and `versionCode`
   match `app.json`, the `apkUrl` names the new APK, and the release notes are
   user-facing.
3. **Build with the existing signing identity.** The APK must have package
   `com.ucc.community` and the same certificate as the installed release.
   The current release certificate SHA-256 is:

   ```text
   FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C
   ```

   The local release build currently uses
   `apps/mobile/android/app/debug.keystore`, matching the v1.0.0 build. Keep a
   secure backup outside the repository. Do not rotate this key while users
   have the current app installed: Android will reject the update and require an
   uninstall/reinstall. A dedicated production keystore should be adopted only
   with a planned migration.
4. **Build the APK.** Native projects are generated and ignored by Git:

   ```bash
   cd apps/mobile
   npx expo prebuild --platform android --no-install
   cd android
   JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64 ./gradlew :app:assembleRelease --no-daemon
   ```

   If prebuild recreates `android/`, restore the signing keystore from the secure
   backup first. Confirm `android/app/build.gradle` still has application id
   `com.ucc.community`.
5. **Verify the artifact before upload:**

   ```bash
   APK=android/app/build/outputs/apk/release/app-release.apk
   aapt dump badging "$APK" | head -2
   apksigner verify --print-certs "$APK" | grep 'SHA-256 digest'
   sha256sum "$APK"
   ```

   Check package, `versionCode`, `versionName`, certificate fingerprint, and
   that the APK contains no `.env`, keystore, credential, or private-key files.
6. **Run the checks:**

   ```bash
   cd apps/mobile
   npm test
   npm run typecheck
   npx expo-doctor
   npx expo lint
   ```

   `expo lint` currently reports one pre-existing React Compiler error in the
   untouched `src/components/admin-nomination-banner.tsx`; it is unrelated to
   updates and must not be “fixed” as part of a release unless separately
   approved.
7. **Upload the APK first**, then the manifest. Serve the APK as
   `application/vnd.android.package-archive` and the manifest as JSON:

   ```bash
   export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
   export AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
   ENDPOINT="https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com"

   aws s3 cp "$APK" "s3://$R2_BUCKET_NAME/app/ucc-android-v1.0.2.apk" \
     --endpoint-url "$ENDPOINT" \
     --content-type application/vnd.android.package-archive \
     --cache-control "public, max-age=31536000, immutable"

   aws s3 cp apps/mobile/update/android-update.json \
     "s3://$R2_BUCKET_NAME/app/android-update.json" \
     --endpoint-url "$ENDPOINT" \
     --content-type "application/json; charset=utf-8" \
     --cache-control "no-cache, no-store, must-revalidate"
   ```

   Never expose `R2_SECRET_ACCESS_KEY` in client code or logs.
8. **Verify the public objects independently.** The APK download must return
   HTTP 200, the expected byte length, and the same SHA-256 as the local build.
   The manifest must return HTTP 200 and the new version fields:

   ```bash
   curl -sSI "https://pub-984d3335c03543f6bbddf6400b88a737.r2.dev/app/ucc-android-v1.0.2.apk"
   curl -sSL "https://pub-984d3335c03543f6bbddf6400b88a737.r2.dev/app/ucc-android-v1.0.2.apk" | sha256sum
   curl -sSL "https://pub-984d3335c03543f6bbddf6400b88a737.r2.dev/app/android-update.json"
   ```
9. **Update the website download card.** Change `version` and `apkUrl` in
   `lib/android-app.ts` and regenerate `public/android/ucc-qr.svg` so it encodes
   the direct APK URL. Run `npx vitest run components/AndroidDownloadCard.test.tsx`.

## Current release record (1.0.2)

| Field | Value |
| --- | --- |
| Version | 1.0.2 |
| versionCode | 3 |
| Package | `com.ucc.community` |
| APK bytes | 99,490,139 |
| APK SHA-256 | `fa162a62e2f2c3045201ce8ee7f9fca3268d81f7065b231a167e94ef419a1e4c` |
| Manifest | `https://pub-984d3335c03543f6bbddf6400b88a737.r2.dev/app/android-update.json` |
| APK | `https://pub-984d3335c03543f6bbddf6400b88a737.r2.dev/app/ucc-android-v1.0.2.apk` |
| Mandatory | No |

**Bootstrap caveat:** v1.0.0 does not contain the update client. Users still on
v1.0.0 will not see an in-app prompt; they must install v1.0.2 once from the
website/download link. Builds v1.0.1 and later contain the client, so future
v1.0.3+ releases can be discovered in-app.

## Tests

`src/lib/app-update.test.ts` covers version ordering, malformed manifests,
unavailable servers, timeouts, optional dismissal, mandatory blocking, download
failures, and URL validation. `src/lib/update-manifest.test.ts` guards the
checked-in manifest against `app.json` drift.
