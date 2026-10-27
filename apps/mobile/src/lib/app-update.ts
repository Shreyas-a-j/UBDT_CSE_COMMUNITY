/**
 * Pure Android APK update discovery.
 *
 * The remote manifest is public, cache-busted JSON. This module deliberately
 * has no React Native, Expo, or DOM dependencies so its version, validation,
 * network, and prompt rules can be tested under plain Node.
 *
 * Fail-open contract: a missing, slow, malformed, or hostile manifest must
 * never stop the app from opening. Callers receive an `unavailable` result and
 * keep using the installed build.
 */

/**
 * Public R2 object next to the APK. The manifest is intentionally independent
 * of the website deployment so a release can be published without touching
 * the Next.js app.
 */
export const DEFAULT_UPDATE_MANIFEST_URL =
  'https://pub-984d3335c03543f6bbddf6400b88a737.r2.dev/app/android-update.json';

/** Android's documented maximum versionCode. */
const MAX_VERSION_CODE = 2_100_000_000;

const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_RELEASE_NOTES = 20;
const MAX_RELEASE_NOTE_LENGTH = 500;
const DEFAULT_TIMEOUT_MS = 8_000;

export interface UpdateManifest {
  version: string;
  versionCode: number;
  apkUrl: string;
  releaseNotes: string[];
  mandatory: boolean;
}

export interface InstalledAppVersion {
  version: string;
  versionCode: number;
}

export interface AvailableUpdate {
  manifest: UpdateManifest;
  installed: InstalledAppVersion;
}

export type UpdateCheckResult =
  | { status: 'available'; update: AvailableUpdate }
  | { status: 'up-to-date' }
  | {
      status: 'unavailable';
      reason:
        | 'configuration'
        | 'timeout'
        | 'network'
        | 'server'
        | 'invalid-response'
        | 'invalid-manifest';
      message: string;
    };

export type UpdatePromptPhase = 'idle' | 'opening' | 'opened';

export interface UpdatePrompt {
  update: AvailableUpdate;
  phase: UpdatePromptPhase;
  error: string | null;
}

export type UpdatePromptAction =
  | { type: 'show'; update: AvailableUpdate }
  | { type: 'download-started' }
  | { type: 'download-opened' }
  | { type: 'download-failed'; message: string }
  | { type: 'dismiss' }
  | { type: 'continue' };

/* ------------------------------- Versions -------------------------------- */

interface ParsedVersion {
  numbers: number[];
  prerelease: string[] | null;
}

/**
 * Parse `1`, `1.2`, `1.2.3`, or `1.2.3-beta.1`. Android's versionName is free
 * text, but the UCC manifest only accepts this deterministic subset.
 */
function parseVersion(value: string): ParsedVersion {
  if (typeof value !== 'string') {
    throw new Error('A version number is required.');
  }

  const match = /^(\d+(?:\.\d+){0,3})(?:-([0-9A-Za-z.-]+))?$/.exec(value.trim());
  if (!match) {
    throw new Error(`Invalid version number: ${value}`);
  }

  const numbers = match[1].split('.').map((part) => {
    const number = Number(part);
    if (!Number.isSafeInteger(number)) {
      throw new Error(`Invalid version number: ${value}`);
    }
    return number;
  });

  let prerelease: string[] | null = null;
  if (match[2]) {
    prerelease = match[2].split('.');
    if (prerelease.some((part) => part.length === 0)) {
      throw new Error(`Invalid version number: ${value}`);
    }
  }

  return { numbers, prerelease };
}

/**
 * Compare two version names. Returns -1, 0, or 1. Missing numeric segments
 * are zero, and any prerelease sorts before the matching release.
 */
export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left);
  const b = parseVersion(right);
  const length = Math.max(a.numbers.length, b.numbers.length);

  for (let index = 0; index < length; index += 1) {
    const aPart = a.numbers[index] ?? 0;
    const bPart = b.numbers[index] ?? 0;
    if (aPart !== bPart) return aPart > bPart ? 1 : -1;
  }

  if (a.prerelease === null && b.prerelease === null) return 0;
  if (a.prerelease === null) return 1;
  if (b.prerelease === null) return -1;

  const prereleaseLength = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < prereleaseLength; index += 1) {
    const aPart = a.prerelease[index];
    const bPart = b.prerelease[index];
    if (aPart === undefined) return -1;
    if (bPart === undefined) return 1;
    if (aPart === bPart) continue;

    const aNumeric = /^\d+$/.test(aPart);
    const bNumeric = /^\d+$/.test(bPart);
    if (aNumeric && bNumeric) {
      return Number(aPart) > Number(bPart) ? 1 : -1;
    }
    if (aNumeric) return -1;
    if (bNumeric) return 1;
    return aPart > bPart ? 1 : -1;
  }

  return 0;
}

/* -------------------------------- Manifest ------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(
  value: unknown,
  field: string,
  maxLength: number
): string {
  if (typeof value !== 'string') {
    throw new Error(`${field} must be a string.`);
  }
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field} must not be empty.`);
  if (trimmed.length > maxLength) {
    throw new Error(`${field} is too long.`);
  }
  return trimmed;
}

function normalizeHttpsUrl(value: string, field: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${field} must be an absolute URL.`);
  }

  if (url.protocol !== 'https:') {
    throw new Error(`${field} must use HTTPS.`);
  }
  if (url.username || url.password) {
    throw new Error(`${field} must not contain credentials.`);
  }

  return url.toString();
}

/** Validate and normalize the direct APK download URL. */
export function normalizeApkUrl(value: string): string {
  const url = new URL(normalizeHttpsUrl(value, 'apkUrl'));
  if (!url.pathname.toLowerCase().endsWith('.apk')) {
    throw new Error('apkUrl must point directly at an .apk file.');
  }
  return url.toString();
}

/**
 * Validate an untrusted JSON payload. Unknown fields are ignored; every field
 * this client relies on is required and type-checked.
 */
export function parseUpdateManifest(payload: unknown): UpdateManifest {
  if (!isRecord(payload)) {
    throw new Error('The update manifest must be an object.');
  }

  const version = requireString(payload.version, 'version', 64);
  parseVersion(version);

  const versionCode = payload.versionCode;
  if (
    typeof versionCode !== 'number' ||
    !Number.isSafeInteger(versionCode) ||
    versionCode <= 0 ||
    versionCode > MAX_VERSION_CODE
  ) {
    throw new Error('versionCode must be a positive Android version code.');
  }

  const apkUrl = normalizeApkUrl(requireString(payload.apkUrl, 'apkUrl', 2_048));

  if (!Array.isArray(payload.releaseNotes)) {
    throw new Error('releaseNotes must be an array of strings.');
  }
  if (
    payload.releaseNotes.length === 0 ||
    payload.releaseNotes.length > MAX_RELEASE_NOTES
  ) {
    throw new Error('releaseNotes must contain between 1 and 20 entries.');
  }
  const releaseNotes = payload.releaseNotes.map((note) =>
    requireString(note, 'releaseNotes', MAX_RELEASE_NOTE_LENGTH)
  );

  if (typeof payload.mandatory !== 'boolean') {
    throw new Error('mandatory must be a boolean.');
  }

  return {
    version,
    versionCode,
    apkUrl,
    releaseNotes,
    mandatory: payload.mandatory,
  };
}

/**
 * Select the manifest URL. `override` is the build-time
 * EXPO_PUBLIC_UPDATE_MANIFEST_URL value; the public R2 object is the default.
 */
export function resolveUpdateManifestUrl(
  override: string | undefined,
  fallback = DEFAULT_UPDATE_MANIFEST_URL
): string {
  const configured = override?.trim();
  return normalizeHttpsUrl(
    configured || fallback,
    'The update manifest URL'
  );
}

/**
 * Compare the manifest with the installed APK. versionCode is authoritative
 * because that is what Android enforces. A manifest whose version name is
 * older than the installed name is treated as stale even if its code is newer.
 */
export function evaluateUpdate(
  manifest: UpdateManifest,
  installed: InstalledAppVersion
): AvailableUpdate | null {
  if (manifest.versionCode <= installed.versionCode) return null;

  try {
    if (compareVersions(manifest.version, installed.version) < 0) return null;
  } catch {
    // A malformed installed versionName must not block a valid versionCode.
  }

  return { manifest, installed };
}

/** Session policy: optional versions can be postponed; mandatory ones cannot. */
export function shouldShowUpdate(
  update: AvailableUpdate,
  session: {
    dismissedVersionCodes: ReadonlySet<number>;
    initiatedVersionCodes: ReadonlySet<number>;
  }
): boolean {
  if (session.initiatedVersionCodes.has(update.manifest.versionCode)) return false;
  if (update.manifest.mandatory) return true;
  return !session.dismissedVersionCodes.has(update.manifest.versionCode);
}

/**
 * Dialog state machine.
 *
 * - Optional updates can be dismissed at any phase.
 * - Mandatory updates cannot be dismissed until the download has been opened.
 * - A failed download returns to idle with a retryable error.
 */
export function updatePromptReducer(
  state: UpdatePrompt | null,
  action: UpdatePromptAction
): UpdatePrompt | null {
  switch (action.type) {
    case 'show':
      return { update: action.update, phase: 'idle', error: null };

    case 'download-started':
      if (!state || (state.phase !== 'idle' && state.phase !== 'opened')) {
        return state;
      }
      return { ...state, phase: 'opening', error: null };

    case 'download-opened':
      if (!state || state.phase !== 'opening') return state;
      return { ...state, phase: 'opened', error: null };

    case 'download-failed':
      if (!state) return state;
      return { ...state, phase: 'idle', error: action.message };

    case 'dismiss':
      if (!state) return state;
      if (state.update.manifest.mandatory && state.phase !== 'opened') return state;
      return null;

    case 'continue':
      if (!state || state.phase !== 'opened') return state;
      return null;

    default:
      return state;
  }
}

/* --------------------------------- Fetch --------------------------------- */

function unavailable(
  reason: Extract<UpdateCheckResult, { status: 'unavailable' }>['reason'],
  message: string
): UpdateCheckResult {
  return { status: 'unavailable', reason, message };
}

/**
 * Fetch and validate a manifest. Never throws for transport, server, or
 * payload failures; callers can safely ignore `unavailable`.
 */
export async function checkForUpdate(options: {
  manifestUrl: string;
  installed: InstalledAppVersion;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
}): Promise<UpdateCheckResult> {
  let manifestUrl: string;
  try {
    manifestUrl = normalizeHttpsUrl(options.manifestUrl, 'The update manifest URL');
  } catch {
    return unavailable(
      'configuration',
      'Update checking is not configured correctly.'
    );
  }

  const requestUrl = new URL(manifestUrl);
  requestUrl.searchParams.set('_', String((options.now ?? Date.now)()));

  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  );

  try {
    const response = await fetchImpl(requestUrl.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });

    if (!response.ok) {
      return unavailable('server', 'The update server is unavailable right now.');
    }

    const declaredLength = Number(response.headers.get('content-length') ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_MANIFEST_BYTES) {
      return unavailable('invalid-response', 'The update response was too large.');
    }

    let text: string;
    try {
      text = await response.text();
    } catch {
      return unavailable(
        'invalid-response',
        'The update response could not be read.'
      );
    }

    if (text.length > MAX_MANIFEST_BYTES) {
      return unavailable('invalid-response', 'The update response was too large.');
    }

    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      return unavailable(
        'invalid-response',
        'The update server returned an unreadable response.'
      );
    }

    let manifest: UpdateManifest;
    try {
      manifest = parseUpdateManifest(payload);
    } catch {
      return unavailable(
        'invalid-manifest',
        'The update server returned invalid update details.'
      );
    }

    const update = evaluateUpdate(manifest, options.installed);
    return update ? { status: 'available', update } : { status: 'up-to-date' };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return unavailable('timeout', 'The update check timed out.');
    }
    return unavailable('network', 'The update server could not be reached.');
  } finally {
    clearTimeout(timer);
  }
}
