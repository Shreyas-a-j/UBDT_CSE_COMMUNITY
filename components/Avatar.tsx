'use client'

import React, { useState } from 'react'
import Image from 'next/image'
import { thumbHashToDataURL } from '@/lib/imageProcessing'

interface AvatarProps {
  avatarUrl?: string | null
  thumbhash?: string | null
  name?: string
  size?: number
  className?: string
}

const COLOR_PALETTE = [
  'bg-blue-600',
  'bg-emerald-600',
  'bg-indigo-600',
  'bg-violet-600',
  'bg-amber-600',
  'bg-rose-600',
  'bg-teal-600',
  'bg-cyan-600',
]

function getDeterministicColor(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash)
  }
  const index = Math.abs(hash) % COLOR_PALETTE.length
  return COLOR_PALETTE[index]
}

export default function Avatar({
  avatarUrl,
  thumbhash,
  name = 'User',
  size = 40,
  className = '',
}: AvatarProps) {
  const [imageError, setImageError] = useState(false)
  const initial = name.trim().charAt(0).toUpperCase() || 'U'
  const bgColor = getDeterministicColor(name)
  const placeholderDataUrl = thumbhash ? thumbHashToDataURL(thumbhash) : null

  // 1. Primary: Remote avatar URL
  if (avatarUrl && !imageError) {
    return (
      <div
        className={`relative inline-block rounded-full overflow-hidden flex-shrink-0 bg-slate-100 dark:bg-slate-800 ${className}`}
        style={{ width: size, height: size }}
      >
        {placeholderDataUrl && (
          <img
            src={placeholderDataUrl}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 w-full h-full object-cover filter blur-[1px]"
          />
        )}
        <Image
          src={avatarUrl}
          alt={name}
          width={size}
          height={size}
          className="relative w-full h-full object-cover rounded-full"
          onError={() => setImageError(true)}
          unoptimized
        />
      </div>
    )
  }

  // 2. Secondary fallback: ThumbHash data URL placeholder
  if (placeholderDataUrl) {
    return (
      <div
        className={`relative inline-block rounded-full overflow-hidden flex-shrink-0 ${className}`}
        style={{ width: size, height: size }}
      >
        <img
          src={placeholderDataUrl}
          alt={name}
          className="w-full h-full object-cover rounded-full"
        />
      </div>
    )
  }

  // 3. Tertiary fallback: Deterministic initial circle
  return (
    <div
      className={`inline-flex items-center justify-center rounded-full text-white font-bold flex-shrink-0 select-none ${bgColor} ${className}`}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(12, Math.floor(size * 0.42)),
      }}
    >
      {initial}
    </div>
  )
}
