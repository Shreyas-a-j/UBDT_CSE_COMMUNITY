'use client'

import React from 'react'
import { Megaphone } from 'lucide-react'
import { Announcement } from '@/lib/types'
import UserAvatar from '@/components/UserAvatar'
import { formatDate } from '@/lib/utils'

export default function AnnouncementCard({ announcement }: { announcement: Announcement }) {
  return (
    <article className="card p-5 sm:p-6">
      <div className="flex items-start gap-3.5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-accent/25 bg-accent-soft text-accent-hover">
          <Megaphone className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="type-badge bg-accent-soft text-accent-hover">Faculty announcement</span>
            <span className="text-[11.5px] text-dim">{formatDate(announcement.created_at)}</span>
          </div>

          <h3 className="mt-2 text-[17px] font-semibold leading-snug text-ink">{announcement.title}</h3>
          <p className="mt-2 max-w-[68ch] whitespace-pre-line text-[14px] leading-relaxed text-muted">
            {announcement.body}
          </p>

          <div className="mt-4 flex items-center gap-2.5 border-t border-line pt-3.5">
            <UserAvatar
              src={announcement.author_avatar}
              name={announcement.author_name || 'Faculty'}
              size={28}
            />
            <div className="min-w-0">
              <p className="truncate text-[12px] font-medium text-ink">
                {announcement.author_name || 'CSE Faculty'}
              </p>
              <p className="truncate text-[10.5px] text-dim">
                {announcement.author_designation || 'Department of CSE'}
              </p>
            </div>
          </div>
        </div>
      </div>
    </article>
  )
}
