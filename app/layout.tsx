import type { Metadata, Viewport } from 'next'
import { Inter, JetBrains_Mono, Space_Grotesk } from 'next/font/google'
import { Toaster } from 'react-hot-toast'
import './globals.css'
import { AuthProvider } from '@/contexts/AuthContext'
import { CommunityProvider } from '@/contexts/CommunityContext'
import { ThemeProvider } from '@/contexts/ThemeContext'

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
  display: 'swap',
})

const spaceGrotesk = Space_Grotesk({
  variable: '--font-space-grotesk',
  subsets: ['latin'],
  display: 'swap',
})

const jetbrainsMono = JetBrains_Mono({
  variable: '--font-jetbrains-mono',
  subsets: ['latin'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: {
    default: 'UBDT CSE Community',
    template: '%s · UBDT CSE',
  },
  description:
    'The departmental commons for Computer Science and Engineering at UBDT College of Engineering — peer discussion, project showcases, workshops, and faculty announcements.',
  keywords: [
    'UBDT', 'CSE', 'Computer Science', 'Engineering Community', 'Workshops', 'Student Projects',
  ],
}

export const viewport: Viewport = {
  themeColor: '#11111f',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`dark ${inter.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable} h-full`}
      suppressHydrationWarning
    >
      <body className="min-h-full antialiased">
        <ThemeProvider>
          <AuthProvider>
            <CommunityProvider>
              {children}
              <Toaster
                position="bottom-right"
                gutter={10}
                toastOptions={{
                  duration: 4000,
                  style: {
                    background: 'var(--color-elevated)',
                    color: 'var(--color-ink)',
                    border: '1px solid var(--color-line-strong)',
                    borderRadius: 'var(--radius-lg)',
                    boxShadow: 'var(--shadow-pop)',
                    fontFamily: 'var(--font-sans)',
                    fontSize: '0.8125rem',
                    padding: '0.625rem 0.875rem',
                    maxWidth: '26rem',
                  },
                  success: { iconTheme: { primary: 'var(--color-accent)', secondary: 'var(--color-accent-ink)' } },
                  error: { iconTheme: { primary: 'var(--color-danger)', secondary: 'var(--color-canvas)' } },
                }}
              />
            </CommunityProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
