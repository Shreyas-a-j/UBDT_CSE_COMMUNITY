# UCC Mobile

Expo + React Native (Android) client for the UBDT CSE Community. Milestone 1:
sign-in against the existing Supabase project, secure session persistence, and
a protected home screen that loads the signed-in user's `public.profiles` row.

See `docs/mobile/MILESTONE_1_AUDIT.md` in the web repo root for the full
architecture audit (schema, auth behavior, decisions, and risks).

## Commands

```bash
npx expo start            # dev server (scan with Expo Go / dev build)
npx tsc --noEmit          # typecheck
npx expo lint             # lint
npx expo export --platform android   # bundle validation
npx expo-doctor           # dependency/config diagnostics
```

## Configuration

Copy `.env.example` to `.env` and fill `EXPO_PUBLIC_SUPABASE_URL` /
`EXPO_PUBLIC_SUPABASE_ANON_KEY` with the same public values the website uses.
Real env files are git-ignored. For EAS cloud builds, set the same two keys as
EAS environment variables (`eas env:create`).

## Android in-app updates

Release builds check a public JSON manifest on launch and offer the newer APK
inside the app. Optional updates can be postponed for the session; mandatory
updates must reach Android's browser/installer hand-off before the app unlocks.
The app never installs an APK silently.

- Default manifest:
  `https://pub-984d3335c03543f6bbddf6400b88a737.r2.dev/app/android-update.json`
- Checked-in source: `apps/mobile/update/android-update.json`
- Release and signing procedure: `docs/mobile/APP_UPDATES.md`
- Optional build-time override: `EXPO_PUBLIC_UPDATE_MANIFEST_URL` (HTTPS only)

The manifest, version, signing, upload, and verification steps live in
`docs/mobile/APP_UPDATES.md`. Always increase `expo.android.versionCode` and
keep the release certificate unchanged so Android accepts the update.

## Installable internal APK (EAS cloud build)

```bash
npx eas-cli@latest login            # once
eas env:create --name EXPO_PUBLIC_SUPABASE_URL --value "https://<ref>.supabase.co" ...
eas env:create --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value "<anon key>" ...
npx eas-cli@latest build --profile internal --platform android
```

The `internal` profile in `eas.json` builds an unencrypted, installable `.apk`
(`distribution: internal`, `buildType: apk`) for physical devices. The build
link arrives by email or via `eas build:list`.
