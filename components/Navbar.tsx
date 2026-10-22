'use client'

import React, { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  Bell, Calendar, ChevronDown, LayoutDashboard, LogIn, LogOut,
  Menu, MessageSquarePlus, Moon, Plus, Search, Shield, Sun, User, X,
} from 'lucide-react'
import { useCommunity } from '@/contexts/CommunityContext'
import { useTheme } from '@/contexts/ThemeContext'
import { getYearLabel } from '@/lib/utils'
import { displayName, isAdmin, isVerifiedFaculty } from '@/lib/profile'
import UserAvatar from '@/components/UserAvatar'
import SearchInput from '@/components/SearchInput'
import MobileNavigation from '@/components/MobileNavigation'

function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) close()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, close])

  return ref
}

const NAV_ITEMS = [
  { href: '/', label: 'Feed' },
  { href: '/announcements', label: 'Announcements' },
  { href: '/people', label: 'People' },
] as const

export default function Navbar() {
  const {
    currentUser, notifications, markNotificationAsRead, markAllNotificationsAsRead,
    setFeedFilter, setSearchQuery, setIsCreatePostOpen, setIsCreateEventOpen,
    setIsProfileModalOpen, setIsAuthModalOpen, setSelectedProfileForView, signOut,
  } = useCommunity()

  const { theme, toggleTheme } = useTheme()
  const pathname = usePathname()
  const router = useRouter()

  const [showNotifs, setShowNotifs] = useState(false)
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [showCreateMenu, setShowCreateMenu] = useState(false)
  const [showMobileMenu, setShowMobileMenu] = useState(false)
  const [showSearch, setShowSearch] = useState(false)

  const notifRef = useDismiss(showNotifs, () => setShowNotifs(false))
  const userRef = useDismiss(showUserMenu, () => setShowUserMenu(false))
  const createRef = useDismiss(showCreateMenu, () => setShowCreateMenu(false))

  const unreadNotifs = notifications.filter(notification => !notification.read)
  const admin = isAdmin(currentUser)
  const facultyMember = isVerifiedFaculty(currentUser)

  const closeOverlays = () => {
    setShowNotifs(false)
    setShowUserMenu(false)
    setShowCreateMenu(false)
    setShowMobileMenu(false)
    setShowSearch(false)
  }

  useEffect(() => {
    queueMicrotask(closeOverlays)
  }, [pathname])

  useEffect(() => {
    if (!showSearch) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowSearch(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [showSearch])

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href)

  const resetFeed = () => {
    setFeedFilter('all')
    setSearchQuery('')
  }

  const openCreate = (kind: 'post' | 'event') => {
    if (!currentUser) {
      setIsAuthModalOpen(true)
      return
    }
    if (kind === 'post') setIsCreatePostOpen(true)
    else setIsCreateEventOpen(true)
    setShowCreateMenu(false)
  }

  return (
    <>
      <header className="sticky top-0 z-50 border-b border-header-line bg-header">
        <div className="app-container flex h-16 items-center gap-2 sm:gap-3">
          <button
            type="button"
            onClick={() => {
              setShowMobileMenu(value => !value)
              setShowSearch(false)
            }}
            aria-label={showMobileMenu ? 'Close navigation' : 'Open navigation'}
            aria-expanded={showMobileMenu}
            className="header-icon lg:hidden"
          >
            {showMobileMenu ? <X className="h-[18px] w-[18px]" /> : <Menu className="h-[18px] w-[18px]" />}
          </button>

          <Link
            href="/"
            onClick={() => {
              resetFeed()
              closeOverlays()
            }}
            className="flex min-w-0 shrink-0 items-center gap-2.5"
            aria-label="UBDT CSE Community — home"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-accent/40 bg-accent-soft font-mono text-[10px] font-bold tracking-tight text-accent-chrome">
              &lt;/&gt;
            </span>
            <span className="hidden min-[380px]:flex min-w-0 flex-col leading-none">
              <span className="truncate text-[14px] font-semibold tracking-tight text-header-ink">
                UBDT <span className="text-header-muted">CSE</span>
              </span>
              <span className="mt-1 truncate text-[10px] tracking-tight text-header-muted">
                Developer community
              </span>
            </span>
          </Link>

          <nav className="ml-3 hidden items-center gap-0.5 lg:flex" aria-label="Primary">
            {NAV_ITEMS.map(item => (
              <Link
                key={item.href}
                href={item.href}
                className="nav-link"
                aria-current={isActive(item.href) ? 'page' : undefined}
                onClick={() => {
                  if (item.href === '/') resetFeed()
                  closeOverlays()
                }}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex min-w-0 items-center gap-1 sm:gap-1.5">
            <div className="hidden w-56 xl:block 2xl:w-72">
              <SearchInput inputClassName="h-9 text-[13px]" />
            </div>

            <button
              type="button"
              onClick={() => {
                setShowSearch(value => !value)
                setShowMobileMenu(false)
                setShowCreateMenu(false)
                setShowNotifs(false)
                setShowUserMenu(false)
              }}
              aria-label="Search"
              aria-expanded={showSearch}
              className="header-icon xl:hidden"
            >
              <Search className="h-[18px] w-[18px]" />
            </button>

            <div className="relative" ref={createRef}>
              <button
                type="button"
                onClick={() => {
                  if (!currentUser) {
                    setIsAuthModalOpen(true)
                    return
                  }
                  setShowCreateMenu(value => !value)
                  setShowSearch(false)
                  setShowNotifs(false)
                  setShowUserMenu(false)
                }}
                aria-expanded={showCreateMenu}
                aria-haspopup="menu"
                aria-label="Create post or event"
                className="btn btn-accent h-9 px-2.5 sm:px-3.5"
              >
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline">Create</span>
              </button>

              {showCreateMenu && (
                <div className="absolute right-0 top-full z-50 mt-3.5 w-64 overflow-hidden rounded-xl border border-line-strong bg-surface p-1.5 shadow-pop">
                  <button
                    type="button"
                    role="menuitem"
                    className="flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-elevated"
                    onClick={() => openCreate('post')}
                  >
                    <MessageSquarePlus className="mt-0.5 h-4 w-4 shrink-0 text-accent-text" />
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium text-ink">Start a post</span>
                      <span className="block text-[11.5px] text-muted">Ask a question or share a project</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-elevated"
                    onClick={() => openCreate('event')}
                  >
                    <Calendar className="mt-0.5 h-4 w-4 shrink-0 text-accent-text" />
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium text-ink">Host an event</span>
                      <span className="block text-[11.5px] text-muted">Schedule a workshop or session</span>
                    </span>
                  </button>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              className="header-icon hidden sm:inline-flex"
            >
              {theme === 'dark' ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
            </button>

            {currentUser && (
              <div className="relative" ref={notifRef}>
                <button
                  type="button"
                  onClick={() => {
                    setShowNotifs(value => !value)
                    setShowSearch(false)
                    setShowCreateMenu(false)
                    setShowUserMenu(false)
                  }}
                  aria-label={`Notifications${unreadNotifs.length ? ` (${unreadNotifs.length} unread)` : ''}`}
                  aria-expanded={showNotifs}
                  className="header-icon"
                >
                  <Bell className="h-[18px] w-[18px]" />
                  {unreadNotifs.length > 0 && (
                    <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-bold leading-none text-accent-ink">
                      {unreadNotifs.length > 9 ? '9+' : unreadNotifs.length}
                    </span>
                  )}
                </button>

                {showNotifs && (
                  <div className="absolute right-0 top-full z-50 mt-3.5 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-line-strong bg-surface shadow-pop">
                    <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
                      <span className="text-[13px] font-semibold text-ink">Notifications</span>
                      {unreadNotifs.length > 0 && (
                        <button
                          type="button"
                          className="text-[11.5px] font-medium text-accent-text hover:underline"
                          onClick={markAllNotificationsAsRead}
                        >
                          Mark all read
                        </button>
                      )}
                    </div>
                    <div className="max-h-80 overflow-y-auto">
                      {notifications.length === 0 ? (
                        <p className="px-4 py-7 text-center text-[12px] text-dim">Nothing here yet.</p>
                      ) : (
                        notifications.map(notification => (
                          <button
                            key={notification.id}
                            type="button"
                            className={`flex w-full items-start gap-2.5 border-b border-line px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-elevated ${
                              notification.read ? '' : 'bg-accent/[0.06]'
                            }`}
                            onClick={() => {
                              markNotificationAsRead(notification.id)
                              if (notification.link) router.push(notification.link)
                              setShowNotifs(false)
                            }}
                          >
                            <span
                              className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                                notification.read ? 'bg-line-strong' : 'bg-accent'
                              }`}
                            />
                            <span className="min-w-0">
                              <span className="block text-[13px] font-medium text-ink">
                                {notification.title}
                              </span>
                              {notification.body && (
                                <span className="mt-0.5 block text-[11.5px] leading-relaxed text-muted">
                                  {notification.body}
                                </span>
                              )}
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {currentUser ? (
              <div className="relative" ref={userRef}>
                <button
                  type="button"
                  onClick={() => {
                    setShowUserMenu(value => !value)
                    setShowSearch(false)
                    setShowCreateMenu(false)
                    setShowNotifs(false)
                  }}
                  aria-label="Account menu"
                  aria-expanded={showUserMenu}
                  className="flex items-center gap-1.5 rounded-md border border-header-line bg-white/[0.04] p-0.5 transition-colors hover:bg-white/[0.08] sm:pr-1.5"
                >
                  <UserAvatar
                    src={currentUser.avatar_url}
                    name={displayName(currentUser)}
                    size={28}
                    borderColor="rgba(255,255,255,0.16)"
                  />
                  <ChevronDown className="hidden h-3.5 w-3.5 text-header-muted sm:block" />
                </button>

                {showUserMenu && (
                  <div className="absolute right-0 top-full z-50 mt-3.5 w-[17rem] overflow-hidden rounded-xl border border-line-strong bg-surface shadow-pop">
                    <div className="border-b border-line px-4 py-3">
                      <p className="truncate text-[13px] font-semibold text-ink">{displayName(currentUser)}</p>
                      <p className="mt-0.5 truncate text-[11px] text-muted">
                        {currentUser.usn || currentUser.email || currentUser.role}
                      </p>
                      <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-dim">
                        <span>{getYearLabel(currentUser.year)}</span>
                        <span aria-hidden>·</span>
                        <span>{currentUser.branch || 'CSE'}</span>
                        {facultyMember && (
                          <span className="chip chip-accent py-px">Verified faculty</span>
                        )}
                      </p>
                    </div>
                    <div className="p-1.5">
                      <Link
                        href={`/people/${currentUser.id}`}
                        onClick={closeOverlays}
                        className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-muted transition-colors hover:bg-elevated hover:text-ink"
                      >
                        <User className="h-3.5 w-3.5" /> View profile
                      </Link>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] text-muted transition-colors hover:bg-elevated hover:text-ink"
                        onClick={() => {
                          setSelectedProfileForView(currentUser)
                          setIsProfileModalOpen(true)
                          setShowUserMenu(false)
                        }}
                      >
                        <User className="h-3.5 w-3.5" /> Edit profile
                      </button>
                      {facultyMember && (
                        <Link
                          href="/faculty/dashboard"
                          onClick={closeOverlays}
                          className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-muted transition-colors hover:bg-elevated hover:text-ink"
                        >
                          <LayoutDashboard className="h-3.5 w-3.5" /> Faculty dashboard
                        </Link>
                      )}
                      {admin && (
                        <Link
                          href="/admin"
                          onClick={closeOverlays}
                          className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-muted transition-colors hover:bg-elevated hover:text-ink"
                        >
                          <Shield className="h-3.5 w-3.5" /> Administration
                        </Link>
                      )}
                      <div className="my-1 h-px bg-line" />
                      <button
                        type="button"
                        className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] text-danger transition-colors hover:bg-danger/10"
                        onClick={async () => {
                          setShowUserMenu(false)
                          await signOut()
                        }}
                      >
                        <LogOut className="h-3.5 w-3.5" /> Sign out
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <Link href="/signin" aria-label="Sign in" className="btn btn-solid h-9 px-2.5 sm:px-3.5">
                <LogIn className="h-4 w-4" />
                <span className="hidden sm:inline">Sign in</span>
              </Link>
            )}
          </div>
        </div>

        {showSearch && (
          <>
            <button
              type="button"
              aria-label="Close search"
              onClick={() => setShowSearch(false)}
              className="fixed inset-x-0 bottom-0 top-16 z-40 bg-black/35"
            />
            <div className="absolute inset-x-0 top-full z-50 border-b border-header-line bg-header px-4 py-3 shadow-pop sm:px-6">
              <div className="mx-auto w-full max-w-[1600px]">
                <SearchInput
                  autoFocus
                  onSearch={() => setShowSearch(false)}
                  className="w-full sm:ml-auto sm:max-w-md"
                />
              </div>
            </div>
          </>
        )}
      </header>

      <MobileNavigation open={showMobileMenu} onClose={() => setShowMobileMenu(false)} />
    </>
  )
}
