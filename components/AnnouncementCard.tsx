'use client'

import React, { useEffect, useState } from 'react'
import { Megaphone } from 'lucide-react'
import type { Announcement } from '@/lib/types'
import { formatDate, formatRelativeTime } from '@/lib/utils'
import UserAvatar from '@/components/UserAvatar'
import AnnouncementReactions from '@/components/AnnouncementReactions'

/**
 * A faculty announcement.
 *
 * `variant="card"` is the feed card; `variant="message"` is the flat,
 * Discord-style row used in the dedicated announcements channel. Both render
 * the same content — author, time, title, message, optional images and the
 * reaction pills — and neither offers comments, replies or direct messages.
 */
export default function AnnouncementCard({
  announcement,
  variant = 'card',
}: {
  announcement: Announcement
  variant?: 'card' | 'message'
}) {
  // Relative time depends on the current clock, so it is filled in after mount
  // (same deferral as PostCard) to keep prerendering deterministic.
  const [relative, setRelative] = useState('')
  useEffect(() => {
    queueMicrotask(() => setRelative(formatRelativeTime(announcement.created_at)))
  }, [announcement.created_at])

  const authorName = announcement.author_name || 'CSE Faculty'
  const images = announcement.image_urls ?? []
  const hasImages = images.length > 0

  return (
    <article
      className={
        variant === 'card'
          ? 'card p-4 sm:p-5'
          : 'group relative rounded-lg px-2 py-4 transition-colors hover:bg-elevated/50 sm:px-3'
      }
    >
      <div className="flex items-start gap-3.5">
        <div className="relative shrink-0">
          <UserAvatar src={announcement.author_avatar} name={authorName} size={variant === 'card' ? 38 : 40} />
          <span
            className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full border border-line bg-peach-soft text-peach-text"
            aria-hidden
          >
            <Megaphone className="h-2.5 w-2.5" />
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="truncate text-[13px] font-semibold text-ink">{authorName}</span>
            <span className="inline-flex items-center rounded border border-peach/40 bg-peach-soft px-1.5 py-px text-[9.5px] font-medium uppercase tracking-wide text-peach-text">
              Faculty
            </span>
            {announcement.author_designation && (
              <span className="truncate text-[11px] text-dim">{announcement.author_designation}</span>
            )}
            <time
              dateTime={announcement.created_at || undefined}
              title={formatDate(announcement.created_at)}
              className="text-[11px] text-dim"
            >
              {relative || formatDate(announcement.created_at)}
            </time>
          </div>

          <h3 className="mt-1.5 text-[15.5px] font-semibold leading-snug text-ink sm:text-[16.5px]">
            {announcement.title}
          </h3>
          <p className="mt-1.5 max-w-[68ch] whitespace-pre-line break-words text-[13.5px] leading-relaxed text-muted">
            {announcement.body}
          </p>

          {hasImages && (
            <div
              className={`mt-3 grid gap-2 ${
                images.length === 1 ? 'grid-cols-1' : 'grid-cols-2'
              }`}
            >
              {images.map((src, index) => (
                <a
                  key={`${src}-${index}`}
                  href={src}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`block overflow-hidden rounded-md border border-line bg-elevated ${
                    images.length === 3 && index === 0 ? 'col-span-2' : ''
                  }`}
                >
                  <img
                    src={src}
                    alt={`${announcement.title} — attachment ${index + 1} of ${images.length}`}
                    loading="lazy"
                    decoding="async"
                    className="h-full max-h-[340px] w-full object-cover transition-transform duration-300 hover:scale-[1.01]"
                  />
                </a>
              ))}
            </div>
          )}

          <AnnouncementReactions announcement={announcement} />
        </div>
      </div>
    </article>
  )
}
