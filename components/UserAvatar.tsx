'use client'

import React, { useState } from 'react'
import { getAvatarFallback } from '@/lib/utils'

interface UserAvatarProps {
  src?: string | null
  name?: string
  size?: number
  className?: string
  /** Optional ring colour. Defaults to the hairline border token. */
  borderColor?: string
}

export default function UserAvatar({
  src,
  name = 'Member',
  size = 36,
  className = '',
  borderColor,
}: UserAvatarProps) {
  const [imgError, setImgError] = useState(false)
  const hasValidImage = Boolean(src && !imgError && typeof src === 'string' && src.trim().length > 0)

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border bg-elevated font-mono font-semibold leading-none text-muted ${className}`}
      style={{
        width: size,
        height: size,
        borderColor: borderColor ?? 'var(--color-line)',
        fontSize: Math.max(10, Math.floor(size * 0.36)),
      }}
    >
      {hasValidImage ? (
        <img
          src={src as string}
          alt={name}
          loading="lazy"
          decoding="async"
          onError={() => setImgError(true)}
          className="block h-full w-full object-cover"
        />
      ) : (
        <span aria-hidden>{getAvatarFallback(name)}</span>
      )}
    </span>
  )
}
