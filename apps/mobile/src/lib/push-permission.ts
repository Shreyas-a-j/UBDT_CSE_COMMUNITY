/**
 * Pure Android push permission state mapping. The native wrapper supplies
 * platform facts; the screen renders this state and only ever calls the
 * native permission prompt from a deliberate button press.
 */

export type PushPermissionState =
  | 'unsupported'
  | 'not-determined'
  | 'denied'
  | 'granted'
  | 'error';

export interface PushPermissionFacts {
  configured: boolean;
  granted: boolean;
  canRequest: boolean;
}

export function resolvePushPermissionState({
  configured,
  granted,
  canRequest,
}: PushPermissionFacts): PushPermissionState {
  if (!configured) return 'unsupported';
  if (granted) return 'granted';
  return canRequest ? 'not-determined' : 'denied';
}

export function pushPermissionCopy(state: PushPermissionState): {
  title: string;
  message: string;
  action: string | null;
} {
  switch (state) {
    case 'not-determined':
      return {
        title: 'Never miss a campus update',
        message:
          'Turn on Android notifications for new announcements, events, and your showcase top-two results.',
        action: 'Turn on notifications',
      };
    case 'denied':
      return {
        title: 'Notifications are off',
        message:
          'Android is blocking UCC alerts. You can allow them in system settings at any time.',
        action: 'Open settings',
      };
    case 'error':
      return {
        title: 'Could not check notification settings',
        message: 'Try again from this screen. Nothing was enabled automatically.',
        action: 'Try again',
      };
    default:
      return { title: '', message: '', action: null };
  }
}
