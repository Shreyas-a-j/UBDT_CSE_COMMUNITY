'use client'

import React from 'react'

export interface FilterTab<T extends string> {
  id: T
  label: string
  count?: number
}

export default function FilterTabs<T extends string>({
  tabs,
  value,
  onChange,
  ariaLabel,
}: {
  tabs: FilterTab<T>[]
  value: T
  onChange: (value: T) => void
  ariaLabel: string
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5" role="tablist" aria-label={ariaLabel}>
      {tabs.map(tab => {
        const active = value === tab.id
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.id)}
            className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border px-3 text-[12.5px] font-medium transition-colors ${
              active
                ? 'border-peach/40 bg-peach-soft text-peach-text'
                : 'border-transparent text-muted hover:bg-elevated hover:text-ink'
            }`}
          >
            {tab.label}
            {typeof tab.count === 'number' && (
              <span
                className={`text-[10.5px] tabular-nums ${
                  active ? 'text-peach-text' : 'text-dim'
                }`}
              >
                {tab.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
