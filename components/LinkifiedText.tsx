import React from 'react'
import { parseLinks } from '@/lib/linkify'

interface LinkifiedTextProps {
  /** Raw, user-provided description text (never HTML). */
  text: string
  /** Optional class applied to every rendered anchor. */
  linkClassName?: string
}

/**
 * Renders plain text with every valid http(s) URL turned into a semantic,
 * keyboard-focusable <a target="_blank" rel="noopener noreferrer">. All other
 * text — including line breaks and surrounding punctuation — is emitted as
 * plain text nodes, so the parent element's existing whitespace and layout
 * behaviour (e.g. `whitespace-pre-line`) keeps working unchanged.
 *
 * hrefs come from `parseLinks`, which only returns URLs validated to http(s),
 * so unsafe schemes such as `javascript:` or `data:` can never render as links.
 * No HTML is ever parsed or injected: tokens are rendered as React children.
 */
const DEFAULT_LINK_CLASS =
  'text-accent-text underline underline-offset-2 decoration-accent-text/50 transition-colors hover:text-accent-text/80 hover:decoration-accent-text'

export default function LinkifiedText({ text, linkClassName }: LinkifiedTextProps) {
  const tokens = parseLinks(text)

  return (
    <>
      {tokens.map((token, index) =>
        token.type === 'link' ? (
          <a
            key={index}
            href={token.href}
            target="_blank"
            rel="noopener noreferrer"
            className={linkClassName ?? DEFAULT_LINK_CLASS}
          >
            {token.label}
          </a>
        ) : (
          <React.Fragment key={index}>{token.value}</React.Fragment>
        )
      )}
    </>
  )
}
