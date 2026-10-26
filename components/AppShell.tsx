'use client'

import React from 'react'
import Link from 'next/link'
import { ArrowUpRight, Code2, GraduationCap } from 'lucide-react'
import Navbar from '@/components/Navbar'
import CommunitySidebar from '@/components/CommunitySidebar'
import CreatePostModal from '@/components/CreatePostModal'
import CreateEventModal from '@/components/CreateEventModal'
import ProfileModal from '@/components/ProfileModal'
import AuthModal from '@/components/AuthModal'
import AdminNominationBanner from '@/components/AdminNominationBanner'
import NotificationPopup from '@/components/NotificationPopup'
import { useCommunity } from '@/contexts/CommunityContext'

function Footer() {
  const { setFeedFilter } = useCommunity()

  return (
    <footer className="mt-2 border-t border-line bg-canvas">
      <div className="mx-auto w-full max-w-[1240px] px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line bg-elevated text-accent-text">
              <GraduationCap className="h-4 w-4" />
            </span>
            <div>
              <p className="text-[13.5px] font-semibold text-ink">UBDT CSE Community</p>
              <p className="mt-1 max-w-xs text-[12px] leading-relaxed text-dim">
                Department of Computer Science &amp; Engineering, University BDT College of
                Engineering.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[12px]">
            <a
              href="https://ubdtce.org"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-muted transition-colors hover:text-ink"
            >
              ubdtce.org <ArrowUpRight className="h-3 w-3" />
            </a>
            <Link href="/people" className="text-muted transition-colors hover:text-ink">
              Directory
            </Link>
            <button
              type="button"
              onClick={() => {
                setFeedFilter('all')
                window.scrollTo({ top: 0, behavior: 'smooth' })
              }}
              className="text-muted transition-colors hover:text-ink"
            >
              Back to top
            </button>
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-1 border-t border-line pt-4 text-[11px] text-dim sm:flex-row sm:items-center sm:justify-between">
          <span className="inline-flex items-center gap-1.5">
            <Code2 className="h-3 w-3" />
            UBDT CSE · Developer community
          </span>
          <span>Built by students, for students.</span>
        </div>
      </div>
    </footer>
  )
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas text-ink">
      <Navbar />

      <div className="mx-auto flex w-full max-w-[1600px] flex-1 items-stretch">
        <aside className="sticky top-16 hidden h-[calc(100dvh-4rem)] w-[260px] shrink-0 overflow-hidden border-r border-[var(--color-sidebar-line)] bg-sidebar lg:block">
          <CommunitySidebar />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <main className="mx-auto w-full max-w-[1240px] flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-7">
            {children}
          </main>
          <Footer />
        </div>
      </div>

      <CreatePostModal />
      <CreateEventModal />
      <ProfileModal />
      <AuthModal />
      <AdminNominationBanner />
      <NotificationPopup />
    </div>
  )
}
