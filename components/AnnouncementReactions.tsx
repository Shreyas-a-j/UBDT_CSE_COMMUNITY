'use client'

import React from 'react'
import { useCommunity } from '@/contexts/CommunityContext'
import { ANNOUNCEMENT_REACTIONS, summarizeReactions } from '@/lib/logic/announcements'
import type { Announcement, AnnouncementReaction } from '@/lib/types'

/**
 * Discord-style reaction pills for one announcement.
 *
 * Each of the four supported reactions is a toggle: pressing it adds that
 * reaction for the signed-in member, pressing it again removes it. Counts are
 * derived from the raw reaction rows (SummarizeReactions), so they can never
 * disagree with what the database holds, and the composite primary key on
 * (announcement_id, user_id, reaction) makes a duplicate impossible.
 *
 * Signed-out visitors see the counts and are sent to the sign-in modal.
 */
export default function AnnouncementReactions({ announcement }: { announcement: Announcement }) {
  const { currentUser, toggleAnnouncementReaction, setIsAuthModalOpen } = useCommunity()
  const { counts, mine } = summarizeReactions(announcement.reactions, currentUser?.id)

  const handleClick = (reaction: AnnouncementReaction) => {
    if (!currentUser) {
      setIsAuthModalOpen(true)
      return
    }
    void toggleAnnouncementReaction(announcement.id, reaction)
  }

  return (
    <div
      role="group"
      aria-label={`Reactions to ${announcement.title}`}
      className="mt-3 flex flex-wrap items-center gap-1.5"
    >
      {ANNOUNCEMENT_REACTIONS.map(({ type, emoji, label }) => {
        const count = counts[type]
        const active = mine.includes(type)
        const description = [
          label,
          count === 0 ? 'no reactions yet' : `${count} reaction${count === 1 ? '' : 's'}`,
          active ? 'you reacted' : null,
        ]
          .filter(Boolean)
          .join(', ')

        return (
          <button
            key={type}
            type="button"
            onClick={() => handleClick(type)}
            aria-pressed={active}
            aria-label={description}
            title={active ? `Remove your ${label.toLowerCase()} reaction` : `React with ${label.toLowerCase()}`}
            className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12px] leading-none transition-colors ${
              active
                ? 'border-accent/45 bg-accent-soft text-accent-text'
                : count > 0
                  ? 'border-line bg-elevated text-muted hover:border-line-strong hover:text-ink'
                  : 'border-line/60 bg-transparent text-dim hover:border-line-strong hover:text-muted'
            }`}
          >
            <span aria-hidden className="text-[13px]">
              {emoji}
            </span>
            {count > 0 && <span className="tabular-nums">{count}</span>}
          </button>
        )
      })}
    </div>
  )
}
