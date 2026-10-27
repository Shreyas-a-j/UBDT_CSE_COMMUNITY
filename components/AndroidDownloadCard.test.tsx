import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import AndroidDownloadCard from './AndroidDownloadCard'
import { ANDROID_APP } from '@/lib/android-app'

describe('AndroidDownloadCard', () => {
  it('renders the app identity and points every download action at the APK', () => {
    render(<AndroidDownloadCard />)

    expect(screen.getByText('UCC')).toBeInTheDocument()
    expect(screen.getByText('v1.0.2')).toBeInTheDocument()
    expect(screen.getByText('com.ucc.community')).toBeInTheDocument()

    const links = screen.getAllByRole('link', { name: /Download.*Android/i })
    expect(links.length).toBeGreaterThanOrEqual(2)
    for (const link of links) {
      expect(link).toHaveAttribute('href', ANDROID_APP.apkUrl)
      expect(link).toHaveAttribute('download')
    }

    expect(
      screen.getByAltText(/QR code to download the UCC Android app/i)
    ).toBeInTheDocument()
  })

  it('uses a direct public HTTPS APK URL and a real QR asset', () => {
    expect(ANDROID_APP.apkUrl).toMatch(/^https:\/\/[^/]+\.r2\.dev\/.+\.apk$/)

    const qrPath = path.join(process.cwd(), 'public', 'android', 'ucc-qr.svg')
    const svg = fs.readFileSync(qrPath, 'utf8')
    expect(svg).toContain('<svg')
    expect(svg.length).toBeGreaterThan(1000)
  })
})
