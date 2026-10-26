/**
 * LinkifiedText rendering tests.
 *
 * The component must emit semantic, keyboard-focusable anchors with a valid
 * http(s) href, target=_blank and rel="noopener noreferrer"; upgrade www to
 * https; preserve surrounding text and line breaks; and never render unsafe
 * values (javascript:, data:) as links. It renders React text nodes only —
 * no HTML parsing — so user markup stays literal text.
 */
import { describe, it, expect } from 'vitest'
import React from 'react'
import { render, screen } from '@testing-library/react'
import LinkifiedText from './LinkifiedText'

describe('LinkifiedText', () => {
  it('renders a https URL as a safe external anchor', () => {
    render(<LinkifiedText text="Repo: https://github.com/user/repo" />)
    const link = screen.getByRole('link', { name: 'https://github.com/user/repo' })
    expect(link).toHaveAttribute('href', 'https://github.com/user/repo')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('converts www links to https', () => {
    render(<LinkifiedText text="Visit www.example.com now" />)
    const link = screen.getByRole('link', { name: 'www.example.com' })
    expect(link).toHaveAttribute('href', 'https://www.example.com')
  })

  it('renders multiple links in one description', () => {
    const { container } = render(
      <LinkifiedText text="A https://one.example.com and B www.example.com" />
    )
    const links = container.querySelectorAll('a')
    expect(links).toHaveLength(2)
    expect(links[0]).toHaveAttribute('href', 'https://one.example.com')
    expect(links[1]).toHaveAttribute('href', 'https://www.example.com')
  })

  it('preserves all surrounding text and line breaks exactly', () => {
    const text = 'Line one https://a.example.com,\nLine two (www.example.com).\n\nLine three.'
    const { container } = render(<LinkifiedText text={text} />)
    expect(container.textContent).toBe(text)
    expect(container.querySelectorAll('a')).toHaveLength(2)
  })

  it('keeps trailing punctuation outside the anchor', () => {
    render(<LinkifiedText text="Read https://example.com/post, please" />)
    expect(screen.getByRole('link', { name: 'https://example.com/post' })).toBeInTheDocument()
    expect(screen.getByText(/, please$/)).toBeInTheDocument()
  })

  it('does not render unsafe values as links', () => {
    const text = 'Bad input: javascript:alert(1) and data:text/html;base64,PHNjcmlwdD4='
    const { container } = render(<LinkifiedText text={text} />)
    expect(container.querySelectorAll('a')).toHaveLength(0)
    expect(container.textContent).toBe(text)
    expect(container.querySelector('[href^="javascript:"]')).toBeNull()
    expect(container.querySelector('[href^="data:"]')).toBeNull()
  })

  it('renders nothing for an empty description', () => {
    const { container } = render(<LinkifiedText text="" />)
    expect(container.querySelectorAll('a')).toHaveLength(0)
    expect(container.textContent).toBe('')
  })

  it('renders link-less descriptions as plain text without anchors', () => {
    const { container } = render(<LinkifiedText text="A perfectly normal sentence." />)
    expect(container.querySelectorAll('a')).toHaveLength(0)
    expect(container.textContent).toBe('A perfectly normal sentence.')
  })

  it('keeps links keyboard focusable', () => {
    render(<LinkifiedText text="https://example.com" />)
    const link = screen.getByRole('link')
    link.focus()
    expect(link).toHaveFocus()
  })

  it('styles links distinctly from body text with hover affordances', () => {
    render(<LinkifiedText text="https://example.com" />)
    const link = screen.getByRole('link')
    expect(link.className).toContain('underline')
    expect(link.className).toContain('text-accent-text')
    expect(link.className).toContain('hover:text-accent-text/80')
  })

  it('renders user markup as literal text, not HTML', () => {
    const text = 'Not HTML: <img src=x onerror=alert(1)> see https://example.com'
    const { container } = render(<LinkifiedText text={text} />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toBe(text)
  })
})
