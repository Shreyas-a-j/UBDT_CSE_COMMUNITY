// OneSignal transport adapter. The only file that knows the provider's
// HTTP shape. Injectable fetch keeps it Node-testable.

import type { OneSignalResponseBody } from './policy'

export interface OneSignalConfig {
  appId: string
  apiKey: string
  fetchImpl?: typeof fetch
}

export interface PushRequest {
  /** Supabase UUID; OneSignal external_id, never an email address. */
  userId: string
  /** notification_push_outbox.id; provider idempotency key. */
  outboxId: string
  notificationId: string
  title: string
  body: string
  contentType: string | null
  contentId: string | null
  link: string | null
}

export type TransportResult =
  | { kind: 'response'; status: number; body: OneSignalResponseBody | null }
  | { kind: 'network-error'; message: string }

const ONESIGNAL_ENDPOINT = 'https://api.onesignal.com/notifications'

export function buildPushBody(config: Pick<OneSignalConfig, 'appId'>, payload: PushRequest) {
  return {
    app_id: config.appId,
    include_aliases: { external_id: [payload.userId] },
    target_channel: 'push',
    idempotency_key: payload.outboxId,
    headings: { en: payload.title },
    contents: { en: payload.body || payload.title },
    data: {
      notification_id: payload.notificationId,
      content_type: payload.contentType,
      content_id: payload.contentId,
      link: payload.link,
    },
    android_group: `ucc_${payload.contentType ?? 'notification'}`,
  }
}

export async function sendViaOneSignal(
  config: OneSignalConfig,
  payload: PushRequest,
): Promise<TransportResult> {
  const doFetch = config.fetchImpl ?? fetch
  try {
    const response = await doFetch(ONESIGNAL_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Key ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildPushBody(config, payload)),
    })

    let body: OneSignalResponseBody | null = null
    try {
      body = (await response.json()) as OneSignalResponseBody
    } catch {
      body = null
    }
    return { kind: 'response', status: response.status, body }
  } catch (err) {
    return {
      kind: 'network-error',
      message: err instanceof Error ? err.message : String(err),
    }
  }
}
