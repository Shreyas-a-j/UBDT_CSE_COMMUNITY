import { describe, expect, it } from 'vitest';

import {
  MAX_CHUNK_SIZE,
  SESSION_REFRESH_MARGIN_MS,
  buildSessionCookies,
  cookieHeader,
  encodeSessionValue,
  sessionNeedsRefresh,
  storageKeyForSupabaseUrl,
  stringToBase64URL,
} from './website-auth';

const SUPABASE_URL = 'https://abcdefghijklmnop.supabase.co';
const STORAGE_KEY = 'sb-abcdefghijklmnop-auth-token';

function session(pad = ''): Record<string, unknown> {
  return {
    access_token: `header.${'a'.repeat(120)}.signature`,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: 4_102_444_800,
    refresh_token: `refresh-${'b'.repeat(40)}`,
    user: {
      id: '11111111-1111-1111-1111-111111111111',
      aud: 'authenticated',
      role: 'authenticated',
      email: 'member@example.test',
      user_metadata: { name: 'Ünïcode 名前', pad },
    },
  };
}

describe('base64url encoder', () => {
  it('matches Node for ASCII, unicode and surrogate pairs', () => {
    for (const value of [
      '',
      'hello',
      '{"a":1}',
      'Ünïcode 名前',
      'emoji 🎓 and 𝄞',
      JSON.stringify(session()),
    ]) {
      expect(stringToBase64URL(value)).toBe(Buffer.from(value, 'utf8').toString('base64url'));
    }
  });
});

describe('session cookie value', () => {
  it('round-trips through the website base64- decoder', () => {
    const value = encodeSessionValue(session());
    expect(value.startsWith('base64-')).toBe(true);

    const json = Buffer.from(value.slice('base64-'.length), 'base64url').toString('utf8');
    expect(JSON.parse(json)).toEqual(session());
  });

  it('uses the Supabase project ref for the cookie name', () => {
    expect(storageKeyForSupabaseUrl(SUPABASE_URL)).toBe(STORAGE_KEY);
    expect(storageKeyForSupabaseUrl('https://127.0.0.1:54321')).toBe('sb-127-auth-token');
  });

  it('refuses to fabricate a session without an access token', () => {
    expect(() => buildSessionCookies(SUPABASE_URL, null)).toThrow(/signed-in/i);
    expect(() => buildSessionCookies(SUPABASE_URL, { expires_at: 1 })).toThrow(/signed-in/i);
  });
});

describe('cookie chunking', () => {
  it('fits a normal session in one cookie', () => {
    const cookies = buildSessionCookies(SUPABASE_URL, session());
    expect(cookies).toHaveLength(1);
    expect(cookies[0].name).toBe(STORAGE_KEY);
  });

  it('chunks a large session exactly the way @supabase/ssr does', () => {
    const large = session('x'.repeat(12_000));
    const cookies = buildSessionCookies(SUPABASE_URL, large);

    expect(cookies.length).toBeGreaterThan(1);
    cookies.forEach((cookie, index) => {
      expect(cookie.name).toBe(`${STORAGE_KEY}.${index}`);
      expect(cookie.value.length).toBeLessThanOrEqual(MAX_CHUNK_SIZE);
    });

    const combined = cookies.map((cookie) => cookie.value).join('');
    expect(combined).toBe(encodeSessionValue(large));

    const json = Buffer.from(combined.slice('base64-'.length), 'base64url').toString('utf8');
    expect(JSON.parse(json)).toEqual(large);
  });

  it('serializes all chunks into one Cookie header', () => {
    const cookies = buildSessionCookies(SUPABASE_URL, session('x'.repeat(12_000)));
    const header = cookieHeader(cookies);
    expect(header.split('; ')).toHaveLength(cookies.length);
    expect(header.startsWith(`${STORAGE_KEY}.0=`)).toBe(true);
  });
});

describe('session freshness', () => {
  const now = Date.UTC(2026, 9, 24, 12, 0, 0);

  it('refreshes inside the margin and reuses outside it', () => {
    const at = (secondsAhead: number) => ({
      access_token: 'token',
      expires_at: Math.floor(now / 1000) + secondsAhead,
    });

    expect(sessionNeedsRefresh(at(90), now)).toBe(true);
    expect(sessionNeedsRefresh(at(119), now)).toBe(true);
    expect(sessionNeedsRefresh(at(121), now)).toBe(false);
    expect(sessionNeedsRefresh(at(3600), now)).toBe(false);
  });

  it('treats a missing token or expiry as requiring refresh', () => {
    expect(sessionNeedsRefresh(null, now)).toBe(true);
    expect(sessionNeedsRefresh({ access_token: 'token' }, now)).toBe(true);
    expect(sessionNeedsRefresh({ expires_at: 9_999_999_999 }, now)).toBe(true);
  });

  it('keeps the app margin above the website 90-second refresh margin', () => {
    expect(SESSION_REFRESH_MARGIN_MS).toBeGreaterThan(90_000);
  });
});
