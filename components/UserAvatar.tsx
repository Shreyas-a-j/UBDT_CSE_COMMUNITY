'use client'

import React, { useState } from 'react'
import { getAvatarFallback } from '@/lib/utils'

interface UserAvatarProps {
  src?: string | null
  name?: string
  size?: number
  className?: string
  borderColor?: string
}

export default function UserAvatar({
  src,
  name = 'User',
  size = 32,
  className = '',
  borderColor = '#1e3560',
}: UserAvatarProps) {
  const [imgError, setImgError] = useState(false)

  const hasValidImage = Boolean(src && !imgError && typeof src === 'string' && src.trim().length > 0)

  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        border: `2px solid ${borderColor}`,
        background: '#0c1220',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        boxShadow: '2px 2px 0px rgba(0,0,0,0.5)',
      }}
    >
      {hasValidImage ? (
        <img
          src={src!}
          alt={name}
          onError={() => setImgError(true)}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block',
          }}
        />
      ) : (
        <span
          style={{
            fontSize: Math.max(10, Math.floor(size * 0.42)),
            color: '#00ffcc',
            fontWeight: 700,
            lineHeight: 1,
            userSelect: 'none',
          }}
        >
          {getAvatarFallback(name)}
        </span>
      )}
    </div>
  )
}
