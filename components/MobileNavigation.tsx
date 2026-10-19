'use client'

import React, { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import CommunitySidebar from '@/components/CommunitySidebar'

export default function MobileNavigation({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    const frame = window.requestAnimationFrame(() => panelRef.current?.focus())

    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', onKeyDown)
      window.cancelAnimationFrame(frame)
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-x-0 bottom-0 top-16 z-40 lg:hidden">
      <button
        type="button"
        aria-label="Close navigation"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Community navigation"
        tabIndex={-1}
        className="animate-drawer relative flex h-full w-[min(20rem,88vw)] flex-col overflow-hidden border-r border-[var(--color-sidebar-line)] bg-sidebar outline-none shadow-pop"
      >
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--color-sidebar-line)] px-4">
          <span className="text-[11px] font-semibold text-sidebar-muted">Menu</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation"
            className="flex h-8 w-8 items-center justify-center rounded-md text-sidebar-muted transition-colors hover:bg-white/10 hover:text-header-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <CommunitySidebar onNavigate={onClose} />
        </div>
      </div>
    </div>
  )
}
