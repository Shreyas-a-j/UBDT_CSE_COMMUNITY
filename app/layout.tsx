import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { Toaster } from 'react-hot-toast'
import './globals.css'
import { AuthProvider } from '@/contexts/AuthContext'
import { CommunityProvider } from '@/contexts/CommunityContext'
import { ThemeProvider } from '@/contexts/ThemeContext'

const inter = Inter({
  variable: '--font-sans',
  subsets: ['latin'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'UCC | Computer Science & Engineering Community',
  description:
    'Exclusive community hub, peer collaboration, workshops, and project showcases for UCC students.',
  keywords: [
    'UCC', 'CSE', 'Computer Science', 'Engineering Community', 'Workshops', 'Student Projects',
  ],
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${inter.variable} h-full`} suppressHydrationWarning>
      <body className="min-h-full flex flex-col antialiased font-sans">
        <ThemeProvider>
          <AuthProvider>
            <CommunityProvider>
              {children}
              <Toaster
                position="bottom-right"
                toastOptions={{
                  style: {
                    background: '#0d1426',
                    color: '#e8f4fd',
                    border: '2px solid #1e3560',
                    borderRadius: 0,
                  },
                }}
              />
            </CommunityProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}

