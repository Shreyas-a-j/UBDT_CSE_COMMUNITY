// Email template for publish notifications (announcements + events).
//
// Pure module: no Deno APIs, no network, no environment reads — the
// worker (index.ts) resolves configuration and passes values in, and
// vitest imports this file directly under Node. Keep it that way so the
// rendering stays unit-testable outside the Edge runtime.

export const BRAND = 'UBDT CSE Community'

export interface PublishEmailInput {
  kind: 'announcement' | 'event'
  title: string
  body: string | null
  /** Relative app path carried by the in-app notification (deep link). */
  link: string
  /** Preformatted date/time line for events, e.g. "Workshop · Fri, Oct 30, 2026 · 10:00". */
  eventLine?: string | null
}

export function absoluteLink(siteUrl: string, link: string): string {
  const base = siteUrl.replace(/\/+$/, '')
  const path = link.startsWith('/') ? link : `/${link}`
  return base + path
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function buildSubject(input: PublishEmailInput): string {
  return input.kind === 'announcement'
    ? `New announcement: ${input.title}`
    : `New event: ${input.title}`
}

export function buildText(input: PublishEmailInput, siteUrl: string): string {
  const url = absoluteLink(siteUrl, input.link)
  const lines = [
    input.kind === 'announcement'
      ? 'A new announcement was published:'
      : 'A new event was posted:',
    '',
    input.title,
  ]
  if (input.kind === 'event' && input.eventLine) {
    lines.push('', input.eventLine)
  }
  if (input.body) {
    lines.push('', input.body)
  }
  lines.push('', `Open it here: ${url}`, '', `— ${BRAND}`)
  return lines.join('\n')
}

export function buildHtml(input: PublishEmailInput, siteUrl: string): string {
  const url = absoluteLink(siteUrl, input.link)
  const urlHtml = escapeHtml(url)
  const title = escapeHtml(input.title)
  const kicker =
    input.kind === 'announcement' ? 'New announcement' : 'New event'

  const eventRow =
    input.kind === 'event' && input.eventLine
      ? `<p style="margin:0 0 12px;font-size:15px;color:#334155;"><strong>${escapeHtml(input.eventLine)}</strong></p>`
      : ''

  const bodyRow = input.body
    ? `<p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#334155;">${escapeHtml(input.body)}</p>`
    : ''

  return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;padding:28px 24px;">
          <tr><td style="font-size:13px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#64748b;">${escapeHtml(BRAND)}</td></tr>
          <tr><td style="padding-top:10px;font-size:13px;color:#94a3b8;">${escapeHtml(kicker)}</td></tr>
          <tr><td style="padding:6px 0 12px;font-size:22px;font-weight:700;color:#0f172a;">${title}</td></tr>
          <tr><td>${eventRow}${bodyRow}</td></tr>
          <tr><td style="padding-top:4px;">
            <a href="${urlHtml}" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:10px 20px;border-radius:8px;">View in the community</a>
          </td></tr>
          <tr><td style="padding-top:18px;font-size:12px;color:#94a3b8;">You receive community notifications because you are a member of ${escapeHtml(BRAND)}. You can turn email notifications off in your account settings.</td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`
}
