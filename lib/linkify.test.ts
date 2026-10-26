/**
 * Link-tokenizer tests for discussion description linkification.
 *
 * The tokenizer must find every http(s)/www URL (including several per
 * description and across lines), keep the surrounding text byte-for-byte,
 * drop sentence punctuation from the link target, and refuse to produce a
 * link for unsafe values such as `javascript:` or `data:`.
 */
import { describe, it, expect } from 'vitest'
import { parseLinks, type LinkToken } from './linkify'

const linksOf = (tokens: LinkToken[]) => tokens.filter(t => t.type === 'link')

/** Rebuild the original string: text tokens verbatim, link tokens as their label. */
const reconstruct = (tokens: LinkToken[]) =>
  tokens.map(t => (t.type === 'text' ? t.value : t.label)).join('')

describe('parseLinks', () => {
  it('returns no tokens for empty text', () => {
    expect(parseLinks('')).toEqual([])
  })

  it('returns link-less text as a single text token', () => {
    const tokens = parseLinks('Just a plain description with no links at all.')
    expect(tokens).toEqual([{ type: 'text', value: 'Just a plain description with no links at all.' }])
    expect(linksOf(tokens)).toHaveLength(0)
  })

  it('detects a https URL and keeps the surrounding text', () => {
    const text = 'Check https://github.com/user/repo for details'
    const tokens = parseLinks(text)
    expect(linksOf(tokens)).toEqual([
      { type: 'link', href: 'https://github.com/user/repo', label: 'https://github.com/user/repo' },
    ])
    expect(reconstruct(tokens)).toBe(text)
    expect(tokens[0]).toEqual({ type: 'text', value: 'Check ' })
  })

  it('detects http URLs', () => {
    const tokens = parseLinks('Mirror at http://example.org/page')
    expect(linksOf(tokens)).toEqual([
      { type: 'link', href: 'http://example.org/page', label: 'http://example.org/page' },
    ])
  })

  it('upgrades www links to https', () => {
    const tokens = parseLinks('See www.example.com today')
    expect(linksOf(tokens)).toEqual([
      { type: 'link', href: 'https://www.example.com', label: 'www.example.com' },
    ])
  })

  it('detects multiple links mixed with ordinary text', () => {
    const text = 'Repo https://github.com/user/repo and docs www.example.com plus http://foo.example.net/x'
    const tokens = parseLinks(text)
    expect(linksOf(tokens).map(l => l.href)).toEqual([
      'https://github.com/user/repo',
      'https://www.example.com',
      'http://foo.example.net/x',
    ])
    expect(reconstruct(tokens)).toBe(text)
  })

  it('preserves line breaks and multiline descriptions exactly', () => {
    const text =
      'First line https://a.example.com\nSecond line www.example.com\n\nThird line with no link.'
    const tokens = parseLinks(text)
    expect(linksOf(tokens)).toHaveLength(2)
    expect(reconstruct(tokens)).toBe(text)
    expect(reconstruct(tokens)).toContain('\n')
  })

  it('strips trailing commas, periods and parentheses from links but keeps them in the text', () => {
    const text = 'See https://example.com/post, then https://example.org/x. Finally (https://foo.example.net).'
    const tokens = parseLinks(text)
    expect(linksOf(tokens).map(l => l.label)).toEqual([
      'https://example.com/post',
      'https://example.org/x',
      'https://foo.example.net',
    ])
    expect(reconstruct(tokens)).toBe(text)
  })

  it('keeps balanced parentheses inside a URL', () => {
    const tokens = parseLinks('Wikipedia: https://en.wikipedia.org/wiki/Foo_(bar)')
    expect(linksOf(tokens)[0].label).toBe('https://en.wikipedia.org/wiki/Foo_(bar)')
  })

  it('drops an unbalanced closing bracket and closing quote', () => {
    const tokens = parseLinks('(see [https://example.com/a]) and "https://example.org/b"')
    expect(linksOf(tokens).map(l => l.label)).toEqual([
      'https://example.com/a',
      'https://example.org/b',
    ])
  })

  it('never links javascript: or data: values', () => {
    const cases = [
      'javascript:alert(1)',
      'Try javascript:alert(1) now',
      'data:text/html;base64,PHNjcmlwdD4=',
      'JaVaScRiPt:alert(1)',
    ]
    for (const text of cases) {
      const tokens = parseLinks(text)
      expect(linksOf(tokens)).toEqual([])
      expect(reconstruct(tokens)).toBe(text)
    }
  })

  it('rejects malformed candidates that would otherwise parse oddly', () => {
    expect(linksOf(parseLinks('visit www. now'))).toEqual([])
    expect(linksOf(parseLinks('abchttps://example.com'))).toEqual([])
    expect(reconstruct(parseLinks('visit www. now'))).toBe('visit www. now')
  })

  it('is safe against a scheme smuggling a URL-looking string', () => {
    const tokens = parseLinks("javascript:alert('https://evil.example.com')")
    // The javascript: prefix itself is never a link; the inner http URL may be,
    // but its href is a validated https URL, never the javascript scheme.
    for (const link of linksOf(tokens)) {
      expect(link.href.startsWith('http')).toBe(true)
    }
    expect(reconstruct(tokens)).toBe("javascript:alert('https://evil.example.com')")
  })
})
