import { describe, expect, it, vi } from 'vitest';

import {
  createPushIdentityState,
  reconcilePushIdentity,
} from './push-identity';

function fakeSdk() {
  return {
    login: vi.fn((_externalId: string) => undefined),
    logout: vi.fn(() => undefined),
  };
}

describe('OneSignal identity reconciliation', () => {
  it('logs in with the Supabase user UUID', () => {
    const sdk = fakeSdk();
    const state = createPushIdentityState();
    expect(reconcilePushIdentity(sdk, state, 'user-a')).toBe(true);
    expect(sdk.login).toHaveBeenCalledWith('user-a');
    expect(sdk.logout).not.toHaveBeenCalled();
  });

  it('does not re-login while the same user remains signed in', () => {
    const sdk = fakeSdk();
    const state = createPushIdentityState();
    reconcilePushIdentity(sdk, state, 'user-a');
    expect(reconcilePushIdentity(sdk, state, 'user-a')).toBe(false);
    expect(sdk.login).toHaveBeenCalledTimes(1);
  });

  it('switches accounts without leaving the old external id attached', () => {
    const sdk = fakeSdk();
    const state = createPushIdentityState();
    reconcilePushIdentity(sdk, state, 'user-a');
    reconcilePushIdentity(sdk, state, 'user-b');
    expect(sdk.login).toHaveBeenLastCalledWith('user-b');
    expect(state.currentUserId).toBe('user-b');
  });

  it('logs out on sign-out and clears the remembered user', () => {
    const sdk = fakeSdk();
    const state = createPushIdentityState();
    reconcilePushIdentity(sdk, state, 'user-a');
    expect(reconcilePushIdentity(sdk, state, null)).toBe(true);
    expect(sdk.logout).toHaveBeenCalledTimes(1);
    expect(state.currentUserId).toBeNull();
  });

  it('has no email-registration surface', () => {
    const sdk = fakeSdk();
    expect(Object.keys(sdk).sort()).toEqual(['login', 'logout']);
  });
});
