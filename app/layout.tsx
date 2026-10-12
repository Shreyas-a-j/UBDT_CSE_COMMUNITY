import type { Metadata } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import './globals.css'
import { CommunityProvider } from '@/contexts/CommunityContext'
import { ThemeProvider } from '@/contexts/ThemeContext'

const inter = Inter({
  variable: '--font-sans',
  subsets: ['latin'],
})

const jetbrainsMono = JetBrains_Mono({
  variable: '--font-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: 'UBDT CSE Community | UBDT College of Engineering, Davangere',
  description:
    'Exclusive virtual community, peer collaboration, workshop hub, and project showcase for the Computer Science & Engineering students of UBDT College of Engineering, Davangere (ubdtce.org).',
  keywords: [
    'UBDT', 'UBDTCE', 'Davangere', 'CSE', 'Computer Science',
    'VTU', 'Engineering Community', 'Workshops', 'Student Projects',
  ],
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="min-h-full flex flex-col bg-[#f8fafc] dark:bg-slate-950 text-slate-800 dark:text-slate-200 font-sans transition-colors duration-200">
        <ThemeProvider>
          <CommunityProvider>{children}</CommunityProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}

