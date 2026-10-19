import React from 'react'

export default function SectionHeader({
  id,
  title,
  count,
  icon,
  action,
  className = '',
}: {
  id?: string
  title: string
  count?: number
  icon?: React.ReactNode
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div className={`flex min-w-0 items-center justify-between gap-3 ${className}`}>
      <h2 id={id} className="flex min-w-0 items-center gap-2 text-[18px] font-semibold text-ink sm:text-[20px]">
        {icon && <span className="text-dim">{icon}</span>}
        <span className="truncate">{title}</span>
        {typeof count === 'number' && (
          <span className="rounded-md border border-line bg-elevated px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-muted">
            {count}
          </span>
        )}
      </h2>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}
