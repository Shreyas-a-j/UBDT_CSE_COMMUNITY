/**
 * Android OneSignal wrapper.
 *
 * Everything native is loaded lazily and only on Android. The app never
 * prompts on startup: callers must invoke requestPushPermission() from a
 * deliberate control. Identity is always the Supabase UUID; this module has
 * no email-registration path.
 */

import { Platform } from 'react-native';
import type { Href } from 'expo-router';
import type { NotificationClickEvent } from 'react-native-onesignal';
import Constants from 'expo-constants';

import { routeForPushData, type PushAdditionalData } from './notification-route';
import { resolveOneSignalAppId } from './push-config';
import {
  createPushIdentityState,
  reconcilePushIdentity,
  type PushIdentitySdk,
} from './push-identity';
import {
  resolvePushPermissionState,
  type PushPermissionState,
} from './push-permission';

// Env wins (EAS build); app.json extra is the committed release-build
// fallback so a missing EAS variable cannot silently disable push.
const appId = resolveOneSignalAppId(
  process.env.EXPO_PUBLIC_ONESIGNAL_APP_ID,
  Constants.expoConfig?.extra?.onesignalAppId,
);
const identityState = createPushIdentityState();

type OneSignalModule = typeof import('react-native-onesignal');

let sdkPromise: Promise<OneSignalModule | null> | null = null;
let clickListenerAttached = false;
let routeHandler: ((route: Href) => void) | null = null;
let pendingClick: PushAdditionalData | null = null;

export function isAndroidPushConfigured(): boolean {
  return Platform.OS === 'android' && appId.length > 0;
}

function attachClickListener(module: OneSignalModule): void {
  if (clickListenerAttached) return;

  module.OneSignal.Notifications.addEventListener('click', (event: NotificationClickEvent) => {
    const data = event.notification.additionalData as PushAdditionalData;
    if (routeHandler) {
      routeHandler(routeForPushData(data));
    } else {
      // The app can be opened cold by a notification tap. Hold the payload
      // until the root navigator registers its handler.
      pendingClick = data;
    }
  });
  clickListenerAttached = true;
}

async function loadOneSignal(): Promise<OneSignalModule | null> {
  if (!isAndroidPushConfigured()) return null;

  if (!sdkPromise) {
    sdkPromise = import('react-native-onesignal')
      .then((module) => {
        // Initialization must happen before any other native SDK call.
        // OneSignal queues cold-start notification opens natively and flushes
        // them once the click listener is attached, so registering second
        // still delivers the click that launched the app.
        module.OneSignal.initialize(appId);
        attachClickListener(module);
        return module;
      })
      .catch((error: unknown) => {
        console.warn('OneSignal initialization failed', error);
        sdkPromise = null;
        return null;
      });
  }

  return sdkPromise;
}

/** Initializes once and subscribes to notification clicks. */
export async function initializeAndroidPush(
  onRoute: (route: Href) => void
): Promise<boolean> {
  routeHandler = onRoute;
  const sdk = await loadOneSignal();
  if (!sdk) return false;

  if (pendingClick) {
    const data = pendingClick;
    pendingClick = null;
    onRoute(routeForPushData(data));
  }

  return true;
}

/**
 * Reconcile the OneSignal external id with Supabase auth. Called on every
 * session change; login/logout is idempotent and account switches replace
 * the previous UUID.
 */
export async function syncPushIdentity(userId: string | null): Promise<void> {
  const sdk = await loadOneSignal();
  if (!sdk) return;

  const bridge: PushIdentitySdk = {
    login: (externalId) => sdk.OneSignal.login(externalId),
    logout: () => sdk.OneSignal.logout(),
  };
  reconcilePushIdentity(bridge, identityState, userId);
}

export async function getPushPermissionState(): Promise<PushPermissionState> {
  if (!isAndroidPushConfigured()) return 'unsupported';

  const sdk = await loadOneSignal();
  if (!sdk) return 'error';

  try {
    const granted = await sdk.OneSignal.Notifications.getPermissionAsync();
    let canRequest = false;
    try {
      canRequest = await sdk.OneSignal.Notifications.canRequestPermission();
    } catch {
      canRequest = false;
    }
    return resolvePushPermissionState({
      configured: true,
      granted,
      canRequest,
    });
  } catch {
    return 'error';
  }
}

/**
 * Must only be called from a user action. Returns the resulting permission
 * state so the caller can render denial without a second native read.
 */
export async function requestPushPermission(): Promise<PushPermissionState> {
  if (!isAndroidPushConfigured()) return 'unsupported';

  const sdk = await loadOneSignal();
  if (!sdk) return 'error';

  try {
    const granted = await sdk.OneSignal.Notifications.requestPermission(false);
    if (granted) {
      sdk.OneSignal.User.pushSubscription.optIn();
      return 'granted';
    }
    return 'denied';
  } catch {
    return 'error';
  }
}
