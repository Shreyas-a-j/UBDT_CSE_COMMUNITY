import { describe, expect, it } from 'vitest'
import {
  BRAND,
  absoluteLink,
  buildHtml,
  buildSubject,
  buildText,
  type PublishEmailInput,
} from './template'

const SITE_URL = 'https://ubdt-cse-community.vercel.app'

const announcement: PublishEmailInput = {
  kind: 'announcement',
  title: 'Semester project submissions open',
  body: 'Upload your reports before Friday.',
  link: '/announcements#announcement-abc123',
}

const event: PublishEmailInput = {
  kind: 'event',
  title: 'Intro to Web Development',
  body: 'Hands-on session for all years.',
  link: '/#event-def456',
  eventLine: 'Workshop · Fri, Oct 30, 2026 · 10:00',
}

describe('template: announcement email', () => {
  it('has a subject and body containing the title, brand and absolute link', () => {
    const subject = buildSubject(announcement)
    expect(subject).toContain(announcement.title)

    const html = buildHtml(announcement, SITE_URL)
    expect(html).toContain(BRAND)
    expect(html).toContain(announcement.title)
    expect(html).toContain(`${SITE_URL}/announcements#announcement-abc123`)

    const text = buildText(announcement, SITE_URL)
    expect(text).toContain(announcement.title)
    expect(text).toContain(`${SITE_URL}/announcements#announcement-abc123`)
    expect(text).toContain(BRAND)
  })

  it('escapes user-controlled content in the HTML rendering', () => {
    const hostile: PublishEmailInput = {
      ...announcement,
      title: '<script>alert(1)</script>',
      body: '<img src=x onerror=alert(2)>',
    }
    const html = buildHtml(hostile, SITE_URL)
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;script&gt;')
  })

  it('tolerates a site URL with a trailing slash', () => {
    const html = buildHtml(announcement, `${SITE_URL}/`)
    expect(html).toContain(`${SITE_URL}/announcements#announcement-abc123`)
    expect(html).not.toContain('.app//announcements')
  })
})

describe('template: event email', () => {
  it('contains the date/time line, title and absolute link', () => {
    const subject = buildSubject(event)
    expect(subject).toContain(event.title)

    const html = buildHtml(event, SITE_URL)
    expect(html).toContain(BRAND)
    expect(html).toContain(event.title)
    expect(html).toContain('Workshop · Fri, Oct 30, 2026 · 10:00')
    expect(html).toContain(`${SITE_URL}/#event-def456`)

    const text = buildText(event, SITE_URL)
    expect(text).toContain('Workshop · Fri, Oct 30, 2026 · 10:00')
    expect(text).toContain(`${SITE_URL}/#event-def456`)
  })

  it('omits the date/time line when none is provided', () => {
    const withoutLine: PublishEmailInput = { ...event, eventLine: null }
    const html = buildHtml(withoutLine, SITE_URL)
    expect(html).not.toContain('Workshop · Fri')
  })
})

describe('template: absoluteLink', () => {
  it('joins site URL and path without doubling slashes', () => {
    expect(absoluteLink(SITE_URL, '/x')).toBe(`${SITE_URL}/x`)
    expect(absoluteLink(`${SITE_URL}/`, 'x')).toBe(`${SITE_URL}/x`)
  })
})
