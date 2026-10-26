/**
 * OneSignal identity reconciliation, independent of the native SDK.
 *
 * One device maps to one Supabase user UUID at a time. Signing out removes
 * the external id; switching accounts replaces it. The interface deliberately
 * exposes no email registration API, so an email address can never become the
 * OneSignal identity.
 */

export interface PushIdentitySdk {
  login(externalId: string): void;
  logout(): void;
}

export interface PushIdentityState {
  currentUserId: string | null;
}

export function createPushIdentityState(): PushIdentityState {
  return { currentUserId: null };
}

/**
 * Idempotently reconcile the SDK with the authenticated Supabase user.
 * Returns true when an SDK call was made.
 */
export function reconcilePushIdentity(
  sdk: PushIdentitySdk,
  state: PushIdentityState,
  nextUserId: string | null
): boolean {
  if (!nextUserId) {
    sdk.logout();
    state.currentUserId = null;
    return true;
  }

  if (state.currentUserId === nextUserId) return false;

  sdk.login(nextUserId);
  state.currentUserId = nextUserId;
  return true;
}
