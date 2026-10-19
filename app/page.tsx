'use client'

import React, { useMemo } from 'react'
import {
  CalendarDays, Code2, Megaphone, MessageSquare, Plus, Search, Sparkles, X,
} from 'lucide-react'
import AppShell from '@/components/AppShell'
import SidebarRight from '@/components/SidebarRight'
import EventCard from '@/components/EventCard'
import PostCard from '@/components/PostCard'
import AnnouncementCard from '@/components/AnnouncementCard'
import SectionHeader from '@/components/SectionHeader'
import FilterTabs, { FilterTab } from '@/components/FilterTabs'
import EmptyState from '@/components/EmptyState'
import UserAvatar from '@/components/UserAvatar'
import { useCommunity } from '@/contexts/CommunityContext'
import { displayName } from '@/lib/profile'
import { FeedFilter, YearFilter } from '@/lib/types'

const YEAR_OPTIONS: { id: YearFilter; label: string }[] = [
  { id: 0, label: 'All batches' },
  { id: 1, label: '1st year' },
  { id: 2, label: '2nd year' },
  { id: 3, label: '3rd year' },
  { id: 4, label: '4th year' },
]

export default function Home() {
  const {
    currentUser, posts, events, announcements, feedLoading, feedError,
    feedFilter, setFeedFilter, yearFilter, setYearFilter,
    searchQuery, setSearchQuery, setIsCreatePostOpen, setIsCreateEventOpen,
    setIsAuthModalOpen,
  } = useCommunity()

  const filteredPosts = useMemo(() => {
    return posts
      .filter(post => {
        if (feedFilter === 'events' || feedFilter === 'announcements') return false
        if (feedFilter === 'discussions' && post.type !== 'discussion') return false
        if (feedFilter === 'showcases' && post.type !== 'showcase') return false
        if (yearFilter !== 0) {
          if (post.author_year && post.author_year !== yearFilter) {
            if (!post.target_years.includes(yearFilter)) return false
          }
        }
        if (searchQuery.trim()) {
          const query = searchQuery.toLowerCase()
          const matches =
            post.title.toLowerCase().includes(query) ||
            post.body.toLowerCase().includes(query) ||
            (post.author_name || '').toLowerCase().includes(query) ||
            (post.author_usn || '').toLowerCase().includes(query) ||
            post.tags.some(tag => tag.toLowerCase().includes(query)) ||
            (post.tech_stack || []).some(tech => tech.toLowerCase().includes(query))
          if (!matches) return false
        }
        return true
      })
      .sort((a, b) => {
        const scoreA = (a.like_count ?? 0) + (a.upvote_count ?? 0)
        const scoreB = (b.like_count ?? 0) + (b.upvote_count ?? 0)
        if (scoreB !== scoreA) return scoreB - scoreA
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      })
  }, [posts, feedFilter, yearFilter, searchQuery])

  const filteredEvents = useMemo(() => {
    if (feedFilter === 'discussions' || feedFilter === 'showcases' || feedFilter === 'announcements') {
      return []
    }
    return events.filter(event => {
      if (yearFilter !== 0 && !event.target_years.includes(yearFilter)) return false
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase()
        return (
          event.title.toLowerCase().includes(query) ||
          event.description.toLowerCase().includes(query) ||
          (event.host_name || '').toLowerCase().includes(query) ||
          event.type.toLowerCase().includes(query)
        )
      }
      return true
    })
  }, [events, feedFilter, yearFilter, searchQuery])

  const filteredAnnouncements = useMemo(() => {
    if (feedFilter === 'events' || feedFilter === 'discussions' || feedFilter === 'showcases') {
      return []
    }
    return announcements.filter(announcement => {
      if (!searchQuery.trim()) return true
      const query = searchQuery.toLowerCase()
      return (
        announcement.title.toLowerCase().includes(query) ||
        announcement.body.toLowerCase().includes(query) ||
        (announcement.author_name || '').toLowerCase().includes(query)
      )
    })
  }, [announcements, feedFilter, searchQuery])

  const discussionCount = posts.filter(post => post.type === 'discussion').length
  const showcaseCount = posts.filter(post => post.type === 'showcase').length

  const tabs: FilterTab<FeedFilter>[] = [
    { id: 'all', label: 'All', count: posts.length + events.length + announcements.length },
    { id: 'discussions', label: 'Discussions', count: discussionCount },
    { id: 'showcases', label: 'Showcases', count: showcaseCount },
    { id: 'events', label: 'Events', count: events.length },
    { id: 'announcements', label: 'Announcements', count: announcements.length },
  ]

  const showPosts = feedFilter !== 'events' && feedFilter !== 'announcements'
  const showEvents = feedFilter === 'all' || feedFilter === 'events'
  const showAnnouncements = feedFilter === 'all' || feedFilter === 'announcements'

  const totalItemCount =
    (showPosts ? filteredPosts.length : 0) +
    (showEvents ? filteredEvents.length : 0) +
    (showAnnouncements ? filteredAnnouncements.length : 0)

  const openComposer = () => {
    if (!currentUser) {
      setIsAuthModalOpen(true)
      return
    }
    setIsCreatePostOpen(true)
  }

  const openEventComposer = () => {
    if (!currentUser) {
      setIsAuthModalOpen(true)
      return
    }
    setIsCreateEventOpen(true)
  }

  const postsHeading =
    feedFilter === 'showcases'
      ? 'Project showcase'
      : feedFilter === 'discussions'
        ? 'Discussions'
        : 'Latest posts'

  return (
    <AppShell>
      <div className="mx-auto grid w-full max-w-[860px] items-start gap-6 min-[1360px]:max-w-none min-[1360px]:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-5">
          {/* Page masthead */}
          <section className="card overflow-hidden">
            <div className="relative h-24 overflow-hidden bg-[#191a2b] sm:h-28">
              <div className="absolute inset-0 dot-grid opacity-30" aria-hidden />
              <div
                className="pointer-events-none absolute -right-4 top-1/2 hidden -translate-y-1/2 select-none font-mono text-[94px] font-bold leading-none text-white/[0.04] sm:block"
                aria-hidden
              >
                &lt;/&gt;
              </div>
              <div className="absolute inset-y-0 left-5 flex items-center gap-3 sm:left-6">
                <span className="flex h-10 w-10 items-center justify-center rounded-md border border-white/10 bg-white/[0.06] text-accent-hover">
                  <Code2 className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-[11px] font-medium text-header-muted">Department of Computer Science</p>
                  <p className="mt-0.5 text-[13px] font-semibold text-header-ink">Learn · build · share</p>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
              <div className="min-w-0">
                <h1 className="font-display text-[28px] font-semibold leading-tight tracking-tight text-ink sm:text-[30px]">
                  Community feed
                </h1>
                <p className="mt-1.5 max-w-xl text-[13.5px] leading-relaxed text-muted">
                  Discussions, project showcases and workshops from every CSE batch.
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <button type="button" onClick={openComposer} className="btn btn-solid">
                  <Plus className="h-4 w-4" />
                  New post
                </button>
                <button type="button" onClick={openEventComposer} className="btn btn-outline">
                  <CalendarDays className="h-4 w-4" />
                  Host event
                </button>
              </div>
            </div>
          </section>

          {/* Composer */}
          <div className="card flex items-center gap-3 p-3 sm:p-3.5">
            <UserAvatar
              src={currentUser?.avatar_url}
              name={displayName(currentUser)}
              size={38}
            />
            <button
              type="button"
              onClick={openComposer}
              className="min-w-0 flex-1 rounded-md border border-line bg-elevated px-3.5 py-2.5 text-left text-[13px] text-dim transition-colors hover:border-line-strong hover:text-muted"
            >
              <span className="block truncate">Share a question, project or idea…</span>
            </button>
            <button
              type="button"
              onClick={openComposer}
              className="btn btn-accent btn-sm shrink-0"
              aria-label="Create a post"
            >
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Create</span>
            </button>
          </div>

          {/* Filters */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <FilterTabs
              tabs={tabs}
              value={feedFilter}
              onChange={setFeedFilter}
              ariaLabel="Filter the feed"
            />

            <div className="flex shrink-0 items-center gap-2">
              <label htmlFor="batch-filter" className="text-[11.5px] text-dim">
                Batch
              </label>
              <select
                id="batch-filter"
                value={yearFilter}
                onChange={event => setYearFilter(Number(event.target.value) as YearFilter)}
                className="field-select h-9 w-[132px]"
              >
                {YEAR_OPTIONS.map(option => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {searchQuery && (
            <div className="flex items-center justify-between gap-3 rounded-md border border-accent/25 bg-accent-soft px-3.5 py-2.5">
              <p className="flex min-w-0 items-center gap-2 text-[12.5px] text-muted">
                <Search className="h-3.5 w-3.5 shrink-0 text-accent-hover" />
                <span className="truncate">
                  {totalItemCount} result{totalItemCount === 1 ? '' : 's'} for{' '}
                  <span className="font-medium text-ink">&ldquo;{searchQuery}&rdquo;</span>
                </span>
              </p>
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="inline-flex shrink-0 items-center gap-1 text-[11.5px] font-medium text-muted transition-colors hover:text-ink"
              >
                <X className="h-3 w-3" /> Clear
              </button>
            </div>
          )}

          {feedError && (
            <p className="rounded-md border border-line bg-surface px-3.5 py-2.5 text-[12px] text-dim">
              Some feed data could not be refreshed. {feedError}
            </p>
          )}

          {feedLoading ? (
            <div className="space-y-4" aria-busy="true" aria-label="Loading the feed">
              {[0, 1, 2].map(item => (
                <div key={item} className="card flex items-start gap-3 p-5">
                  <div className="h-10 w-10 shrink-0 rounded-full bg-elevated" />
                  <div className="min-w-0 flex-1 space-y-2.5">
                    <div className="h-3 w-1/3 rounded bg-elevated" />
                    <div className="h-4 w-4/5 rounded bg-elevated" />
                    <div className="h-3 w-full rounded bg-elevated" />
                    <div className="h-3 w-2/3 rounded bg-elevated" />
                  </div>
                </div>
              ))}
            </div>
          ) : totalItemCount === 0 ? (
            <EmptyState
              icon={
                searchQuery ? (
                  <Search className="h-6 w-6" />
                ) : feedFilter === 'events' ? (
                  <CalendarDays className="h-6 w-6" />
                ) : feedFilter === 'announcements' ? (
                  <Megaphone className="h-6 w-6" />
                ) : (
                  <MessageSquare className="h-6 w-6" />
                )
              }
              title={
                searchQuery
                  ? 'Nothing matched that search'
                  : feedFilter === 'events'
                    ? 'No upcoming events yet'
                    : feedFilter === 'announcements'
                      ? 'No announcements yet'
                      : 'The feed is quiet'
              }
              body={
                searchQuery
                  ? `No posts, projects or events matched “${searchQuery}”. Try a different keyword or clear the filters.`
                  : feedFilter === 'events'
                    ? 'Workshops, reviews and meetups will appear here once they are scheduled.'
                    : feedFilter === 'announcements'
                      ? 'Faculty announcements will appear here when they are published.'
                      : 'Start the first discussion, share a project, or schedule something for your batch.'
              }
              action={
                searchQuery ? (
                  <button type="button" className="btn btn-outline" onClick={() => setSearchQuery('')}>
                    Clear search
                  </button>
                ) : feedFilter === 'events' ? (
                  <button type="button" className="btn btn-accent" onClick={openEventComposer}>
                    <CalendarDays className="h-4 w-4" /> Host an event
                  </button>
                ) : feedFilter === 'announcements' ? undefined : (
                  <button type="button" className="btn btn-accent" onClick={openComposer}>
                    <Plus className="h-4 w-4" /> Create a post
                  </button>
                )
              }
            />
          ) : (
            <div className="space-y-7">
              {showAnnouncements && filteredAnnouncements.length > 0 && (
                <section className="space-y-3" aria-labelledby="announcements-heading">
                  <SectionHeader
                    id="announcements-heading"
                    title="Announcements"
                    count={filteredAnnouncements.length}
                    icon={<Megaphone className="h-4 w-4" />}
                  />
                  <div className="space-y-4">
                    {filteredAnnouncements.map(announcement => (
                      <AnnouncementCard key={announcement.id} announcement={announcement} />
                    ))}
                  </div>
                </section>
              )}

              {showPosts && filteredPosts.length > 0 && (
                <section className="space-y-3" aria-labelledby="posts-heading">
                  <SectionHeader
                    id="posts-heading"
                    title={postsHeading}
                    count={filteredPosts.length}
                    icon={
                      feedFilter === 'showcases' ? (
                        <Sparkles className="h-4 w-4" />
                      ) : (
                        <MessageSquare className="h-4 w-4" />
                      )
                    }
                  />
                  <div className="space-y-4">
                    {filteredPosts.map(post => (
                      <PostCard key={post.id} post={post} />
                    ))}
                  </div>
                </section>
              )}

              {showEvents && filteredEvents.length > 0 && (
                <section className="space-y-3" aria-labelledby="events-heading">
                  <SectionHeader
                    id="events-heading"
                    title="Upcoming events"
                    count={filteredEvents.length}
                    icon={<CalendarDays className="h-4 w-4" />}
                  />
                  <div className="space-y-4">
                    {filteredEvents.map(event => (
                      <EventCard key={event.id} event={event} />
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}
        </div>

        <div className="hidden min-[1360px]:block">
          <div className="sticky top-[88px]">
            <SidebarRight />
          </div>
        </div>
      </div>
    </AppShell>
  )
}
