#!/usr/bin/env node
/**
 * Opt-in end-to-end parity checks for the Android app's website-backed
 * workflows.
 *
 * Default run (no credentials):
 *   - verifies the deployed website denies anonymous access to the CSV export,
 *     admin queue, admin review and announcement-image upload;
 *   - verifies a tampered session cookie is rejected when a Supabase URL is
 *     available (tampering is a negative test, never a way to authenticate);
 *   - verifies the mobile source no longer contains Network/messages routes,
 *     connection APIs, or deep links, and that the People tab exists.
 *
 * Authenticated run (read-only):
 *   E2E_FACULTY_EMAIL=... E2E_FACULTY_PASSWORD=... \
 *   E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=... \
 *   E2E_SUPABASE_URL=... E2E_SUPABASE_ANON_KEY=... \
 *   npm run e2e:website
 *   - approved faculty: real CSV download (headers, manifest, rectangular
 *     rows, saved artifact), public People projection excluding self, live
 *     event IST boundaries, and 403 on the admin queue;
 *   - admin: real admin queue load, 403 for faculty, 400 for an invalid
 *     decision, plus the explicit review-write check below;
 *   - student (optional): 403 on CSV/admin/upload;
 *   - logout: the local session is cleared and the mobile cookie builder
 *     refuses to present it.
 *
 * Explicitly destructive opt-ins (never enabled by default):
 *   E2E_ALLOW_IMAGE_UPLOAD=1
 *     Uploads one 1x1 PNG through the faculty-gated website route. The object
 *     remains in R2 under announcements/ and must be cleaned up manually.
 *   E2E_ALLOW_ANNOUNCEMENT_WRITES=1
 *     Creates, edits and deletes a marked announcement through Supabase as the
 *     faculty account. Cleanup runs in a finally block.
 *   E2E_ALLOW_ADMIN_REVIEW_WRITES=1
 *   E2E_ADMIN_REVIEW_APPLICATION_ID=<uuid>
 *   E2E_ADMIN_REVIEW_DECISION=approve|reject
 *     Permanently reviews one pending faculty application through the website
 *     API. There is no undo endpoint; use only with a disposable test account.
 *
 * The script never prints cookies, passwords, tokens or keys.
 */

import { access, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClient } from '@supabase/supabase-js';

import { buildSessionCookies, cookieHeader, sessionNeedsRefresh } from '../src/lib/website-auth.ts';
import { sixMonthWindowLabel } from '../src/lib/community-export-format.ts';
import {
  filterActiveEvents,
  getEventPhase,
  getEventTimes,
} from '../src/lib/feed-logic.ts';
import { CSV_HEADER, EXPORT_MANIFEST_RECORD_TYPE } from '../../../lib/csv.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(HERE, '..');
const WEBSITE_URL = (
  process.env.E2E_WEBSITE_URL || 'https://ubdt-cse-community.vercel.app'
).replace(/\/+$/, '');
const SUPABASE_URL =
  process.env.E2E_SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON_KEY =
  process.env.E2E_SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

const CSV_PATH = '/api/export/community-activity';
const ADMIN_PATH = '/api/admin/faculty';
const UPLOAD_PATH = '/api/announcements/upload';

const PEOPLE_PROJECTION = [
  'id',
  'usn',
  'name',
  'year',
  'branch',
  'section',
  'bio',
  'avatar_url',
  'skills',
  'interests',
  'role',
  'faculty_status',
  'designation',
  'member_type',
  'graduation_year',
  'created_at',
].join(', ');

/** 1x1 transparent PNG. */
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

const results = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function redact(value) {
  const text = String(value ?? '');
  return SUPABASE_ANON_KEY ? text.replaceAll(SUPABASE_ANON_KEY, '[redacted]') : text;
}

async function check(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true });
    console.log(`PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (error) {
    results.push({ name, ok: false });
    console.error(`FAIL  ${name} — ${redact(error instanceof Error ? error.message : error)}`);
  }
}

function skip(name, reason) {
  results.push({ name, ok: true, skipped: true });
  console.log(`SKIP  ${name} — ${reason}`);
}

async function websiteFetch(pathname, options = {}) {
  const response = await fetch(`${WEBSITE_URL}${pathname}`, {
    credentials: 'omit',
    ...options,
  });
  return response;
}

async function jsonError(response) {
  const text = await response.text();
  try {
    const parsed = JSON.parse(text);
    return typeof parsed.error === 'string' ? parsed.error : text.slice(0, 200);
  } catch {
    return text.slice(0, 200);
  }
}

/** RFC 4180 parser with quoted fields and CRLF. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      field = '';
      if (!(row.length === 1 && row[0] === '')) rows.push(row);
      row = [];
    } else if (char !== '\r') {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function isoDate(value) {
  return Number.isFinite(Date.parse(value));
}

function supabaseClient() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error(
      'E2E_SUPABASE_URL and E2E_SUPABASE_ANON_KEY (or the EXPO_PUBLIC_ equivalents) are required for authenticated checks.'
    );
  }
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

async function signIn(prefix) {
  const email = process.env[`E2E_${prefix}_EMAIL`];
  const password = process.env[`E2E_${prefix}_PASSWORD`];
  if (!email || !password) return null;

  const client = supabaseClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`${prefix.toLowerCase()} sign-in failed: ${error.message}`);
  if (!data.session) throw new Error(`${prefix.toLowerCase()} sign-in returned no session`);

  if (sessionNeedsRefresh(data.session)) {
    const refreshed = await client.auth.refreshSession();
    if (refreshed.error || !refreshed.data.session) {
      throw new Error(`${prefix.toLowerCase()} session refresh failed`);
    }
    return { client, session: refreshed.data.session, userId: refreshed.data.user?.id };
  }

  return { client, session: data.session, userId: data.user?.id };
}

async function signOut(account) {
  await account.client.auth.signOut().catch(() => undefined);
}

function cookieFor(session) {
  return cookieHeader(buildSessionCookies(SUPABASE_URL, session));
}

function tamperedCookie() {
  assert(SUPABASE_URL, 'A Supabase URL is required to derive the real cookie name.');
  return cookieHeader(
    buildSessionCookies(SUPABASE_URL, {
      access_token: 'e2e-tampered-token-not-issued-by-supabase',
      refresh_token: 'e2e-tampered-refresh-token',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      token_type: 'bearer',
    })
  );
}

/* ----------------------------- local checks ------------------------------ */

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    else files.push(full);
  }
  return files;
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function sourceFiles() {
  const roots = ['app', 'components', 'lib'].map((part) => path.join(APP_ROOT, 'src', part));
  const files = [];
  for (const root of roots) {
    try {
      files.push(...(await walk(root)));
    } catch {
      // A future refactor may move a directory; the other checks still run.
    }
  }
  return files.filter((file) => /\.(ts|tsx)$/.test(file));
}

function relative(file) {
  return path.relative(APP_ROOT, file).replaceAll(path.sep, '/');
}

/* ------------------------------- checks ---------------------------------- */

async function anonymousChecks() {
  await check('anonymous CSV export is denied', async () => {
    const response = await websiteFetch(CSV_PATH, {
      headers: { Accept: 'application/json' },
    });
    assert(response.status === 403, `expected 403, got ${response.status}`);
    const body = await jsonError(response);
    assert(/approved faculty/i.test(body), `unexpected error: ${body}`);
    return 'HTTP 403, approved-faculty message';
  });

  await check('anonymous admin queue is denied', async () => {
    const response = await websiteFetch(ADMIN_PATH, {
      headers: { Accept: 'application/json' },
    });
    assert(response.status === 401, `expected 401, got ${response.status}`);
    const body = await jsonError(response);
    assert(/sign in required/i.test(body), `unexpected error: ${body}`);
    return 'HTTP 401';
  });

  await check('anonymous admin review is denied', async () => {
    const response = await websiteFetch(
      `${ADMIN_PATH}/00000000-0000-0000-0000-000000000000`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ decision: 'approve' }),
      }
    );
    assert(response.status === 401, `expected 401, got ${response.status}`);
    return 'HTTP 401 before any write';
  });

  await check('anonymous announcement image upload is denied', async () => {
    const form = new FormData();
    form.append('file', new Blob([PIXEL_PNG], { type: 'image/png' }), 'e2e-pixel.png');
    const response = await websiteFetch(UPLOAD_PATH, {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body: form,
    });
    assert(response.status === 401, `expected 401, got ${response.status}`);
    const body = await jsonError(response);
    assert(/sign in/i.test(body), `unexpected error: ${body}`);
    return 'HTTP 401';
  });

  if (!SUPABASE_URL) {
    skip(
      'tampered session cookie is rejected',
      'set E2E_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_URL to derive the real cookie name'
    );
  } else {
    await check('tampered session cookie is rejected', async () => {
      const headers = { Cookie: tamperedCookie(), Accept: 'application/json' };
      const csv = await websiteFetch(CSV_PATH, { headers });
      assert(csv.status === 403, `CSV expected 403, got ${csv.status}`);
      const admin = await websiteFetch(ADMIN_PATH, { headers });
      assert([401, 403].includes(admin.status), `admin expected 401/403, got ${admin.status}`);
      return 'server rejected a cookie with a non-Supabase token';
    });
  }

  await check('mobile source has no Network/messages routes or connection APIs', async () => {
    const forbiddenPaths = [
      path.join(APP_ROOT, 'src/app/(tabs)/network.tsx'),
      path.join(APP_ROOT, 'src/app/messages/[id].tsx'),
      path.join(APP_ROOT, 'src/app/people.tsx'),
    ];
    for (const file of forbiddenPaths) {
      assert(!(await exists(file)), `${relative(file)} still exists`);
    }

    const forbidden = [
      [/connection_requests/, 'connection_requests'],
      [/get_or_create_direct_conversation/, 'get_or_create_direct_conversation'],
      [/conversation_participants/, 'conversation_participants'],
      [/['"`]\/messages(?:\/|['"`?])/, '/messages deep link'],
      [/['"`]\/network['"`?]/, '/network deep link'],
    ];
    const hits = [];
    for (const file of await sourceFiles()) {
      const text = await readFile(file, 'utf8');
      for (const [pattern, label] of forbidden) {
        if (pattern.test(text)) hits.push(`${relative(file)}: ${label}`);
      }
    }
    assert(hits.length === 0, `obsolete references remain: ${hits.join(', ')}`);
    return 'no obsolete routes, deep links or connection APIs';
  });

  await check('People tab is present and not restricted to a connection flow', async () => {
    const peopleTab = path.join(APP_ROOT, 'src/app/(tabs)/people.tsx');
    const layout = path.join(APP_ROOT, 'src/app/(tabs)/_layout.tsx');
    assert(await exists(peopleTab), 'People tab is missing');
    assert((await stat(peopleTab)).size > 0, 'People tab is empty');
    const layoutText = await readFile(layout, 'utf8');
    assert(/name=["']people["']/.test(layoutText), 'People tab is not registered');
    return 'people.tsx is registered in the tab layout';
  });

  await check('ended events are filtered from every listing surface', async () => {
    const surfaces = [
      'src/app/(tabs)/events.tsx',
      'src/app/(tabs)/index.tsx',
      'src/lib/use-community-feed.ts',
    ];
    for (const surface of surfaces) {
      const text = await readFile(path.join(APP_ROOT, surface), 'utf8');
      assert(
        /filterActiveEvents|filterFeedEvents|isEventUpcoming/.test(text),
        `${surface} does not apply the active-event filter`
      );
    }
    return 'Events tab, feed and feed hook apply the IST phase filter';
  });
}

async function facultyChecks(account) {
  const cookie = cookieFor(account.session);
  const headers = { Cookie: cookie, Accept: 'application/json' };

  await check('faculty session is fresh enough for the website', async () => {
    assert(
      !sessionNeedsRefresh(account.session, Date.now(), 120_000),
      'session is inside the 120-second website refresh margin'
    );
    return 'outside the 120-second margin';
  });

  await check('faculty can download the real CSV with the expected contents', async () => {
    const response = await websiteFetch(CSV_PATH, {
      headers: { Cookie: cookie, Accept: 'text/csv' },
    });
    assert(response.status === 200, `expected 200, got ${response.status}`);

    const contentType = response.headers.get('content-type') ?? '';
    assert(contentType.toLowerCase().includes('text/csv'), `unexpected content type: ${contentType}`);

    const disposition = response.headers.get('content-disposition') ?? '';
    assert(
      /filename="ucc-community-activity-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.csv"/.test(
        disposition
      ),
      `unexpected disposition: ${disposition}`
    );

    const csv = await response.text();
    assert(csv.length > 0, 'CSV response was empty');
    const rows = parseCsv(csv);
    assert(rows.length >= 1 + 6, 'CSV is missing the header or manifest rows');

    assert(
      JSON.stringify(rows[0]) === JSON.stringify([...CSV_HEADER]),
      'CSV header does not match the website export contract'
    );
    for (const row of rows) {
      assert(row.length === CSV_HEADER.length, 'CSV is not rectangular');
    }

    const manifest = new Map();
    for (const row of rows.slice(1)) {
      if (row[0] === EXPORT_MANIFEST_RECORD_TYPE) manifest.set(row[1], row[2]);
    }
    for (const key of [
      'start_date',
      'end_date',
      'window_boundary',
      'lookback',
      'exported_at',
      'included_record_types',
    ]) {
      assert(manifest.has(key), `CSV manifest is missing ${key}`);
    }

    const startDate = manifest.get('start_date');
    const endDate = manifest.get('end_date');
    assert(isoDate(`${startDate}T00:00:00.000Z`), 'manifest start_date is invalid');
    assert(isoDate(`${endDate}T00:00:00.000Z`), 'manifest end_date is invalid');
    assert(
      response.headers.get('x-export-start-date') === startDate,
      'start-date header disagrees with the manifest'
    );
    assert(
      response.headers.get('x-export-end-date') === endDate,
      'end-date header disagrees with the manifest'
    );
    assert(
      manifest.get('window_boundary') === 'inclusive (UTC)',
      'window boundary is not the documented inclusive UTC window'
    );
    assert(
      manifest.get('included_record_types') === 'event;showcase;announcement',
      'record types do not match the export contract'
    );
    assert(
      manifest.get('lookback') === '6 calendar months',
      'lookback is not six calendar months'
    );

    // The displayed label must agree with the server's own window.
    const label = sixMonthWindowLabel(new Date(`${endDate}T12:00:00.000Z`));
    assert(
      label === `${startDate} to ${endDate}`,
      `client window label (${label}) disagrees with the server`
    );

    for (const row of rows.slice(1)) {
      if (row[0] === EXPORT_MANIFEST_RECORD_TYPE) continue;
      assert(
        ['event', 'showcase', 'announcement'].includes(row[0]),
        `unexpected record type: ${row[0]}`
      );
    }

    const artifactDir = process.env.E2E_ARTIFACT_DIR || path.join(tmpdir(), 'opencode');
    await mkdir(artifactDir, { recursive: true });
    const artifact = path.join(
      artifactDir,
      `ucc-e2e-community-activity-${Date.now()}.csv`
    );
    await writeFile(artifact, csv, 'utf8');

    const dataRows = rows.filter(
      (row) => row[0] !== EXPORT_MANIFEST_RECORD_TYPE
    ).length - 1;
    return `HTTP 200, ${dataRows} data rows, ${startDate} to ${endDate}, saved ${artifact}`;
  });

  await check('People projection matches the website and excludes the viewer', async () => {
    const { data, error } = await account.client
      .from('profiles')
      .select(PEOPLE_PROJECTION)
      .neq('id', account.userId)
      .order('created_at', { ascending: false })
      .limit(500);

    assert(!error, `People query failed: ${error?.message ?? 'unknown error'}`);
    const rows = data ?? [];
    assert(rows.length <= 500, 'People query returned more than the 500-row cap');
    assert(
      rows.every((row) => row.id !== account.userId),
      'People query included the signed-in viewer'
    );
    assert(
      rows.every((row) => !('email' in row) && !('employee_id' in row)),
      'People projection exposed a private column'
    );

    let previous = Number.POSITIVE_INFINITY;
    for (const row of rows) {
      const value = Date.parse(row.created_at);
      if (!Number.isFinite(value)) continue;
      assert(value <= previous, 'People rows are not newest-first');
      previous = value;
    }
    return `${rows.length} public profiles, self excluded, public columns only`;
  });

  await check('faculty cannot read the admin review queue', async () => {
    const response = await websiteFetch(ADMIN_PATH, { headers });
    assert(response.status === 403, `expected 403, got ${response.status}`);
    return 'HTTP 403 from the server role check';
  });

  await check('live events derive IST start/end and filter ended rows', async () => {
    const { data, error } = await account.client
      .from('events')
      .select('id, event_date, event_time, duration')
      .limit(50);
    assert(!error, `event query failed: ${error?.message ?? 'unknown error'}`);

    const event = (data ?? []).find((row) => row.event_date && row.event_time);
    if (!event) return 'no timed events available; pure boundary tests cover the rule';

    const times = getEventTimes(event);
    assert(times, 'a live event could not be parsed as IST');
    const expectedStart = new Date(
      `${event.event_date}T${event.event_time.length === 5 ? `${event.event_time}:00` : event.event_time}+05:30`
    );
    assert(
      times.start.toISOString() === expectedStart.toISOString(),
      'start is not event_date + event_time in IST'
    );

    const duration =
      Number.isFinite(event.duration) && event.duration > 0 ? event.duration : 60;
    assert(
      times.end.getTime() - times.start.getTime() === duration * 60_000,
      'end is not start + duration (default 60)'
    );

    assert(getEventPhase(event, new Date(times.start.getTime() - 1)) === 'upcoming', 'phase before start');
    assert(getEventPhase(event, times.start) === 'live', 'phase at start');
    assert(getEventPhase(event, new Date(times.end.getTime() - 1)) === 'live', 'phase just before end');
    assert(getEventPhase(event, times.end) === 'ended', 'phase at end');
    assert(filterActiveEvents([event], times.end).length === 0, 'ended event was not filtered');
    assert(filterActiveEvents([event], times.start).length === 1, 'live event was filtered');
    return `event ${event.event_date} ${event.event_time} IST, ${duration} minutes`;
  });

  if (process.env.E2E_ALLOW_IMAGE_UPLOAD === '1') {
    await check('anchor faculty image upload stores a public object', async () => {
      const form = new FormData();
      form.append('file', new Blob([PIXEL_PNG], { type: 'image/png' }), 'e2e-pixel.png');
      const response = await websiteFetch(UPLOAD_PATH, {
        method: 'POST',
        headers: { Cookie: cookie, Accept: 'application/json' },
        body: form,
      });
      assert(response.status === 200, `expected 200, got ${response.status}`);
      const payload = await response.json();
      assert(typeof payload.key === 'string' && payload.key.startsWith('announcements/'), 'upload key is outside announcements/');
      assert(
        typeof payload.publicUrl === 'string' && payload.publicUrl.startsWith('https://'),
        'upload did not return an HTTPS public URL'
      );

      let head = await fetch(payload.publicUrl, { method: 'HEAD' });
      if (head.status === 405) head = await fetch(payload.publicUrl);
      assert(head.ok, `uploaded object is not readable (HTTP ${head.status})`);
      return `stored ${payload.key}; remove it from R2 when finished`;
    });
  } else {
    skip('anchor faculty image upload stores a public object', 'set E2E_ALLOW_IMAGE_UPLOAD=1');
  }

  if (process.env.E2E_ALLOW_ANNOUNCEMENT_WRITES === '1') {
    let createdId = null;
    await check('faculty announcement create/edit/delete round-trip', async () => {
      const marker = `[E2E] mobile parity ${new Date().toISOString()}`;
      try {
        const inserted = await account.client
          .from('announcements')
          .insert({ author_id: account.userId, title: marker, body: 'created by e2e', image_urls: [] })
          .select('id, author_id, title, body, image_urls')
          .single();
        assert(!inserted.error && inserted.data, `insert failed: ${inserted.error?.message ?? 'no row'}`);
        createdId = inserted.data.id;
        assert(inserted.data.author_id === account.userId, 'inserted announcement has the wrong author');

        const updated = await account.client
          .from('announcements')
          .update({ body: 'edited by e2e' })
          .eq('id', createdId)
          .select('id, body')
          .single();
        assert(!updated.error && updated.data?.body === 'edited by e2e', 'update was not persisted');

        const deleted = await account.client
          .from('announcements')
          .delete()
          .eq('id', createdId)
          .select('id');
        assert(!deleted.error && deleted.data?.length === 1, 'delete was not persisted');
        createdId = null;
        return 'insert, author edit and delete all reached the database';
      } finally {
        if (createdId) {
          await account.client.from('announcements').delete().eq('id', createdId);
        }
      }
    });
  } else {
    skip('faculty announcement create/edit/delete round-trip', 'set E2E_ALLOW_ANNOUNCEMENT_WRITES=1');
  }

  await check('logout clears the session and blocks cookie construction', async () => {
    await account.client.auth.signOut();
    const { data } = await account.client.auth.getSession();
    assert(!data.session, 'the client still has a session after sign-out');
    let refused = false;
    try {
      buildSessionCookies(SUPABASE_URL, null);
    } catch {
      refused = true;
    }
    assert(refused, 'the mobile cookie builder accepted a missing session');
    return 'session cleared; null session refused before any request';
  });
}

async function adminChecks(account, facultyWasTested) {
  const cookie = cookieFor(account.session);
  const headers = { Cookie: cookie, Accept: 'application/json' };

  await check('admin can load the faculty application queue', async () => {
    const response = await websiteFetch(ADMIN_PATH, { headers });
    assert(response.status === 200, `expected 200, got ${response.status}`);
    const payload = await response.json();
    assert(Array.isArray(payload.applications), 'applications is not an array');
    assert(Array.isArray(payload.profiles), 'profiles is not an array');
    assert(payload.emailVerified && typeof payload.emailVerified === 'object', 'emailVerified is missing');
    if (payload.emailVerificationError) {
      return `${payload.applications.length} applications; email verification unavailable (${payload.emailVerificationError})`;
    }
    return `${payload.applications.length} applications, ${payload.profiles.length} profiles`;
  });

  await check('admin review rejects an invalid decision without writing', async () => {
    const response = await websiteFetch(
      `${ADMIN_PATH}/00000000-0000-0000-0000-000000000000`,
      {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'approved' }),
      }
    );
    assert(response.status === 400, `expected 400, got ${response.status}`);
    return 'HTTP 400';
  });

  if (facultyWasTested) {
    console.log('INFO  faculty → admin queue denial was verified in the faculty phase.');
  }

  if (process.env.E2E_ALLOW_ADMIN_REVIEW_WRITES === '1') {
    await check('admin review write is persisted and re-read from the queue', async () => {
      const applicationId = process.env.E2E_ADMIN_REVIEW_APPLICATION_ID;
      const decision = process.env.E2E_ADMIN_REVIEW_DECISION;
      assert(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          applicationId ?? ''
        ),
        'E2E_ADMIN_REVIEW_APPLICATION_ID must be a UUID'
      );
      assert(
        decision === 'approve' || decision === 'reject',
        'E2E_ADMIN_REVIEW_DECISION must be approve or reject'
      );

      const before = await websiteFetch(ADMIN_PATH, { headers });
      assert(before.status === 200, `queue load failed (${before.status})`);
      const beforePayload = await before.json();
      const application = (beforePayload.applications ?? []).find(
        (row) => row.id === applicationId
      );
      assert(application, 'application is not in the admin queue');
      assert(application.status === 'pending', `application is already ${application.status}`);

      const response = await websiteFetch(`${ADMIN_PATH}/${encodeURIComponent(applicationId)}`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, notes: 'Created by e2e-website-parity.mjs' }),
      });
      const payload = await response.json().catch(() => ({}));
      assert(response.status === 200, `review failed (${response.status}): ${payload.error ?? ''}`);
      const expected = decision === 'approve' ? 'approved' : 'rejected';
      assert(payload.status === expected, `response status was ${payload.status}, expected ${expected}`);

      const after = await websiteFetch(ADMIN_PATH, { headers });
      const afterPayload = await after.json();
      const persisted = (afterPayload.applications ?? []).find(
        (row) => row.id === applicationId
      );
      assert(persisted?.status === expected, 'the queue did not re-read the reviewed status');
      assert(persisted.reviewed_at, 'reviewed_at was not persisted');
      return `${expected}; permanent, no undo endpoint`;
    });
  } else {
    skip(
      'admin review write is persisted and re-read from the queue',
      'set E2E_ALLOW_ADMIN_REVIEW_WRITES=1 plus E2E_ADMIN_REVIEW_APPLICATION_ID and E2E_ADMIN_REVIEW_DECISION'
    );
  }

  await check('admin logout clears the session', async () => {
    await account.client.auth.signOut();
    const { data } = await account.client.auth.getSession();
    assert(!data.session, 'the admin client still has a session after sign-out');
    return 'session cleared';
  });
}

async function studentChecks(account) {
  const cookie = cookieFor(account.session);
  const headers = { Cookie: cookie, Accept: 'application/json' };

  await check('student is denied the community CSV export', async () => {
    const response = await websiteFetch(CSV_PATH, { headers });
    assert(response.status === 403, `expected 403, got ${response.status}`);
    return 'HTTP 403';
  });

  await check('student is denied the admin queue', async () => {
    const response = await websiteFetch(ADMIN_PATH, { headers });
    assert(response.status === 403, `expected 403, got ${response.status}`);
    return 'HTTP 403';
  });

  await check('student is denied announcement image upload', async () => {
    const form = new FormData();
    form.append('file', new Blob([PIXEL_PNG], { type: 'image/png' }), 'e2e-pixel.png');
    const response = await websiteFetch(UPLOAD_PATH, {
      method: 'POST',
      headers: { Cookie: cookie, Accept: 'application/json' },
      body: form,
    });
    assert(response.status === 403, `expected 403, got ${response.status}`);
    return 'HTTP 403 from the approved-faculty check';
  });

  await check('student logout clears the session', async () => {
    await account.client.auth.signOut();
    const { data } = await account.client.auth.getSession();
    assert(!data.session, 'the student client still has a session after sign-out');
    return 'session cleared';
  });
}

async function main() {
  console.log(`UCC mobile website parity E2E against ${WEBSITE_URL}`);
  console.log(
    'No cookies, passwords, tokens or keys are printed. Authenticated checks are skipped without credentials.\n'
  );

  await anonymousChecks();

  const faculty = await signIn('FACULTY').catch((error) => {
    throw new Error(`Faculty setup failed: ${error.message}`);
  });
  if (faculty) {
    try {
      await facultyChecks(faculty);
    } finally {
      await signOut(faculty);
    }
  } else {
    skip('faculty CSV, People, IST and authorization checks', 'set E2E_FACULTY_EMAIL/PASSWORD');
  }

  const admin = await signIn('ADMIN').catch((error) => {
    throw new Error(`Admin setup failed: ${error.message}`);
  });
  if (admin) {
    try {
      await adminChecks(admin, Boolean(faculty));
    } finally {
      await signOut(admin);
    }
  } else {
    skip('admin queue, review and authorization checks', 'set E2E_ADMIN_EMAIL/PASSWORD');
  }

  const student = await signIn('STUDENT').catch((error) => {
    throw new Error(`Student setup failed: ${error.message}`);
  });
  if (student) {
    try {
      await studentChecks(student);
    } finally {
      await signOut(student);
    }
  } else {
    skip('student denial checks', 'set E2E_STUDENT_EMAIL/PASSWORD (optional)');
  }

  const failed = results.filter((result) => !result.ok);
  const passed = results.filter((result) => result.ok && !result.skipped);
  const skippedResults = results.filter((result) => result.skipped);

  console.log(
    `\n${passed.length} passed, ${failed.length} failed, ${skippedResults.length} skipped.`
  );
  if (failed.length > 0) {
    console.error('\nFailed checks:');
    for (const result of failed) console.error(`- ${result.name}`);
    process.exitCode = 1;
  } else {
    console.log(
      'Denial and static checks passed. Authenticated workflows require the documented credentials.'
    );
  }
}

main().catch((error) => {
  console.error(`E2E harness failed: ${redact(error instanceof Error ? error.message : error)}`);
  process.exitCode = 1;
});
