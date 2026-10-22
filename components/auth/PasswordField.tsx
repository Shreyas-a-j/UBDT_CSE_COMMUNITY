'use client'

import React from 'react'
import { Eye, EyeOff } from 'lucide-react'

/**
 * Shared password input used by every form on the canonical auth page. The
 * three registration paths previously each carried a private copy of this
 * markup; consolidating it keeps the visibility toggle and accessibility
 * wiring identical across Sign In, Student, Alumni and Faculty.
 */
export default function PasswordField({
  id,
  label,
  value,
  onChange,
  placeholder,
  show,
  onToggle,
  autoComplete = 'new-password',
  labelAddon,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  placeholder: string
  show: boolean
  onToggle: () => void
  autoComplete?: string
  labelAddon?: React.ReactNode
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="label mb-0">
          {label}
        </label>
        {labelAddon}
      </div>
      <div className="relative">
        <input
          id={id}
          type={show ? 'text' : 'password'}
          required
          placeholder={placeholder}
          value={value}
          onChange={e => onChange(e.target.value)}
          className="field pr-11"
          autoComplete={autoComplete}
        />
        <button
          type="button"
          onClick={onToggle}
          className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-dim transition-colors hover:text-ink"
          aria-label={show ? 'Hide password' : 'Show password'}
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </div>
  )
}
