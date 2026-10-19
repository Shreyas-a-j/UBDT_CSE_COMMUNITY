'use client'

import React from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  CalendarDays, Check, Edit3, GraduationCap, Inbox, LayoutDashboard,
  LogIn, Megaphone, MessagesSquare, Network, Shield, Sparkles, UserRound, Users,
} from 'lucide-react'
import { useCommunity } from '@/contexts/CommunityContext'
import { displayName, isAdmin, isVerifiedFaculty } from '@/lib/profile'
import { getYearLabel } from '@/lib/utils'
import UserAvatar from '@/components/UserAvatar'

const BATCHES = [
  { value: 0 as const, label: 'All batches' },
  { value: 1 as const, label: '1st year' },
  { value: 2 as const, label: '2nd year' },
  { value: 3 as const, label: '3rd year' },
  { value: 4 as const, label: '4th year' },
]

export default function CommunitySidebar({
  onNavigate,
  className = '',
}: {
  onNavigate?: () => void
  className?: string
}) {
  const {
    currentUser, posts, events, announcements, feedFilter, setFeedFilter,
    yearFilter, setYearFilter, setSearchQuery, setIsAuthModalOpen,
    setIsProfileModalOpen, setSelectedProfileForView,
  } = useCommunity()

  const pathname = usePathname()
  const router = useRouter()

  const discussions = posts.filter(post => post.type === 'discussion').length
  const showcases = posts.filter(post => post.type === 'showcase').length

  const feedActive = pathname === '/' && feedFilter === 'all'
  const eventsActive = pathname === '/' && feedFilter === 'events'
  const discussionsActive = pathname === '/' && feedFilter === 'discussions'
  const showcasesActive = pathname === '/' && feedFilter === 'showcases'
  const announcementsActive = pathname === '/' && feedFilter === 'announcements'

  const goToFilter = (filter: typeof feedFilter) => {
    setFeedFilter(filter)
    setSearchQuery('')
    if (pathname !== '/') router.push('/')
    onNavigate?.()
  }

  const batchCount = (year: number) => {
    if (year === 0) return posts.length + events.length
    return (
      posts.filter(post => post.target_years.includes(year) || post.author_year === year).length +
      events.filter(event => event.target_years.includes(year)).length
    )
  }

  const isPeople = pathname.startsWith('/people')
  const isFaculty = pathname.startsWith('/faculty') && !pathname.startsWith('/faculty/dashboard')
  const isNetwork = pathname.startsWith('/connections')
  const isMessages = pathname.startsWith('/messages')
  const isFacultyDashboard = pathname === '/faculty/dashboard'
  const isAdminPage = pathname.startsWith('/admin')

  return (
    <div className={`flex h-full min-h-0 flex-col px-3 py-4 ${className}`}>
      <nav
        aria-label="Community navigation"
        className="side-scroll flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1"
      >
        <div className="space-y-1">
          <p className="side-label mb-2">Browse</p>

          <button
            type="button"
            onClick={() => goToFilter('all')}
            aria-pressed={feedActive}
            className="side-link"
          >
            <MessagesSquare className="side-icon" aria-hidden />
            <span className="min-w-0 flex-1 truncate">Feed</span>
          </button>

          <button
            type="button"
            onClick={() => goToFilter('events')}
            aria-pressed={eventsActive}
            className="side-link"
          >
            <CalendarDays className="side-icon" aria-hidden />
            <span className="min-w-0 flex-1 truncate">Events</span>
            {events.length > 0 && <span className="text-[11px] tabular-nums text-dim">{events.length}</span>}
          </button>

          <button
            type="button"
            onClick={() => goToFilter('discussions')}
            aria-pressed={discussionsActive}
            className="side-link"
          >
            <MessagesSquare className="side-icon" aria-hidden />
            <span className="min-w-0 flex-1 truncate">Discussions</span>
            {discussions > 0 && <span className="text-[11px] tabular-nums text-dim">{discussions}</span>}
          </button>

          <button
            type="button"
            onClick={() => goToFilter('showcases')}
            aria-pressed={showcasesActive}
            className="side-link"
          >
            <Sparkles className="side-icon" aria-hidden />
            <span className="min-w-0 flex-1 truncate">Project showcase</span>
            {showcases > 0 && <span className="text-[11px] tabular-nums text-dim">{showcases}</span>}
          </button>

          <button
            type="button"
            onClick={() => goToFilter('announcements')}
            aria-pressed={announcementsActive}
            className="side-link"
          >
            <Megaphone className="side-icon" aria-hidden />
            <span className="min-w-0 flex-1 truncate">Announcements</span>
            {announcements.length > 0 && (
              <span className="text-[11px] tabular-nums text-dim">{announcements.length}</span>
            )}
          </button>
        </div>

        <div className="space-y-1">
          <p className="side-label mb-2">Community</p>

          <Link
            href="/people"
            onClick={onNavigate}
            aria-current={isPeople ? 'page' : undefined}
            className="side-link"
          >
            <Users className="side-icon" aria-hidden />
            <span className="min-w-0 flex-1 truncate">People</span>
          </Link>

          <Link
            href="/faculty"
            onClick={onNavigate}
            aria-current={isFaculty ? 'page' : undefined}
            className="side-link"
          >
            <GraduationCap className="side-icon" aria-hidden />
            <span className="min-w-0 flex-1 truncate">Faculty</span>
          </Link>

          <Link
            href="/connections"
            onClick={onNavigate}
            aria-current={isNetwork ? 'page' : undefined}
            className="side-link"
          >
            <Network className="side-icon" aria-hidden />
            <span className="min-w-0 flex-1 truncate">Your network</span>
          </Link>

          <Link
            href="/messages"
            onClick={onNavigate}
            aria-current={isMessages ? 'page' : undefined}
            className="side-link"
          >
            <Inbox className="side-icon" aria-hidden />
            <span className="min-w-0 flex-1 truncate">Messages</span>
          </Link>
        </div>

        {currentUser && (
          <div className="space-y-1">
            <p className="side-label mb-2">Your space</p>
            <Link
              href={`/people/${currentUser.id}`}
              onClick={onNavigate}
              className="side-link"
            >
              <UserRound className="side-icon" aria-hidden />
              <span className="min-w-0 flex-1 truncate">Your profile</span>
            </Link>
            {isVerifiedFaculty(currentUser) && (
              <Link
                href="/faculty/dashboard"
                onClick={onNavigate}
                aria-current={isFacultyDashboard ? 'page' : undefined}
                className="side-link"
              >
                <LayoutDashboard className="side-icon" aria-hidden />
                <span className="min-w-0 flex-1 truncate">Faculty dashboard</span>
              </Link>
            )}
            {isAdmin(currentUser) && (
              <Link
                href="/admin"
                onClick={onNavigate}
                aria-current={isAdminPage ? 'page' : undefined}
                className="side-link"
              >
                <Shield className="side-icon" aria-hidden />
                <span className="min-w-0 flex-1 truncate">Administration</span>
              </Link>
            )}
          </div>
        )}

        <div>
          <div className="mb-2 flex items-center justify-between px-3">
            <p className="text-[11px] font-semibold text-[#7f8294]">Batches</p>
            <span className="text-[10.5px] text-[#6f7284]">Filter</span>
          </div>
          <div className="space-y-0.5">
            {BATCHES.map(batch => {
              const active = yearFilter === batch.value
              return (
                <button
                  key={batch.value}
                  type="button"
                  onClick={() => {
                    setYearFilter(batch.value)
                    onNavigate?.()
                  }}
                  aria-pressed={active}
                  className="side-link min-h-8"
                >
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                      active ? 'bg-accent' : 'bg-[#4a4d5e]'
                    }`}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate">{batch.label}</span>
                  <span className={`text-[10.5px] tabular-nums ${active ? 'text-accent-hover' : 'text-dim'}`}>
                    {active ? <Check className="h-3.5 w-3.5" aria-hidden /> : batchCount(batch.value)}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </nav>

      <div className="mt-4 shrink-0 border-t border-[var(--color-sidebar-line)] pt-4">
        {currentUser ? (
          <div className="rounded-lg border border-[var(--color-sidebar-line)] bg-white/[0.035] p-3">
            <div className="flex items-center gap-2.5">
              <UserAvatar
                src={currentUser.avatar_url}
                name={displayName(currentUser)}
                size={36}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12.5px] font-semibold text-header-ink">
                  {displayName(currentUser)}
                </p>
                <p className="truncate text-[10.5px] text-sidebar-muted">
                  {currentUser.usn || currentUser.email || currentUser.role}
                  {currentUser.year ? ` · ${getYearLabel(currentUser.year)}` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedProfileForView(currentUser)
                  setIsProfileModalOpen(true)
                  onNavigate?.()
                }}
                aria-label="Edit your profile"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-sidebar-muted transition-colors hover:bg-white/10 hover:text-header-ink"
              >
                <Edit3 className="h-3.5 w-3.5" />
              </button>
            </div>
            <Link
              href={`/people/${currentUser.id}`}
              onClick={onNavigate}
              className="mt-2.5 flex h-7 items-center justify-center rounded-md border border-[var(--color-sidebar-line)] text-[11.5px] font-medium text-sidebar-muted transition-colors hover:bg-white/[0.06] hover:text-header-ink"
            >
              View profile
            </Link>
          </div>
        ) : (
          <div className="rounded-lg border border-[var(--color-sidebar-line)] bg-white/[0.035] p-3.5">
            <p className="text-[12.5px] font-semibold text-header-ink">Join the community</p>
            <p className="mt-1 text-[11.5px] leading-relaxed text-sidebar-muted">
              Sign in with your college email to post, RSVP and connect.
            </p>
            <button
              type="button"
              onClick={() => {
                setIsAuthModalOpen(true)
                onNavigate?.()
              }}
              className="btn btn-accent btn-sm mt-3 w-full"
            >
              <LogIn className="h-3.5 w-3.5" />
              Sign in or join
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
