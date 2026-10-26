/**
 * Authenticated calls to the existing UCC website APIs.
 *
 * The mobile app does not duplicate server-authorised workflows (CSV export,
 * announcement image upload, admin review). It serializes its real Supabase
 * session into the website's own `@supabase/ssr` cookie format and sends it to
 * the website origin over HTTPS.
 *
 * Why this is safe:
 *  - The session comes from `supabase.auth.getSession()`; no client-supplied
 *    identity, role, or fabricated token is used.
 *  - The website's server client calls `auth.getUser()`, so Supabase Auth
 *    validates the access token on every request. RLS remains in force.
 *  - Cookies are only attached to paths under `UCC_WEBSITE_URL`; the request
 *    API here rejects absolute or protocol-relative URLs.
 *  - No service-role key ever exists in the mobile bundle.
 *  - Cookies live only in memory for the duration of a request.
 *
 * Freshness: the website server client refreshes a session that is within 90
 * seconds of expiry. Refreshing here first (120-second margin) avoids rotating
 * a refresh token the website would then invalidate for the app.
 */

import type { Session } from '@supabase/supabase-js';

import { UCC_WEBSITE_URL } from './links';
import { supabase, supabaseUrl } from './supabase';
import {
  SESSION_REFRESH_MARGIN_MS,
  buildSessionCookies,
  cookieHeader,
  sessionNeedsRefresh,
} from './website-auth';

export class WebsiteApiError extends Error {
  readonly status: number;

  constructor(message: string, status = 0) {
    super(message);
    this.name = 'WebsiteApiError';
    this.status = status;
  }
}

function websiteUrl(path: string): string {
  if (!path.startsWith('/') || path.startsWith('//')) {
    throw new WebsiteApiError('Website API paths must be relative to the configured origin.');
  }
  return `${UCC_WEBSITE_URL}${path}`;
}

/**
 * Build a same-origin website URL for APIs that need a native downloader
 * rather than `fetch`. Absolute and protocol-relative paths are rejected so
 * the caller can never redirect the session cookie to another host.
 */
export function websiteOriginUrl(path: string): string {
  return websiteUrl(path);
}

/**
 * Returns a session whose access token is comfortably outside the website's
 * refresh margin. Throws rather than sending a session the website would
 * rotate.
 */
async function freshSession(): Promise<Session> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new WebsiteApiError(error.message);
  if (!data.session) throw new WebsiteApiError('Sign in required to use this feature.', 401);

  if (!sessionNeedsRefresh(data.session, Date.now(), SESSION_REFRESH_MARGIN_MS)) {
    return data.session;
  }

  const refreshed = await supabase.auth.refreshSession();
  if (refreshed.error || !refreshed.data.session) {
    throw new WebsiteApiError(
      'Your session has expired. Sign in again to continue.',
      401
    );
  }
  return refreshed.data.session;
}

/**
 * Build the explicit `Cookie` header for a website request. Callers must use
 * it only with `UCC_WEBSITE_URL`; this module never accepts a destination.
 */
export async function websiteAuthHeaders(): Promise<Record<string, string>> {
  const session = await freshSession();
  const cookies = buildSessionCookies(supabaseUrl, session);
  return { Cookie: cookieHeader(cookies) };
}

/**
 * Fetch a website API path with the signed-in session.
 *
 * Never pass an absolute URL: the path is joined to the configured HTTPS
 * origin so the session cookie cannot leak to another host.
 */
export async function websiteFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.delete('Cookie');

  const auth = await websiteAuthHeaders();
  const cookie = auth.Cookie;
  if (!cookie) {
    throw new WebsiteApiError('Sign in required to use this feature.', 401);
  }
  headers.set('Cookie', cookie);

  return fetch(websiteUrl(path), {
    ...init,
    headers,
    // RN does not persist website cookies; be explicit so no cookie jar can
    // add a second identity to this request.
    credentials: 'omit',
  });
}

/** Turn a non-OK website response into a user-visible error. */
export async function websiteErrorFor(response: Response): Promise<WebsiteApiError> {
  let message = `The website request failed (${response.status}).`;

  try {
    const text = (await response.text()).trim();
    const contentType = response.headers.get('content-type') ?? '';

    if (text && contentType.includes('application/json')) {
      const parsed = JSON.parse(text) as { error?: unknown; message?: unknown };
      const detail =
        typeof parsed.error === 'string'
          ? parsed.error
          : typeof parsed.message === 'string'
            ? parsed.message
            : '';
      if (detail) message = detail;
    } else if (text && !contentType.includes('text/html')) {
      message = text.slice(0, 300);
    } else if (response.status === 401 || response.status === 403) {
      message = 'The website rejected this session. Sign in again.';
    }
  } catch {
    // Keep the generic message when the body cannot be read.
  }

  return new WebsiteApiError(message, response.status);
}

/** Fetch and parse JSON, preserving the server's error text and status. */
export async function websiteJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await websiteFetch(path, init);
  if (!response.ok) throw await websiteErrorFor(response);

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    throw new WebsiteApiError(
      'The website did not return the expected API response. Your session may have expired.',
      response.status
    );
  }

  try {
    return (await response.json()) as T;
  } catch {
    throw new WebsiteApiError('The website returned an unreadable response.', response.status);
  }
}
