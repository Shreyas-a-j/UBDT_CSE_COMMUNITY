'use client'

import React, { useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import {
  Bell, Search, Plus, Calendar, MessageSquarePlus, User, LogOut, ChevronDown,
  Sparkles, ExternalLink, GraduationCap, LogIn, Moon, Sun, MessageSquare,
} from 'lucide-react'
import { useCommunity } from '@/contexts/CommunityContext'
import { useTheme } from '@/contexts/ThemeContext'
import { getAvatarFallback, getYearLabel } from '@/lib/utils'
import UserAvatar from '@/components/UserAvatar'

export default function Navbar() {
  const {
    currentUser, notifications, markNotificationAsRead, markAllNotificationsAsRead,
    feedFilter, setFeedFilter, searchQuery, setSearchQuery,
    setIsCreatePostOpen, setIsCreateEventOpen, setIsProfileModalOpen,
    setIsAuthModalOpen, setSelectedProfileForView, signOut,
  } = useCommunity()

  const { theme, toggleTheme } = useTheme()
  const [showNotifs, setShowNotifs] = useState(false)
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [showCreateMenu, setShowCreateMenu] = useState(false)

  const unreadNotifs = notifications.filter(n => !n.read)

  return (
    <header className="sticky top-0 z-40 w-full" style={{ borderBottom: '2px solid #1e3560', background: '#060a14', boxShadow: '0 4px 0px #000, 0 0 20px rgba(0,170,255,0.08)' }}>
      {/* Top Banner */}
      <div style={{ background: '#0a0f20', borderBottom: '2px solid #1e3560', padding: '5px 16px' }}>
        <div className="app-container flex items-center justify-center">
          <div className="flex items-center gap-2">
            <span className="animate-pixel-blink" style={{ width: 8, height: 8, background: '#00ffcc', display: 'inline-block', boxShadow: '0 0 6px #00ffcc' }} />
            <span style={{ fontSize: '0.72rem', color: '#a8d4f0', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>
              UCC — Dept. of Computer Science &amp; Engineering
            </span>
            <a
              href="https://ubdtce.org" target="_blank" rel="noopener noreferrer"
              style={{ fontSize: '0.72rem', color: '#00aaff', textDecoration: 'underline', display: 'inline-flex', alignItems: 'center', gap: 2, fontWeight: 600 }}
            >
              ubdtce.org <ExternalLink style={{ width: 11, height: 11 }} />
            </a>
          </div>
        </div>
      </div>

      <div className="app-container">
        <div className="flex items-center justify-between gap-3" style={{ height: 64 }}>
          {/* Brand Logo */}
          <div className="flex items-center gap-3">
            <Link
              href="/"
              onClick={() => { setFeedFilter('all'); setSearchQuery('') }}
              className="flex items-center gap-3"
              style={{ textDecoration: 'none' }}
            >
              <div style={{ width: 42, height: 42, background: '#0d1426', border: '2px solid #00aaff', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '3px 3px 0px #003366' }}>
                <GraduationCap style={{ width: 24, height: 24, color: '#00ffcc' }} />
              </div>
              <div className="flex flex-col">
                <span style={{ fontWeight: 800, fontSize: '1.15rem', color: '#e8f4fd', lineHeight: 1.2, display: 'flex', alignItems: 'center', gap: 6, letterSpacing: '0.02em' }}>
                  UCC <span style={{ color: '#00ffcc', textShadow: '0 0 8px rgba(0,255,204,0.3)', fontSize: '0.8rem', fontWeight: 800 }}>HUB</span>
                </span>
                <span style={{ fontSize: '0.65rem', color: '#6bafd4', fontWeight: 600, letterSpacing: '0.04em' }}>COMMUNITY PORTAL</span>
              </div>
            </Link>

            {/* Quick Nav Pills */}
            <nav className="hidden md:flex items-center gap-1.5 ml-4" style={{ borderLeft: '2px solid #1e3560', paddingLeft: 16 }}>
              {[
                { id: 'all', label: 'FEED', icon: null },
                { id: 'events', label: 'EVENTS', icon: <Calendar style={{ width: 13, height: 13, color: '#00ffcc' }} /> },
                { id: 'discussions', label: 'DISCUSS', icon: <MessageSquare style={{ width: 13, height: 13, color: '#00aaff' }} /> },
                { id: 'showcases', label: 'SHOWCASE', icon: <Sparkles style={{ width: 13, height: 13, color: '#ffe066' }} /> },
              ].map(item => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setFeedFilter(item.id as any)}
                  style={{
                    fontSize: '0.75rem', fontWeight: 700,
                    padding: '6px 12px', border: '2px solid', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 5, transition: 'all 0.05s steps(1)',
                    background: feedFilter === item.id ? '#00aaff' : 'transparent',
                    color: feedFilter === item.id ? '#060a14' : '#a8d4f0',
                    borderColor: feedFilter === item.id ? '#0088cc' : 'transparent',
                    boxShadow: feedFilter === item.id ? '3px 3px 0px #003366' : 'none',
                    transform: feedFilter === item.id ? 'translate(-1px,-1px)' : 'none',
                    letterSpacing: '0.03em',
                  }}
                >
                  {item.icon}{item.label}
                </button>
              ))}
            </nav>
          </div>

          {/* Search */}
          <div className="flex-1 max-w-xs lg:max-w-md hidden sm:block">
            <div className="relative" style={{ border: '2px solid #1e3560', background: '#0c1220', display: 'flex', alignItems: 'center', padding: '5px 12px', gap: 8, boxShadow: 'inset 2px 2px 0px rgba(0,0,0,0.5)' }}>
              <Search style={{ width: 15, height: 15, color: '#6bafd4', flexShrink: 0 }} />
              <input
                type="text"
                placeholder="Search discussions, events, tags..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                style={{ border: 'none', outline: 'none', flex: 1, fontSize: '0.8125rem', color: '#e8f4fd', background: 'transparent' }}
              />
              {searchQuery && (
                <button type="button" onClick={() => setSearchQuery('')} style={{ color: '#6bafd4', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.75rem' }}>✕</button>
              )}
            </div>
          </div>

          {/* Action Controls */}
          <div className="flex items-center gap-2">
            {/* Create Dropdown */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  if (!currentUser) { setIsAuthModalOpen(true); return }
                  setShowCreateMenu(!showCreateMenu); setShowNotifs(false); setShowUserMenu(false)
                }}
                style={{ background: '#00aaff', color: '#060a14', border: '2px solid #0088cc', padding: '7px 14px', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, boxShadow: '3px 3px 0px #003366', transition: 'all 0.05s steps(1)', textTransform: 'uppercase', letterSpacing: '0.03em' }}
              >
                <Plus style={{ width: 14, height: 14 }} />
                <span className="hidden sm:inline">CREATE</span>
                <ChevronDown style={{ width: 12, height: 12 }} />
              </button>

              {showCreateMenu && (
                <div style={{ position: 'absolute', right: 0, marginTop: 4, width: 200, background: '#0d1426', border: '2px solid #1e3560', boxShadow: '6px 6px 0px #000', zIndex: 50 }}>
                  <button type="button" onClick={() => { setIsCreatePostOpen(true); setShowCreateMenu(false) }}
                    style={{ width: '100%', padding: '10px 14px', textAlign: 'left', fontSize: '0.75rem', fontWeight: 600, color: '#a8d4f0', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '2px solid #1e3560' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#101930'; (e.currentTarget as HTMLElement).style.color = '#00aaff' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; (e.currentTarget as HTMLElement).style.color = '#a8d4f0' }}
                  >
                    <MessageSquarePlus style={{ width: 14, height: 14, color: '#00aaff' }} />
                    NEW DISCUSSION
                  </button>
                  <button type="button" onClick={() => { setIsCreateEventOpen(true); setShowCreateMenu(false) }}
                    style={{ width: '100%', padding: '10px 14px', textAlign: 'left', fontSize: '0.75rem', fontWeight: 600, color: '#a8d4f0', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#101930'; (e.currentTarget as HTMLElement).style.color = '#00ffcc' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; (e.currentTarget as HTMLElement).style.color = '#a8d4f0' }}
                  >
                    <Calendar style={{ width: 14, height: 14, color: '#00ffcc' }} />
                    HOST EVENT
                  </button>
                </div>
              )}
            </div>

            {/* Theme Toggle */}
            <button
              type="button" onClick={toggleTheme}
              style={{ padding: '7px', background: 'transparent', border: '2px solid #1e3560', cursor: 'pointer', color: '#6bafd4', display: 'flex', alignItems: 'center' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = '#00aaff'; (e.currentTarget as HTMLElement).style.color = '#00aaff' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = '#1e3560'; (e.currentTarget as HTMLElement).style.color = '#6bafd4' }}
              aria-label="Toggle theme"
            >
              {theme === 'dark' ? <Sun style={{ width: 15, height: 15, color: '#ffe066' }} /> : <Moon style={{ width: 15, height: 15, color: '#00aaff' }} />}
            </button>

            {/* Notifications */}
            {currentUser && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => { setShowNotifs(!showNotifs); setShowCreateMenu(false); setShowUserMenu(false) }}
                  style={{ padding: '7px', background: 'transparent', border: '2px solid #1e3560', cursor: 'pointer', position: 'relative', display: 'flex', alignItems: 'center' }}
                  aria-label="Notifications"
                >
                  <Bell style={{ width: 16, height: 16, color: '#6bafd4' }} />
                  {unreadNotifs.length > 0 && (
                    <span style={{ position: 'absolute', top: 2, right: 2, width: 8, height: 8, background: '#ff4466', boxShadow: '0 0 6px #ff4466', display: 'block' }} />
                  )}
                </button>

                {showNotifs && (
                  <div style={{ position: 'absolute', right: 0, marginTop: 4, width: 300, background: '#0d1426', border: '2px solid #1e3560', boxShadow: '6px 6px 0px #000', zIndex: 50 }}>
                    <div style={{ padding: '10px 14px', borderBottom: '2px solid #1e3560', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: '0.75rem', color: '#e8f4fd', fontWeight: 700, letterSpacing: '0.04em' }}>NOTIFICATIONS</span>
                      {unreadNotifs.length > 0 && (
                        <button type="button" onClick={markAllNotificationsAsRead} style={{ fontSize: '0.7rem', color: '#00aaff', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
                          MARK ALL READ
                        </button>
                      )}
                    </div>
                    <div style={{ maxHeight: 240, overflowY: 'auto' }}>
                      {notifications.length === 0 ? (
                        <div style={{ padding: 16, textAlign: 'center', fontSize: '0.75rem', color: '#3d6b8a' }}>NO NOTIFICATIONS</div>
                      ) : (
                        notifications.map(n => (
                          <div
                            key={n.id}
                            onClick={() => markNotificationAsRead(n.id)}
                            style={{ padding: '10px 14px', borderBottom: '1px solid #1e3560', cursor: 'pointer', background: n.read ? 'transparent' : 'rgba(0,170,255,0.06)' }}
                          >
                            <div style={{ fontSize: '0.75rem', color: '#e8f4fd', fontWeight: 600, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              {n.title}
                              {!n.read && <span style={{ width: 6, height: 6, background: '#00aaff', display: 'inline-block', boxShadow: '0 0 4px #00aaff' }} />}
                            </div>
                            {n.body && <p style={{ fontSize: '0.7rem', color: '#a8d4f0', marginTop: 4, lineHeight: 1.5 }}>{n.body}</p>}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Profile or Sign In */}
            {currentUser ? (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => { setShowUserMenu(!showUserMenu); setShowCreateMenu(false); setShowNotifs(false) }}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', background: 'transparent', border: '2px solid #1e3560', cursor: 'pointer' }}
                >
                  <UserAvatar src={currentUser.avatar_url} name={currentUser.name} size={32} borderColor="#00aaff" />
                  <div className="hidden lg:flex flex-col" style={{ textAlign: 'left' }}>
                    <span style={{ fontSize: '0.75rem', color: '#e8f4fd', fontWeight: 700, lineHeight: 1.2 }}>{currentUser.name.split(' ')[0]}</span>
                    <span style={{ fontSize: '0.65rem', color: '#00ffcc' }}>{currentUser.usn}</span>
                  </div>
                  <ChevronDown style={{ width: 12, height: 12, color: '#6bafd4' }} />
                </button>

                {showUserMenu && (
                  <div style={{ position: 'absolute', right: 0, marginTop: 4, width: 240, background: '#0d1426', border: '2px solid #1e3560', boxShadow: '6px 6px 0px #000', zIndex: 50 }}>
                    <div style={{ padding: '12px 14px', borderBottom: '2px solid #1e3560' }}>
                      <p style={{ fontSize: '0.8rem', color: '#e8f4fd', fontWeight: 700 }}>{currentUser.name}</p>
                      <p style={{ fontSize: '0.7rem', color: '#00ffcc', marginTop: 2 }}>{currentUser.usn}</p>
                      <p style={{ fontSize: '0.7rem', color: '#6bafd4', marginTop: 2 }}>{getYearLabel(currentUser.year)} • CSE</p>
                    </div>
                    <div style={{ padding: 4 }}>
                      <button type="button" onClick={() => { setSelectedProfileForView(currentUser); setIsProfileModalOpen(true); setShowUserMenu(false) }}
                        style={{ width: '100%', padding: '10px 12px', textAlign: 'left', fontSize: '0.75rem', fontWeight: 600, color: '#a8d4f0', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#101930'; (e.currentTarget as HTMLElement).style.color = '#00aaff' }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; (e.currentTarget as HTMLElement).style.color = '#a8d4f0' }}
                      >
                        <User style={{ width: 13, height: 13 }} /> VIEW &amp; EDIT PROFILE
                      </button>
                      <button type="button" onClick={() => { signOut(); setShowUserMenu(false) }}
                        style={{ width: '100%', padding: '10px 12px', textAlign: 'left', fontSize: '0.75rem', fontWeight: 600, color: '#ff4466', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, borderTop: '2px solid #1e3560' }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,68,102,0.1)' }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none' }}
                      >
                        <LogOut style={{ width: 13, height: 13 }} /> SIGN OUT
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setIsAuthModalOpen(true)}
                style={{ background: '#00ffcc', color: '#060a14', border: '2px solid #00ccaa', padding: '7px 14px', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, boxShadow: '3px 3px 0px #006655', textTransform: 'uppercase', letterSpacing: '0.03em' }}
              >
                <LogIn style={{ width: 14, height: 14 }} />
                SIGN IN
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}
