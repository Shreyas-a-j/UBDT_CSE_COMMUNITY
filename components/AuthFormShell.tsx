'use client'

import Link from 'next/link'
import { ArrowLeft, Code2, GraduationCap } from 'lucide-react'

export default function AuthFormShell({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle: string
  children: React.ReactNode
}) {
  return (
    <div className="grid min-h-dvh bg-canvas lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <aside className="relative hidden flex-col justify-between overflow-hidden border-r border-[var(--color-sidebar-line)] bg-sidebar p-10 xl:p-14 lg:flex">
        <div className="absolute inset-0 dot-grid opacity-20" aria-hidden />
        <div
          className="pointer-events-none absolute -right-8 top-1/2 -translate-y-1/2 select-none font-mono text-[180px] font-bold leading-none text-white/[0.025]"
          aria-hidden
        >
          &lt;/&gt;
        </div>

        <Link href="/" className="relative flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-md border border-accent/40 bg-accent-soft font-mono text-[10px] font-bold text-accent-hover">
            &lt;/&gt;
          </span>
          <span className="flex flex-col leading-none">
            <span className="text-[14px] font-semibold text-header-ink">UBDT CSE</span>
            <span className="mt-1 text-[10px] text-sidebar-muted">Developer community</span>
          </span>
        </Link>

        <div className="relative max-w-md">
          <p className="inline-flex items-center gap-2 rounded-md border border-[var(--color-sidebar-line)] bg-white/[0.04] px-2.5 py-1 text-[11.5px] font-medium text-sidebar-muted">
            <GraduationCap className="h-3.5 w-3.5 text-accent-hover" />
            Department of Computer Science &amp; Engineering
          </p>
          <h1 className="mt-5 font-display text-[34px] font-semibold leading-[1.12] tracking-tight text-header-ink xl:text-[40px]">
            A departmental commons for CSE.
          </h1>
          <p className="mt-4 max-w-sm text-[14px] leading-relaxed text-sidebar-muted">
            Ask questions, share what you are building, and keep up with workshops and faculty
            announcements across all four batches.
          </p>

          <ul className="mt-8 space-y-3.5">
            {[
              'Find classmates by batch, skill or USN.',
              'Share projects and get useful feedback.',
              'Keep up with events and announcements.',
            ].map(item => (
              <li key={item} className="flex items-start gap-2.5 text-[13px] text-sidebar-muted">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-[var(--color-sidebar-line)] bg-white/[0.04]">
                  <Code2 className="h-3 w-3 text-accent-hover" />
                </span>
                {item}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-[11px] text-[#7f8294]">
          University BDT College of Engineering · VTU
        </p>
      </aside>

      <main className="flex flex-col justify-center px-5 py-10 sm:px-8">
        <div className="mx-auto w-full max-w-[420px]">
          <div className="mb-8 flex items-center justify-between gap-3">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-[12px] font-medium text-muted transition-colors hover:text-ink"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to the feed
            </Link>
            <Link href="/" className="flex items-center gap-2 lg:hidden">
              <span className="flex h-8 w-8 items-center justify-center rounded-md border border-accent/40 bg-accent-soft font-mono text-[9px] font-bold text-accent-hover">
                &lt;/&gt;
              </span>
              <span className="text-[12.5px] font-semibold text-ink">UBDT CSE</span>
            </Link>
          </div>

          <h2 className="font-display text-[28px] font-semibold tracking-tight text-ink">{title}</h2>
          <p className="mt-2 text-[13.5px] leading-relaxed text-muted">{subtitle}</p>

          <div className="mt-7">{children}</div>
        </div>
      </main>
    </div>
  )
}
