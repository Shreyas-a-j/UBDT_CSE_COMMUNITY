'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Smartphone } from 'lucide-react'
import AndroidDownloadCard from '@/components/AndroidDownloadCard'

/**
 * A small header icon that opens a compact popover with the Android download card.
 *
 * Works for signed-in and signed-out visitors. Reuses the existing
 * AndroidDownloadCard component and the project's header-icon styling.
 */
export default function AndroidAppButton() {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const close = useCallback(() => setOpen(false), [])

  /* Dismiss on outside click or Escape */
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) close()
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, close])

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-label="Download Android App"
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Download Android App"
        className="header-icon"
      >
        <Smartphone className="h-[18px] w-[18px]" />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Android app download"
          className="android-app-popover absolute right-0 top-full z-50 mt-3.5 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-line-strong bg-surface p-4 shadow-pop"
        >
          <AndroidDownloadCard />
        </div>
      )}
    </div>
  )
}
