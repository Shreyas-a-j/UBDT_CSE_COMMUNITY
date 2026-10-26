/**
 * URL tokenization for user-written description text.
 *
 * Turns plain text into a sequence of text/link tokens so callers can render
 * every valid http(s) URL as a real <a> while leaving the rest of the text
 * (whitespace, line breaks, punctuation) byte-for-byte identical.
 *
 * Safety model:
 *   - only text starting with `http://`, `https://` or `www.` is considered,
 *     so `javascript:`, `data:` and friends never match in the first place
 *   - every candidate is additionally parsed with the URL constructor and
 *     rejected unless the resulting protocol is http(s) (defense in depth)
 *   - a hostname must contain a dot, which rejects degenerate parses such as
 *     a bare trailing `www.` and keeps obviously-broken matches unlinked
 *   - the returned href is the candidate we validated, never a re-parse of
 *     raw user input, so an unsafe scheme can never reach an anchor
 */

export type LinkToken =
  | { type: 'text'; value: string }
  | { type: 'link'; href: string; label: string }

/** Matches a URL start (`https://`, `http://`, `www.`) up to the next space. */
const URL_PATTERN = /(?:https?:\/\/|www\.)[^\s<>]+/gi

/** Characters stripped from the end of a URL when they read as sentence punctuation. */
const TRAILING_PUNCTUATION = ',;:!?.'

/** Closing brackets trimmed only when they are not balanced inside the URL. */
const BRACKET_PAIRS: Record<string, string> = { ')': '(', ']': '[', '}': '{' }

/** A URL token may not start right after a word character or hyphen, so
 * `abchttps://x.com` or `mywww.example.com` stay plain text. */
const WORD_CHAR = /[\w-]/

function countChar(haystack: string, needle: string): number {
  let count = 0
  for (const char of haystack) if (char === needle) count += 1
  return count
}

/**
 * Remove sentence punctuation glued to the end of a matched URL.
 * `(see https://example.com).` yields `https://example.com` plus a `.`
 * remainder, while balanced brackets such as
 * `https://en.wikipedia.org/wiki/Foo_(bar)` are kept intact.
 */
function trimTrailingPunctuation(raw: string): string {
  let url = raw
  for (;;) {
    const last = url.charAt(url.length - 1)
    if (!last) return url
    if (TRAILING_PUNCTUATION.includes(last)) {
      url = url.slice(0, -1)
      continue
    }
    const opener = BRACKET_PAIRS[last]
    if (opener) {
      if (countChar(url, last) > countChar(url, opener)) {
        url = url.slice(0, -1)
        continue
      }
      return url
    }
    if (last === '"' || last === "'") {
      if (countChar(url, last) % 2 === 1) {
        url = url.slice(0, -1)
        continue
      }
      return url
    }
    return url
  }
}

/**
 * Validate a candidate URL and return the href to render, or null when the
 * value must not become clickable. `www.` links are upgraded to https.
 */
function safeHref(raw: string): string | null {
  if (!raw) return null
  const candidate = /^www\./i.test(raw) ? `https://${raw}` : raw
  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  if (!parsed.hostname.includes('.')) return null
  return candidate
}

/**
 * Split `text` into plain-text and link tokens.
 *
 * Guarantees:
 *   - concatenating every token's value/label reproduces `text` exactly
 *     (surrounding text, paragraphs, line breaks and whitespace preserved)
 *   - every link token has an http(s) href and a non-empty display label
 *   - empty text produces no tokens; link-less text produces one text token
 */
export function parseLinks(text: string): LinkToken[] {
  if (!text) return []

  const tokens: LinkToken[] = []
  const pattern = new RegExp(URL_PATTERN.source, 'gi')
  let cursor = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text)) !== null) {
    const start = match.index

    // Skip matches glued to the preceding word (e.g. `abchttps://x.com`).
    if (start > 0 && WORD_CHAR.test(text.charAt(start - 1))) continue

    const label = trimTrailingPunctuation(match[0])
    const href = safeHref(label)
    if (!href) continue

    if (start > cursor) tokens.push({ type: 'text', value: text.slice(cursor, start) })
    tokens.push({ type: 'link', href, label })
    cursor = start + label.length
  }

  // Trailing text (or the whole string when no URL matched) stays plain.
  if (cursor < text.length) tokens.push({ type: 'text', value: text.slice(cursor) })

  return tokens
}
