import { describe, expect, it } from 'vitest';

import {
  pushPermissionCopy,
  resolvePushPermissionState,
} from './push-permission';

describe('Android push permission state', () => {
  it('is unsupported without an Android app id', () => {
    expect(
      resolvePushPermissionState({ configured: false, granted: false, canRequest: true })
    ).toBe('unsupported');
  });

  it('distinguishes never-asked from blocked', () => {
    expect(
      resolvePushPermissionState({ configured: true, granted: false, canRequest: true })
    ).toBe('not-determined');
    expect(
      resolvePushPermissionState({ configured: true, granted: false, canRequest: false })
    ).toBe('denied');
  });

  it('reports granted without offering another prompt', () => {
    expect(
      resolvePushPermissionState({ configured: true, granted: true, canRequest: false })
    ).toBe('granted');
    expect(pushPermissionCopy('granted').action).toBeNull();
  });

  it('offers a deliberate action for promptable and blocked states', () => {
    expect(pushPermissionCopy('not-determined').action).toBe('Turn on notifications');
    expect(pushPermissionCopy('denied').action).toBe('Open settings');
    expect(pushPermissionCopy('error').action).toBe('Try again');
  });
});
