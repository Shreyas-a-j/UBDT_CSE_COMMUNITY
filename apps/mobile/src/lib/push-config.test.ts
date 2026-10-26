import { describe, expect, it } from 'vitest';

import { resolveOneSignalAppId } from './push-config';

describe('OneSignal app id resolution', () => {
  it('prefers the build-time environment value', () => {
    expect(resolveOneSignalAppId('env-app-id', 'extra-app-id')).toBe('env-app-id');
  });

  it('falls back to app.json extra when the env var is missing or empty', () => {
    expect(resolveOneSignalAppId(undefined, 'extra-app-id')).toBe('extra-app-id');
    expect(resolveOneSignalAppId('   ', 'extra-app-id')).toBe('extra-app-id');
  });

  it('returns an empty string when neither source is configured', () => {
    expect(resolveOneSignalAppId(undefined, undefined)).toBe('');
    expect(resolveOneSignalAppId('', {})).toBe('');
  });
});
