'use client'

import React from 'react'

export default function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon?: React.ReactNode
  title: string
  body: string
  action?: React.ReactNode
}) {
  return (
    <div className="card flex flex-col items-center px-6 py-14 text-center sm:py-16">
      {icon && (
        <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-lg border border-line bg-elevated text-muted">
          {icon}
        </div>
      )}
      <h3 className="text-[16px] font-semibold text-ink">{title}</h3>
      <p className="mt-2 max-w-sm text-[13.5px] leading-relaxed text-muted">{body}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  )
}
