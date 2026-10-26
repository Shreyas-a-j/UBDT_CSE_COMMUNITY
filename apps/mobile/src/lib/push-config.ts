/**
 * OneSignal app-id resolution.
 *
 * The app id is public, but a missing build-time environment variable used to
 * disable the entire Android push path silently: `isAndroidPushConfigured()`
 * returned false, OneSignal was never initialized, no external id was set, and
 * the worker marked every outbox row "no subscribed devices".
 *
 * Resolution order:
 *   1. EXPO_PUBLIC_ONESIGNAL_APP_ID (EAS build env; highest priority)
 *   2. app.json `extra.onesignalAppId` (committed fallback for release builds
 *      that were produced without the EAS environment variable)
 *
 * A non-empty environment value always wins so an operator can point a build
 * at a different OneSignal app without editing source.
 */
export function resolveOneSignalAppId(
  envValue: string | undefined | null,
  extraValue: unknown,
): string {
  const fromEnv = typeof envValue === 'string' ? envValue.trim() : '';
  if (fromEnv) return fromEnv;
  return typeof extraValue === 'string' ? extraValue.trim() : '';
}
