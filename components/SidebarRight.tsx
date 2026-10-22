'use client'

import React from 'react'
import Link from 'next/link'
import { format, parseISO } from 'date-fns'
import { ArrowBigUp, ArrowUpRight, CalendarDays, Megaphone, MessageSquare, Sparkles } from 'lucide-react'
import { useCommunity } from '@/contexts/CommunityContext'
import { selectTrendingShowcases } from '@/lib/logic/feed'
import { filterEventsByBatch } from '@/lib/logic/batch'
import UserAvatar from '@/components/UserAvatar'
import { displayName } from '@/lib/profile'

function EventDate({ date }: { date: string }) {
  let parsed: Date | null = null
  try {
    parsed = parseISO(date)
  } catch {
    parsed = null
  }

  if (!parsed) return null

  return (
    <div className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-md border border-line bg-elevated leading-none">
      <span className="text-[9px] font-medium uppercase tracking-wide text-dim">
        {format(parsed, 'MMM')}
      </span>
      <span className="mt-0.5 text-[15px] font-semibold text-ink">{format(parsed, 'd')}</span>
    </div>
  )
}

function ViewAll({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-0.5 text-[11.5px] font-medium text-muted transition-colors hover:text-ink"
    >
      {label} <ArrowUpRight className="h-3 w-3" />
    </button>
  )
}

export default function SidebarRight() {
  const { events, posts, announcements, yearFilter, setFeedFilter, setSearchQuery } = useCommunity()

  // Batch-aware: the sidebar used to ignore the batch selector entirely, so
  // choosing a batch changed the feed but not Trending or Upcoming events.
  const upcomingEvents = filterEventsByBatch(events, yearFilter).slice(0, 3)
  // Shared rule with the feed's Popular section (lib/logic/ranking.ts): up
  // to two Project Showcase posts ranked by actual upvote count — newest
  // first on ties, then id — never a fabricated engagement sum.
  const trending = selectTrendingShowcases(posts, yearFilter)
  const latestAnnouncements = announcements.slice(0, 2)

  const goTo = (filter: Parameters<typeof setFeedFilter>[0]) => {
    setFeedFilter(filter)
    setSearchQuery('')
  }

  return (
    <aside className="flex flex-col gap-4" aria-label="Community highlights">
      <section className="card p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
            <CalendarDays className="h-4 w-4 text-dim" />
            Upcoming events
          </h2>
          <ViewAll label="All" onClick={() => goTo('events')} />
        </div>

        {upcomingEvents.length === 0 ? (
          <p className="rounded-md bg-elevated px-3 py-4 text-center text-[12px] text-dim">
            No upcoming events yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {upcomingEvents.map(event => (
              <li key={event.id} className="flex items-start gap-2.5 rounded-md p-2 transition-colors hover:bg-elevated">
                <EventDate date={event.event_date} />
                <div className="min-w-0">
                  <p className="line-clamp-2 text-[12.5px] font-medium leading-snug text-ink">
                    {event.title}
                  </p>
                  <p className="mt-1 text-[10.5px] text-dim">
                    {event.type} · {event.event_time} · {event.rsvp_count ?? 0} going
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
            <Sparkles className="h-4 w-4 text-dim" />
            Trending posts
          </h2>
          <ViewAll label="Feed" onClick={() => goTo('all')} />
        </div>

        {trending.length === 0 ? (
          <p className="rounded-md bg-elevated px-3 py-4 text-center text-[12px] text-dim">
            Popular projects will appear here.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {trending.map(post => (
              <li key={post.id} className="flex items-start gap-2.5 rounded-md p-2 transition-colors hover:bg-elevated">
                <UserAvatar
                  src={post.author_avatar}
                  name={post.author_name || 'Member'}
                  size={30}
                />
                <div className="min-w-0">
                  <p className="line-clamp-2 text-[12.5px] font-medium leading-snug text-ink">
                    {post.title}
                  </p>
                  <p className="mt-0.5 truncate text-[10.5px] text-dim">{displayName({ name: post.author_name || 'CSE Student' })}</p>
                  <p className="mt-1 flex items-center gap-2 text-[10px] text-dim">
                    <span className="inline-flex items-center gap-1">
                      <ArrowBigUp className="h-3 w-3" /> {post.upvote_count ?? 0}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <MessageSquare className="h-3 w-3" /> {post.comment_count ?? 0}
                    </span>
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
            <Megaphone className="h-4 w-4 text-dim" />
            Announcements
          </h2>
          <Link
            href="/announcements"
            className="inline-flex items-center gap-0.5 text-[11.5px] font-medium text-muted transition-colors hover:text-ink"
          >
            All <ArrowUpRight className="h-3 w-3" />
          </Link>
        </div>

        {latestAnnouncements.length === 0 ? (
          <p className="rounded-md bg-elevated px-3 py-4 text-center text-[12px] text-dim">
            No announcements right now.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {latestAnnouncements.map(announcement => (
              <li key={announcement.id} className="rounded-md border border-line bg-elevated/60 p-3">
                <p className="line-clamp-2 text-[12.5px] font-medium leading-snug text-ink">
                  {announcement.title}
                </p>
                <p className="mt-1 line-clamp-2 text-[11.5px] leading-relaxed text-muted">
                  {announcement.body}
                </p>
                <p className="mt-2 truncate text-[10.5px] text-dim">
                  {announcement.author_name || 'Faculty'}
                  {announcement.author_designation ? ` · ${announcement.author_designation}` : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  )
}
