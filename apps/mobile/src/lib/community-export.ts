/**
 * Download the website's six-month community activity CSV on Android.
 *
 * Authorization is not duplicated here. The app sends its real Supabase session
 * in the website's cookie format and the existing `/api/export/...` route
 * re-reads the caller's profile and enforces approved-faculty access. The
 * mobile profile check only decides whether to show the button.
 *
 * The native downloader is used (rather than `fetch`) because the CSV can be
 * large; it writes into the app cache and is shared through Android's system
 * share sheet, matching the website's browser download behavior.
 */

import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

import { websiteAuthHeaders, websiteOriginUrl } from './website-api';
import { filenameFromContentDisposition, normalizedHeaders, safeCsvFilename } from './community-export-format';

export const COMMUNITY_ACTIVITY_EXPORT_PATH = '/api/export/community-activity';

export interface DownloadedCsv {
  uri: string;
  filename: string;
}

function errorFromBody(text: string, status: number): string {
  const trimmed = text.trim();
  if (trimmed) {
    try {
      const parsed = JSON.parse(trimmed) as { error?: unknown; message?: unknown };
      const detail =
        typeof parsed.error === 'string'
          ? parsed.error
          : typeof parsed.message === 'string'
            ? parsed.message
            : '';
      if (detail) return detail;
    } catch {
      // Fall back to the generic status message.
    }
  }
  if (status === 401 || status === 403) return 'Approved faculty access is required for this export.';
  return `The export failed (${status}).`;
}

export async function downloadCommunityActivityCsv(): Promise<DownloadedCsv> {
  if (!FileSystem.cacheDirectory) {
    throw new Error('This device has no writable cache directory for the export.');
  }

  const auth = await websiteAuthHeaders();
  const destination = `${FileSystem.cacheDirectory}ucc-export-${Date.now()}.csv`;

  const result = await FileSystem.downloadAsync(
    websiteOriginUrl(COMMUNITY_ACTIVITY_EXPORT_PATH),
    destination,
    {
      headers: {
        Accept: 'text/csv',
        Cookie: auth.Cookie,
      },
    }
  );

  if (result.status < 200 || result.status >= 300) {
    const body = await FileSystem.readAsStringAsync(result.uri).catch(() => '');
    await FileSystem.deleteAsync(result.uri, { idempotent: true }).catch(() => undefined);
    throw new Error(errorFromBody(body, result.status));
  }

  const headers = normalizedHeaders(result.headers);
  if (headers['content-type'] && !headers['content-type'].toLowerCase().includes('text/csv')) {
    await FileSystem.deleteAsync(result.uri, { idempotent: true }).catch(() => undefined);
    throw new Error('The website returned an unexpected response instead of the CSV.');
  }

  const info = await FileSystem.getInfoAsync(result.uri);
  if (!info.exists || (typeof info.size === 'number' && info.size === 0)) {
    await FileSystem.deleteAsync(result.uri, { idempotent: true }).catch(() => undefined);
    throw new Error('The downloaded CSV was empty.');
  }

  const filename = safeCsvFilename(
    filenameFromContentDisposition(headers['content-disposition'] ?? null)
  );

  return { uri: result.uri, filename };
}

export async function shareCommunityActivityCsv(file: DownloadedCsv): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error(`The CSV was downloaded as ${file.filename}, but this device cannot open a share sheet.`);
  }

  await Sharing.shareAsync(file.uri, {
    mimeType: 'text/csv',
    dialogTitle: file.filename,
    UTI: 'public.comma-separated-values-text',
  });
}

/** Download then open the system share sheet. */
export async function exportCommunityActivityCsv(): Promise<DownloadedCsv> {
  const file = await downloadCommunityActivityCsv();
  await shareCommunityActivityCsv(file);
  return file;
}
