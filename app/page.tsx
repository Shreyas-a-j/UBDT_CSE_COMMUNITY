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
import { Calendar, MessageSquare, Sparkles, Plus, GraduationCap } from 'lucide-react'
import { YearFilter } from '@/lib/types'

// Pixel style helper
const px = (base: React.CSSProperties): React.CSSProperties => base

export default function Home() {
  const {
    posts, events, feedFilter, setFeedFilter, yearFilter, setYearFilter,
    searchQuery, setSearchQuery, setIsCreatePostOpen, setIsCreateEventOpen,
  } = useCommunity()

  const filteredPosts = useMemo(() => {
    return posts.filter(post => {
      if (feedFilter === 'events') return false
      if (feedFilter === 'discussions' && post.type !== 'discussion') return false
      if (feedFilter === 'showcases' && post.type !== 'showcase') return false
      if (yearFilter !== 0) {
        if (post.author_year && post.author_year !== yearFilter) {
          if (!post.target_years.includes(yearFilter)) return false
        }
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase()
        const matchTitle = post.title.toLowerCase().includes(q)
        const matchBody = post.body.toLowerCase().includes(q)
        const matchAuthor = (post.author_name || '').toLowerCase().includes(q)
        const matchUsn = (post.author_usn || '').toLowerCase().includes(q)
        const matchTags = post.tags.some(t => t.toLowerCase().includes(q))
        const matchTech = (post.tech_stack || []).some(t => t.toLowerCase().includes(q))
        if (!matchTitle && !matchBody && !matchAuthor && !matchUsn && !matchTags && !matchTech) return false
      }
      return true
    })
  }, [posts, feedFilter, yearFilter, searchQuery])

  const filteredEvents = useMemo(() => {
    if (feedFilter === 'discussions' || feedFilter === 'showcases') return []
    return events.filter(event => {
      if (yearFilter !== 0 && !event.target_years.includes(yearFilter)) return false
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase()
        const match = event.title.toLowerCase().includes(q)
          || event.description.toLowerCase().includes(q)
          || (event.host_name || '').toLowerCase().includes(q)
          || event.type.toLowerCase().includes(q)
        if (!match) return false
      }
      return true
    })
  }, [events, feedFilter, yearFilter, searchQuery])

  const totalItemCount = filteredPosts.length + filteredEvents.length

  const filterTabs = [
    { id: 'all', label: `ALL (${posts.length + events.length})`, icon: null, activeColor: '#00aaff', activeShadow: '#003366' },
    { id: 'events', label: `EVENTS (${events.length})`, icon: <Calendar style={{ width: 12, height: 12, color: '#00ffcc' }} />, activeColor: '#00ffcc', activeShadow: '#006655' },
    { id: 'discussions', label: `DISCUSS (${posts.filter(p => p.type === 'discussion').length})`, icon: <MessageSquare style={{ width: 12, height: 12, color: '#44ccff' }} />, activeColor: '#00aaff', activeShadow: '#003366' },
    { id: 'showcases', label: `SHOWCASE (${posts.filter(p => p.type === 'showcase').length})`, icon: <Sparkles style={{ width: 12, height: 12, color: '#ffe066' }} />, activeColor: '#ffe066', activeShadow: '#665500' },
  ]

  const yearChips = [
    { id: 0, label: 'ALL' },
    { id: 1, label: '1ST' },
    { id: 2, label: '2ND' },
    { id: 3, label: '3RD' },
    { id: 4, label: '4TH' },
  ]

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: '#060a14', color: '#a8d4f0' }}>
      <Navbar />

      <main style={{ flex: 1 }} className="app-container w-full">
        <div className="feed-layout">
          {/* Left Sidebar */}
          <div className="sidebar-left">
            <SidebarLeft />
          </div>

          {/* Main Feed */}
          <div className="feed-main space-y-4">
            {/* Hero Banner */}
            <div style={{ padding: '22px', background: '#0d1426', border: '2px solid #1e3560', boxShadow: '4px 4px 0px #000, 0 0 20px rgba(0,170,255,0.08)', position: 'relative', overflow: 'hidden' }}>
              {/* Corner pixel decorations */}
              <div style={{ position: 'absolute', top: 0, left: 0, width: 8, height: 8, background: '#00aaff' }} />
              <div style={{ position: 'absolute', top: 0, right: 0, width: 8, height: 8, background: '#00ffcc' }} />
              <div style={{ position: 'absolute', bottom: 0, left: 0, width: 8, height: 8, background: '#00ffcc' }} />
              <div style={{ position: 'absolute', bottom: 0, right: 0, width: 8, height: 8, background: '#00aaff' }} />
              {/* Background grid highlight */}
              <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, rgba(0,170,255,0.04) 0%, transparent 60%)', pointerEvents: 'none' }} />

              <div className="relative flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(0,170,255,0.15)', border: '2px solid rgba(0,170,255,0.4)', padding: '3px 10px', marginBottom: 10, boxShadow: '2px 2px 0px #003366' }}>
                    <span className="animate-pixel-blink" style={{ width: 6, height: 6, background: '#00ffcc', display: 'inline-block' }} />
                    <span style={{ fontSize: '0.6875rem', color: '#44ccff', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 700 }}>
                      UCC COMMUNITY HUB • LIVE
                    </span>
                  </div>
                  <h1 style={{ fontSize: '1.45rem', color: '#e8f4fd', lineHeight: 1.25, fontWeight: 800, marginBottom: 8, letterSpacing: '-0.01em' }}>
                    CONNECT. LEARN. SHOWCASE.
                  </h1>
                  <p style={{ fontSize: '0.85rem', color: '#a8d4f0', lineHeight: 1.6, maxWidth: 480, fontWeight: 400 }}>
                    Peer discussions, virtual workshops, project demos, and semester resources for 1st to 4th year CSE batches.
                  </p>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
                  <button
                    type="button"
                    onClick={() => setIsCreatePostOpen(true)}
                    style={{ background: '#00aaff', color: '#060a14', border: '2px solid #0088cc', padding: '9px 16px', fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, boxShadow: '4px 4px 0px #003366', textTransform: 'uppercase', transition: 'all 0.05s steps(1)', letterSpacing: '0.03em' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#44ccff'; (e.currentTarget as HTMLElement).style.transform = 'translate(-2px,-2px)'; (e.currentTarget as HTMLElement).style.boxShadow = '6px 6px 0px #003366' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#00aaff'; (e.currentTarget as HTMLElement).style.transform = 'none'; (e.currentTarget as HTMLElement).style.boxShadow = '4px 4px 0px #003366' }}
                  >
                    <Plus style={{ width: 15, height: 15 }} />
                    CREATE POST
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsCreateEventOpen(true)}
                    style={{ background: 'transparent', color: '#00ffcc', border: '2px solid #00ffcc', padding: '9px 16px', fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, boxShadow: '4px 4px 0px #006655', textTransform: 'uppercase', transition: 'all 0.05s steps(1)', letterSpacing: '0.03em' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(0,255,204,0.1)'; (e.currentTarget as HTMLElement).style.transform = 'translate(-2px,-2px)'; (e.currentTarget as HTMLElement).style.boxShadow = '6px 6px 0px #006655' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.transform = 'none'; (e.currentTarget as HTMLElement).style.boxShadow = '4px 4px 0px #006655' }}
                  >
                    <Calendar style={{ width: 15, height: 15 }} />
                    HOST WORKSHOP
                  </button>
                </div>
              </div>
            </div>

            {/* Filter Bar */}
            <div style={{ background: '#0d1426', border: '2px solid #1e3560', padding: '8px', boxShadow: '4px 4px 0px #000' }}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                {/* Feed type tabs */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                  {filterTabs.map(tab => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setFeedFilter(tab.id as any)}
                      style={{
                        padding: '6px 12px', fontSize: '0.75rem', fontWeight: 700,
                        cursor: 'pointer', border: '2px solid', display: 'flex', alignItems: 'center', gap: 6,
                        transition: 'all 0.05s steps(1)', textTransform: 'uppercase', letterSpacing: '0.02em',
                        background: feedFilter === tab.id ? tab.activeColor : 'transparent',
                        color: feedFilter === tab.id ? '#060a14' : '#6bafd4',
                        borderColor: feedFilter === tab.id ? tab.activeColor : 'transparent',
                        boxShadow: feedFilter === tab.id ? `3px 3px 0px ${tab.activeShadow}` : 'none',
                        transform: feedFilter === tab.id ? 'translate(-1px,-1px)' : 'none',
                      }}
                    >
                      {tab.icon}{tab.label}
                    </button>
                  ))}
                </div>

                {/* Year chips */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ fontSize: '0.7rem', color: '#6bafd4', fontWeight: 700, textTransform: 'uppercase', marginRight: 4, letterSpacing: '0.03em' }}>BATCH:</span>
                  {yearChips.map(chip => (
                    <button
                      key={chip.id}
                      type="button"
                      onClick={() => setYearFilter(chip.id as YearFilter)}
                      style={{
                        padding: '4px 9px', fontSize: '0.72rem', fontWeight: 700,
                        cursor: 'pointer', border: '2px solid', transition: 'all 0.05s steps(1)', textTransform: 'uppercase',
                        background: yearFilter === chip.id ? '#00aaff' : '#0c1220',
                        color: yearFilter === chip.id ? '#060a14' : '#a8d4f0',
                        borderColor: yearFilter === chip.id ? '#0088cc' : '#1e3560',
                        boxShadow: yearFilter === chip.id ? '2px 2px 0px #003366' : '2px 2px 0px #000',
                        transform: yearFilter === chip.id ? 'translate(-1px,-1px)' : 'none',
                      }}
                    >
                      {chip.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Search indicator */}
            {searchQuery && (
              <div style={{ padding: '8px 14px', background: 'rgba(0,170,255,0.08)', border: '2px solid rgba(0,170,255,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '2px 2px 0px #001133' }}>
                <span style={{ fontSize: '0.8rem', color: '#44ccff' }}>
                  RESULTS FOR: <strong style={{ color: '#e8f4fd' }}>"{searchQuery}"</strong> ({totalItemCount} found)
                </span>
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  style={{ fontSize: '0.75rem', color: '#00aaff', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', fontWeight: 600 }}
                >
                  CLEAR
                </button>
              </div>
            )}

            {/* Feed Content */}
            {totalItemCount === 0 ? (
              <div style={{ background: '#0d1426', border: '2px solid #1e3560', padding: '40px 20px', textAlign: 'center', boxShadow: '4px 4px 0px #000' }}>
                <div style={{ fontSize: '2rem', marginBottom: 12 }}>🎓</div>
                <h3 style={{ fontSize: '1rem', fontWeight: 800, color: '#e8f4fd', marginBottom: 8, letterSpacing: '0.02em' }}>NO POSTS FOUND</h3>
                <p style={{ fontSize: '0.825rem', color: '#6bafd4', marginBottom: 20, lineHeight: 1.6 }}>
                  {searchQuery ? `Nothing matched "${searchQuery}". Try different keywords.` : 'Be the first to start a discussion or host a workshop!'}
                </p>
                <div style={{ display: 'flex', justifyContent: 'center', gap: 12 }}>
                  <button type="button" onClick={() => setIsCreatePostOpen(true)} className="btn-primary">CREATE POST</button>
                  <button type="button" onClick={() => setIsCreateEventOpen(true)} className="btn-outline">HOST EVENT</button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {/* Events section */}
                {filteredEvents.length > 0 && (feedFilter === 'all' || feedFilter === 'events') && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {feedFilter === 'all' && (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 4px' }}>
                        <span style={{ fontSize: '0.78rem', color: '#00ffcc', fontWeight: 700, textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 6, letterSpacing: '0.04em' }}>
                          <Calendar style={{ width: 14, height: 14, color: '#00ffcc' }} />
                          UPCOMING EVENTS
                        </span>
                        <button type="button" onClick={() => setFeedFilter('events')} style={{ fontSize: '0.72rem', color: '#00aaff', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', fontWeight: 600 }}>
                          VIEW ALL ({events.length})
                        </button>
                      </div>
                    )}
                    {filteredEvents.map(evt => <EventCard key={evt.id} event={evt} />)}
                  </div>
                )}

                {/* Posts section */}
                {filteredPosts.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {feedFilter === 'all' && filteredEvents.length > 0 && (
                      <div style={{ padding: '0 4px', paddingTop: 8 }}>
                        <span style={{ fontSize: '0.78rem', color: '#00aaff', fontWeight: 700, textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 6, letterSpacing: '0.04em' }}>
                          <MessageSquare style={{ width: 14, height: 14 }} />
                          DISCUSSIONS &amp; SHOWCASES
                        </span>
                      </div>
                    )}
                    {filteredPosts.map(post => <PostCard key={post.id} post={post} />)}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right Sidebar */}
          <div className="sidebar-right">
            <SidebarRight />
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer style={{ borderTop: '2px solid #1e3560', background: '#090e1c', padding: '20px 0', marginTop: 'auto' }}>
        <div className="app-container" style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center', textAlign: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <GraduationCap style={{ width: 18, height: 18, color: '#00aaff' }} />
            <span style={{ fontSize: '0.8rem', color: '#e8f4fd', fontWeight: 700, letterSpacing: '0.04em' }}>
              UCC — COMPUTER SCIENCE &amp; ENGINEERING
            </span>
            <span style={{ fontSize: '0.75rem', color: '#6bafd4' }}>• COMMUNITY PORTAL</span>
          </div>
          <div style={{ display: 'flex', gap: 16 }}>
            <a href="https://ubdtce.org" target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.75rem', color: '#00aaff', textDecoration: 'underline', fontWeight: 600 }}>ubdtce.org</a>
            <button type="button" onClick={() => { setFeedFilter('all'); window.scrollTo({ top: 0, behavior: 'smooth' }) }} style={{ fontSize: '0.75rem', color: '#6bafd4', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', fontWeight: 600 }}>
              BACK TO TOP ↑
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
