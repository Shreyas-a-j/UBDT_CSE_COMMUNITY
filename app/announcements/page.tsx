'use client'

import React, { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Hash, Lock, Megaphone, PenLine, Users } from 'lucide-react'
import AppShell from '@/components/AppShell'
import AnnouncementCard from '@/components/AnnouncementCard'
import EmptyState from '@/components/EmptyState'
import LoadingSkeleton from '@/components/LoadingSkeleton'
import UserAvatar from '@/components/UserAvatar'
import { useCommunity } from '@/contexts/CommunityContext'
import { canPublishFacultyContent } from '@/lib/profile'
import { groupAnnouncementsByDay } from '@/lib/logic/announcements'

interface AuthorSummary {
  id: string
  name: string
  avatar: string | null
  designation: string | null
  count: number
}

export default function AnnouncementsPage() {
  const { currentUser, announcements, feedLoading, setIsAuthModalOpen } = useCommunity()
  const [authorFilter, setAuthorFilter] = useState<string | null>(null)
  // "Today" / "Yesterday" need the current time, and reading it during render
  // is an unstable value the framework refuses to prerender ("Today" could be
  // baked into the static HTML). The clock is read after mount instead — the
  // same deferral PostCard uses for relative timestamps.
  const [clock, setClock] = useState<Date | null>(null)

  useEffect(() => {
    queueMicrotask(() => setClock(new Date()))
  }, [])

  // Deep links from publish notifications ("/announcements#announcement-<id>")
  // cannot rely on native hash scrolling: the list renders after the feed
  // loads, so the target element does not exist at first paint. Scroll to it
  // once announcements arrive. (Optional call: jsdom in tests does not
  // implement scrollIntoView.)
  useEffect(() => {
    if (typeof window === 'undefined' || announcements.length === 0) return
    const match = /^#announcement-(.+)$/.exec(window.location.hash)
    if (!match) return
    const el = document.getElementById(`announcement-${match[1]}`)
    el?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
  }, [announcements])

  // One rail entry per faculty member who has posted, most active first.
  const authors = useMemo<AuthorSummary[]>(() => {
    const byAuthor = new Map<string, AuthorSummary>()

    for (const announcement of announcements) {
      const existing = byAuthor.get(announcement.author_id)
      if (existing) {
        existing.count += 1
        continue
      }
      byAuthor.set(announcement.author_id, {
        id: announcement.author_id,
        name: announcement.author_name || 'CSE Faculty',
        avatar: announcement.author_avatar ?? null,
        designation: announcement.author_designation ?? null,
        count: 1,
      })
    }

    return Array.from(byAuthor.values()).sort(
      (a, b) => b.count - a.count || a.name.localeCompare(b.name)
    )
  }, [announcements])

  const visible = useMemo(
    () =>
      authorFilter
        ? announcements.filter(announcement => announcement.author_id === authorFilter)
        : announcements,
    [announcements, authorFilter]
  )

  const groups = useMemo(
    () => (clock ? groupAnnouncementsByDay(visible, clock) : []),
    [visible, clock]
  )
  const clockReady = clock !== null
  const activeAuthor = authors.find(author => author.id === authorFilter) ?? null
  const canPublish = canPublishFacultyContent(currentUser)
  const hasAnnouncements = announcements.length > 0

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-[1080px]">
        <header className="card overflow-hidden">
          <div className="flex flex-col gap-4 border-b border-line bg-surface p-5 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
            <div className="min-w-0">
              <p className="eyebrow mb-2">Faculty channel</p>
              <h1 className="flex items-center gap-2 font-display text-[26px] font-semibold leading-tight tracking-tight text-ink">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-accent/25 bg-accent-soft text-accent-text">
                  <Hash className="h-5 w-5" aria-hidden />
                </span>
                announcements
              </h1>
              <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-muted">
                Official updates from the Department of Computer Science &amp; Engineering.
                Department-wide, so they stay visible whichever batch you are browsing.
              </p>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {canPublish ? (
                <Link href="/faculty/announcements/create" className="btn btn-accent btn-sm">
                  <PenLine className="h-3.5 w-3.5" /> New announcement
                </Link>
              ) : currentUser ? (
                <span className="inline-flex items-center gap-1.5 rounded-md border border-line bg-elevated px-2.5 py-1.5 text-[11.5px] font-medium text-muted">
                  <Lock className="h-3.5 w-3.5" aria-hidden /> Faculty post updates
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsAuthModalOpen(true)}
                  className="btn btn-outline btn-sm"
                >
                  Sign in to react
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 px-5 py-2.5 text-[11px] text-dim">
            <span className="inline-flex items-center gap-1.5">
              <Megaphone className="h-3.5 w-3.5" aria-hidden />
              {announcements.length} update{announcements.length === 1 ? '' : 's'}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5" aria-hidden />
              Signed-in members can react
            </span>
          </div>
        </header>

        <div className="mt-5 grid gap-5 lg:grid-cols-[216px_minmax(0,1fr)]">
          <aside aria-label="Announcement authors" className="order-2 lg:order-1">
            <div className="card p-3">
              <p className="side-label mb-2 px-1">Posting faculty</p>
              <ul className="flex flex-col gap-0.5">
                <li>
                  <button
                    type="button"
                    onClick={() => setAuthorFilter(null)}
                    aria-pressed={authorFilter === null}
                    className="side-link w-full"
                  >
                    <Megaphone className="side-icon" aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-left">All updates</span>
                    <span className="text-[11px] tabular-nums text-dim">{announcements.length}</span>
                  </button>
                </li>
                {authors.map(author => (
                  <li key={author.id}>
                    <button
                      type="button"
                      onClick={() => setAuthorFilter(author.id)}
                      aria-pressed={authorFilter === author.id}
                      className="side-link w-full"
                    >
                      <UserAvatar src={author.avatar} name={author.name} size={20} />
                      <span className="min-w-0 flex-1 truncate text-left">{author.name}</span>
                      <span className="text-[11px] tabular-nums text-dim">{author.count}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </aside>

          <section aria-label="Announcements" className="order-1 min-w-0 lg:order-2">
            <div className="card overflow-hidden">
              <div className="flex items-center justify-between gap-3 border-b border-line bg-surface px-4 py-2.5">
                <h2 className="min-w-0 truncate text-[12.5px] font-semibold text-ink">
                  {activeAuthor ? activeAuthor.name : 'All announcements'}
                  {activeAuthor?.designation && (
                    <span className="ml-2 text-[11px] font-normal text-dim">
                      {activeAuthor.designation}
                    </span>
                  )}
                </h2>
                {authorFilter && (
                  <button
                    type="button"
                    onClick={() => setAuthorFilter(null)}
                    className="shrink-0 text-[11px] font-medium text-muted transition-colors hover:text-ink"
                  >
                    Clear filter
                  </button>
                )}
              </div>

              {!clockReady || (feedLoading && !hasAnnouncements) ? (
                <div className="p-3">
                  <LoadingSkeleton rows={3} />
                </div>
              ) : groups.length === 0 ? (
                <div className="p-4">
                  <EmptyState
                    icon={<Megaphone className="h-6 w-6" />}
                    title={authorFilter ? 'Nothing from this faculty member yet' : 'No announcements yet'}
                    body={
                      authorFilter
                        ? 'Try clearing the filter to see every update in the channel.'
                        : 'Faculty updates will appear here as soon as they are published.'
                    }
                    action={
                      canPublish ? (
                        <Link href="/faculty/announcements/create" className="btn btn-accent btn-sm">
                          <PenLine className="h-3.5 w-3.5" /> Write the first one
                        </Link>
                      ) : undefined
                    }
                  />
                </div>
              ) : (
                <div className="divide-y divide-line">
                  {groups.map(group => (
                    <section key={group.key} aria-labelledby={`day-${group.key}`} className="px-2 py-1 sm:px-3">
                      <h3
                        id={`day-${group.key}`}
                        className="sticky top-16 z-10 -mx-2 flex items-center gap-3 bg-surface/95 px-2 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-dim backdrop-blur sm:-mx-3 sm:px-3"
                      >
                        <span className="h-px flex-1 bg-line" aria-hidden />
                        {group.label}
                        <span className="h-px flex-1 bg-line" aria-hidden />
                      </h3>
                      <ol className="pb-1">
                        {group.announcements.map(announcement => (
                          <li key={announcement.id}>
                            <AnnouncementCard announcement={announcement} variant="message" />
                          </li>
                        ))}
                      </ol>
                    </section>
                  ))}
                </div>
              )}
            </div>

            <p className="mt-3 px-1 text-[11px] leading-relaxed text-dim">
              Announcements are read-only updates from faculty. Reactions are public and can be
              changed at any time.
            </p>
          </section>
        </div>
      </div>
    </AppShell>
  )
}
