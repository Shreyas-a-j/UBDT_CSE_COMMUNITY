'use client'

import React, { useEffect, useRef } from 'react'
import { X } from 'lucide-react'

/**
 * Shared modal shell. Handles Escape, scroll lock, click-outside dismissal and
 * initial focus. Every dialog in the app renders through this component so
 * spacing, radius and motion stay consistent.
 */
export default function Modal({
  open,
  onClose,
  children,
  labelledBy,
  className = '',
}: {
  open: boolean
  onClose: () => void
  children: React.ReactNode
  labelledBy?: string
  className?: string
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
    <div
      className="modal-overlay"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={`modal-panel outline-none ${className}`}
      >
        {children}
      </div>
    </div>
  )
}

export function ModalCloseButton({ onClick, label = 'Close dialog' }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="btn-icon h-8 w-8 shrink-0 border-transparent"
    >
      <X className="h-4 w-4" />
    </button>
  )
}
