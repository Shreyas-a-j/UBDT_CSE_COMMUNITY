/**
 * Pure helpers that present the mobile app's Supabase session in the exact
 * cookie format the website's `@supabase/ssr` server client reads.
 *
 * This module deliberately imports nothing from React Native, Supabase, or
 * Expo so it can be unit-tested in Node and so the encoding rules stay
 * independent of the transport.
 *
 * Security properties:
 *  - The session cookie is derived from the app's real, signed-in Supabase
 *    session. It is never constructed from user-supplied identity fields.
 *  - The value is only a presentation of the session. The website still calls
 *    `auth.getUser()`, which sends the access token to Supabase Auth for
 *    validation; the cookie is never trusted on its own.
 *  - Callers must send the returned cookies only to the configured website
 *    origin (enforced in `website-api.ts`).
 */

/** Matches `@supabase/ssr`'s `MAX_CHUNK_SIZE`. */
export const MAX_CHUNK_SIZE = 3180;

/**
 * Refresh this long before the access token expires. The website's server
 * client refreshes within 90 seconds of expiry; staying above that margin
 * means the website never rotates a refresh token the app cannot observe.
 */
export const SESSION_REFRESH_MARGIN_MS = 120_000;

export interface SessionCookie {
  name: string;
  value: string;
}

interface SessionLike {
  access_token?: unknown;
  expires_at?: unknown;
}

const TO_BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * UTF-8 bytes for a JavaScript string. Implemented explicitly so the encoder
 * behaves the same in Hermes and Node without relying on TextEncoder.
 */
function utf8Bytes(input: string): number[] {
  const bytes: number[] = [];
  for (let index = 0; index < input.length; index += 1) {
    let code = input.charCodeAt(index);

    // Combine a surrogate pair into one code point.
    if (code >= 0xd800 && code <= 0xdbff && index + 1 < input.length) {
      const next = input.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        index += 1;
      }
    }

    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f)
      );
    }
  }
  return bytes;
}

/** Unpadded base64url, matching `@supabase/ssr`'s encoder. */
export function stringToBase64URL(input: string): string {
  const bytes = utf8Bytes(input);
  let output = '';
  let queue = 0;
  let queuedBits = 0;

  for (const byte of bytes) {
    queue = (queue << 8) | byte;
    queuedBits += 8;
    while (queuedBits >= 6) {
      output += TO_BASE64URL[(queue >> (queuedBits - 6)) & 63];
      queuedBits -= 6;
    }
  }

  if (queuedBits > 0) {
    queue <<= 6 - queuedBits;
    output += TO_BASE64URL[(queue >> 0) & 63];
  }

  return output;
}

/**
 * The session storage value written by `@supabase/ssr` with its default
 * `cookieEncoding: 'base64url'`.
 */
export function encodeSessionValue(session: unknown): string {
  return `base64-${stringToBase64URL(JSON.stringify(session))}`;
}

/**
 * Chunk a cookie value exactly as `@supabase/ssr` does. The website combines
 * `<key>`, `<key>.0`, `<key>.1`, ... when it reads the request.
 */
export function createChunks(
  key: string,
  value: string,
  chunkSize: number = MAX_CHUNK_SIZE
): SessionCookie[] {
  if (!Number.isFinite(chunkSize) || chunkSize <= 0) {
    throw new Error('chunkSize must be a positive number');
  }

  const encodedValue = encodeURIComponent(value);
  if (encodedValue.length <= chunkSize) return [{ name: key, value }];

  const chunks: SessionCookie[] = [];
  let remaining = encodedValue;

  while (remaining.length > 0) {
    let encodedChunk = remaining.slice(0, chunkSize);
    const lastEscapePos = encodedChunk.lastIndexOf('%');

    // Never split a percent-escape sequence across chunks.
    if (lastEscapePos > chunkSize - 3) {
      encodedChunk = encodedChunk.slice(0, lastEscapePos);
    }

    let decoded = '';
    while (encodedChunk.length > 0) {
      try {
        decoded = decodeURIComponent(encodedChunk);
        break;
      } catch (error) {
        if (
          error instanceof URIError &&
          encodedChunk.at(-3) === '%' &&
          encodedChunk.length > 3
        ) {
          encodedChunk = encodedChunk.slice(0, encodedChunk.length - 3);
        } else {
          throw error;
        }
      }
    }

    chunks.push({ name: `${key}.${chunks.length}`, value: decoded });
    remaining = remaining.slice(encodedChunk.length);
  }

  return chunks;
}

/**
 * Supabase project ref used for storage keys. Mirrors
 * `new URL(supabaseUrl).hostname.split('.')[0]` from the Supabase SDK.
 */
export function projectRefFromUrl(supabaseUrl: string): string {
  let hostname: string;
  try {
    hostname = new URL(supabaseUrl).hostname;
  } catch {
    throw new Error('The Supabase URL is not a valid URL.');
  }
  const ref = hostname.split('.')[0];
  if (!ref) throw new Error('The Supabase URL does not contain a project reference.');
  return ref;
}

/** e.g. `sb-abcdefghijklmnop-auth-token`. */
export function storageKeyForSupabaseUrl(supabaseUrl: string): string {
  return `sb-${projectRefFromUrl(supabaseUrl)}-auth-token`;
}

/**
 * Build the cookie pairs that reproduce the website's stored session.
 * Throws when the session is missing an access token; never fabricates one.
 */
export function buildSessionCookies(
  supabaseUrl: string,
  session: SessionLike | null | undefined
): SessionCookie[] {
  if (!session || typeof session.access_token !== 'string' || session.access_token.length === 0) {
    throw new Error('A signed-in Supabase session is required.');
  }

  return createChunks(storageKeyForSupabaseUrl(supabaseUrl), encodeSessionValue(session));
}

/** Serialize cookie pairs for an explicit `Cookie` request header. */
export function cookieHeader(cookies: readonly SessionCookie[]): string {
  return cookies.map(({ name, value }) => `${name}=${value}`).join('; ');
}

/**
 * True when the access token is missing, malformed, or expires within
 * `marginMs`. Expiry is measured with `expires_at` (seconds since epoch),
 * matching Supabase's session shape.
 */
export function sessionNeedsRefresh(
  session: SessionLike | null | undefined,
  nowMs: number = Date.now(),
  marginMs: number = SESSION_REFRESH_MARGIN_MS
): boolean {
  if (!session || typeof session.access_token !== 'string' || session.access_token.length === 0) {
    return true;
  }
  if (typeof session.expires_at !== 'number' || !Number.isFinite(session.expires_at)) {
    return true;
  }
  return session.expires_at * 1000 - nowMs < marginMs;
}
