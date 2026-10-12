'use client'

import React, { useMemo } from 'react'
import Navbar from '@/components/Navbar'
import SidebarLeft from '@/components/SidebarLeft'
import SidebarRight from '@/components/SidebarRight'
import EventCard from '@/components/EventCard'
import PostCard from '@/components/PostCard'
import CreatePostModal from '@/components/CreatePostModal'
import CreateEventModal from '@/components/CreateEventModal'
import ProfileModal from '@/components/ProfileModal'
import AuthModal from '@/components/AuthModal'
import { useCommunity } from '@/contexts/CommunityContext'
import {
  Calendar,
  MessageSquare,
  Sparkles,
  Plus,
  Compass,
  Search,
  Filter,
  GraduationCap,
  Users,
  Code,
  Flame,
} from 'lucide-react'
import { YearFilter } from '@/lib/types'

export default function Home() {
  const {
    posts,
    events,
    feedFilter,
    setFeedFilter,
    yearFilter,
    setYearFilter,
    searchQuery,
    setSearchQuery,
    setIsCreatePostOpen,
    setIsCreateEventOpen,
  } = useCommunity()

  // Filter posts based on feedFilter, yearFilter, and searchQuery
  const filteredPosts = useMemo(() => {
    return posts.filter(post => {
      // Type filter
      if (feedFilter === 'events') return false
      if (feedFilter === 'discussions' && post.type !== 'discussion') return false
      if (feedFilter === 'showcases' && post.type !== 'showcase') return false

      // Year filter
      if (yearFilter !== 0) {
        if (post.author_year && post.author_year !== yearFilter) {
          // If the post has target_years, check if it targets this year
          if (!post.target_years.includes(yearFilter)) return false
        }
      }

      // Search query filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase()
        const matchTitle = post.title.toLowerCase().includes(q)
        const matchBody = post.body.toLowerCase().includes(q)
        const matchAuthor = (post.author_name || '').toLowerCase().includes(q)
        const matchUsn = (post.author_usn || '').toLowerCase().includes(q)
        const matchTags = post.tags.some(t => t.toLowerCase().includes(q))
        const matchTech = (post.tech_stack || []).some(t => t.toLowerCase().includes(q))
        if (!matchTitle && !matchBody && !matchAuthor && !matchUsn && !matchTags && !matchTech) {
          return false
        }
      }

      return true
    })
  }, [posts, feedFilter, yearFilter, searchQuery])

  // Filter events based on feedFilter, yearFilter, and searchQuery
  const filteredEvents = useMemo(() => {
    if (feedFilter === 'discussions' || feedFilter === 'showcases') return []

    return events.filter(event => {
      // Year filter
      if (yearFilter !== 0 && !event.target_years.includes(yearFilter)) {
        return false
      }

      // Search query filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase()
        const matchTitle = event.title.toLowerCase().includes(q)
        const matchDesc = event.description.toLowerCase().includes(q)
        const matchHost = (event.host_name || '').toLowerCase().includes(q)
        const matchType = event.type.toLowerCase().includes(q)
        if (!matchTitle && !matchDesc && !matchHost && !matchType) {
          return false
        }
      }

      return true
    })
  }, [events, feedFilter, yearFilter, searchQuery])

  const totalItemCount = filteredPosts.length + filteredEvents.length

  return (
    <div className="min-h-screen flex flex-col bg-[#f8fafc]">
      {/* Sticky Navigation */}
      <Navbar />

      {/* Main Container */}
      <main className="flex-1 app-container w-full">
        <div className="feed-layout">
          {/* Left Column: Profile Card, Year Filters, 1-Click Persona Switcher */}
          <div className="sidebar-left">
            <SidebarLeft />
          </div>

          {/* Main Feed Column */}
          <div className="feed-main space-y-4">
            {/* Welcoming Feed Hero Card */}
            <div className="p-4 sm:p-5 rounded-2xl bg-gradient-to-r from-[#0d1f3c] via-[#1e3a5f] to-[#122847] text-white shadow-sm relative overflow-hidden border border-slate-800/40">
              <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-400/20 text-amber-300 text-[11px] font-semibold mb-2">
                    <Flame className="w-3.5 h-3.5 text-amber-400" />
                    <span>UBDT CSE Live Hub • 480 Students</span>
                  </div>
                  <h1 className="text-lg sm:text-xl font-extrabold tracking-tight text-white leading-snug">
                    Connect, Learn, and Showcase with Fellow CSE Students
                  </h1>
                  <p className="text-xs sm:text-sm text-slate-300 mt-1 max-w-xl leading-relaxed">
                    Peer discussions, virtual workshops, project demos, and semester notes for 1st, 2nd, 3rd, and 4th year batches.
                  </p>
                </div>

                <div className="flex sm:flex-col gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setIsCreatePostOpen(true)}
                    className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-xl shadow-xs transition-all active:scale-95"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Create Post</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsCreateEventOpen(true)}
                    className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 bg-white/10 hover:bg-white/20 text-white font-semibold text-xs rounded-xl backdrop-blur-xs transition-all"
                  >
                    <Calendar className="w-4 h-4 text-emerald-300" />
                    <span>Host Workshop</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Filter Navigation Tabs Bar */}
            <div className="card p-2 bg-white flex flex-wrap items-center justify-between gap-2 shadow-xs">
              <div className="flex items-center gap-1 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0">
                <button
                  type="button"
                  onClick={() => setFeedFilter('all')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    feedFilter === 'all'
                      ? 'bg-[#1e3a5f] text-white shadow-xs'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  All Feed ({posts.length + events.length})
                </button>
                <button
                  type="button"
                  onClick={() => setFeedFilter('events')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                    feedFilter === 'events'
                      ? 'bg-[#1e3a5f] text-white shadow-xs'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  <Calendar className="w-3.5 h-3.5" />
                  Events ({events.length})
                </button>
                <button
                  type="button"
                  onClick={() => setFeedFilter('discussions')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                    feedFilter === 'discussions'
                      ? 'bg-[#1e3a5f] text-white shadow-xs'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  Discussions ({posts.filter(p => p.type === 'discussion').length})
                </button>
                <button
                  type="button"
                  onClick={() => setFeedFilter('showcases')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                    feedFilter === 'showcases'
                      ? 'bg-amber-600 text-white shadow-xs'
                      : 'text-slate-600 hover:bg-amber-50 hover:text-amber-800'
                  }`}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  Showcases ({posts.filter(p => p.type === 'showcase').length})
                </button>
              </div>

              {/* Year Filter Chips (Mobile or Quick selector) */}
              <div className="flex items-center gap-1 overflow-x-auto text-[11px] font-semibold text-slate-500 w-full sm:w-auto">
                <span className="hidden lg:inline mr-1 text-[10px] uppercase text-slate-400 font-bold">
                  Year:
                </span>
                {[
                  { id: 0, label: 'All' },
                  { id: 1, label: '1st' },
                  { id: 2, label: '2nd' },
                  { id: 3, label: '3rd' },
                  { id: 4, label: '4th' },
                ].map(chip => (
                  <button
                    key={chip.id}
                    type="button"
                    onClick={() => setYearFilter(chip.id as YearFilter)}
                    className={`px-2 py-0.5 rounded-md transition-all ${
                      yearFilter === chip.id
                        ? 'bg-slate-800 text-white font-bold'
                        : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                    }`}
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Search filter indicator if active */}
            {searchQuery && (
              <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800 flex items-center justify-between">
                <span>
                  Showing results for: <strong className="font-semibold">"{searchQuery}"</strong> ({totalItemCount} found)
                </span>
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="font-bold underline text-amber-900 hover:text-amber-950"
                >
                  Clear search
                </button>
              </div>
            )}

            {/* Feed Content List */}
            {totalItemCount === 0 ? (
              <div className="card empty-state bg-white">
                <div className="empty-state-icon">🎓</div>
                <h3>No posts or events found</h3>
                <p>
                  {searchQuery
                    ? `No community content matched "${searchQuery}". Try different keywords.`
                    : 'Be the first one to start a discussion or host a workshop for this batch!'}
                </p>
                <div className="flex justify-center gap-3">
                  <button
                    type="button"
                    onClick={() => setIsCreatePostOpen(true)}
                    className="btn-primary text-xs"
                  >
                    Create Post
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsCreateEventOpen(true)}
                    className="btn-outline text-xs"
                  >
                    Host Event
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {/* When "all" or "events", render Events at top */}
                {filteredEvents.length > 0 && (feedFilter === 'all' || feedFilter === 'events') && (
                  <div className="space-y-4">
                    {feedFilter === 'all' && (
                      <div className="flex items-center justify-between px-1">
                        <span className="text-xs font-bold text-slate-600 uppercase tracking-wider flex items-center gap-1.5">
                          <Calendar className="w-3.5 h-3.5 text-indigo-600" />
                          Upcoming Workshops & Events
                        </span>
                        <button
                          type="button"
                          onClick={() => setFeedFilter('events')}
                          className="text-xs text-indigo-600 hover:underline font-semibold"
                        >
                          View all ({events.length})
                        </button>
                      </div>
                    )}
                    {filteredEvents.map(evt => (
                      <EventCard key={evt.id} event={evt} />
                    ))}
                  </div>
                )}

                {/* Render Posts (Discussions & Showcases) */}
                {filteredPosts.length > 0 && (
                  <div className="space-y-4">
                    {feedFilter === 'all' && filteredEvents.length > 0 && (
                      <div className="flex items-center justify-between px-1 pt-2">
                        <span className="text-xs font-bold text-slate-600 uppercase tracking-wider flex items-center gap-1.5">
                          <MessageSquare className="w-3.5 h-3.5 text-amber-600" />
                          Discussions & Project Showcases
                        </span>
                      </div>
                    )}
                    {filteredPosts.map(post => (
                      <PostCard key={post.id} post={post} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right Column: Upcoming Events Widget, Top Showcases, Guidelines */}
          <div className="sidebar-right">
            <SidebarRight />
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="mt-auto border-t border-slate-200 bg-white py-6 text-xs text-slate-500">
        <div className="app-container flex flex-col sm:flex-row items-center justify-between gap-3 text-center sm:text-left">
          <div className="flex items-center gap-2">
            <GraduationCap className="w-5 h-5 text-[#1e3a5f]" />
            <span className="font-semibold text-slate-800">
              UBDT College of Engineering, Davangere
            </span>
            <span>• CSE Community Portal</span>
          </div>
          <div className="flex items-center gap-4 text-[11px]">
            <a
              href="https://ubdtce.org"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-slate-800 hover:underline"
            >
              ubdtce.org
            </a>
            <button
              type="button"
              onClick={() => {
                setFeedFilter('all')
                window.scrollTo({ top: 0, behavior: 'smooth' })
              }}
              className="hover:text-slate-800 hover:underline"
            >
              Back to top ↑
            </button>
          </div>
        </div>
      </footer>

      {/* Global Modals */}
      <CreatePostModal />
      <CreateEventModal />
      <ProfileModal />
      <AuthModal />
    </div>
  )
}
