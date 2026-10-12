'use client'

import React, { useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import {
  Bell,
  Search,
  Plus,
  Calendar,
  MessageSquarePlus,
  User,
  LogOut,
  ChevronDown,
  Sparkles,
  ExternalLink,
  GraduationCap,
  Layers,
  Check,
  RotateCcw,
} from 'lucide-react'
import { useCommunity } from '@/contexts/CommunityContext'
import { getAvatarFallback, getYearLabel } from '@/lib/utils'

export default function Navbar() {
  const {
    currentUser,
    notifications,
    markNotificationAsRead,
    markAllNotificationsAsRead,
    feedFilter,
    setFeedFilter,
    searchQuery,
    setSearchQuery,
    setIsCreatePostOpen,
    setIsCreateEventOpen,
    setIsProfileModalOpen,
    setIsAuthModalOpen,
    setSelectedProfileForView,
    switchUserByYear,
    resetToDefaultData,
  } = useCommunity()

  const [showNotifs, setShowNotifs] = useState(false)
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [showCreateMenu, setShowCreateMenu] = useState(false)

  const unreadNotifs = notifications.filter(n => !n.read)

  return (
    <header className="sticky top-0 z-40 w-full border-b border-slate-200/80 bg-white/95 backdrop-blur-md shadow-xs">
      {/* Top Banner for UBDT CE Davangere */}
      <div className="bg-gradient-to-r from-[#0a1628] via-[#1e3a5f] to-[#0d1f3c] text-white text-xs py-1 px-4 text-center flex items-center justify-between">
        <div className="flex items-center gap-2 mx-auto">
          <span className="inline-block w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
          <span className="font-medium tracking-wide">
            UBDT College of Engineering, Davangere (Constituent College of VTU) • Department of Computer Science & Engineering
          </span>
          <a
            href="https://ubdtce.org"
            target="_blank"
            rel="noopener noreferrer"
            className="text-amber-300 hover:text-amber-200 underline inline-flex items-center gap-0.5 text-[11px] ml-2 hidden sm:inline-flex"
          >
            ubdtce.org <ExternalLink className="w-2.5 h-2.5" />
          </a>
        </div>
      </div>

      <div className="app-container">
        <div className="flex items-center justify-between h-16 gap-3">
          {/* Brand Logo & Title */}
          <div className="flex items-center gap-3">
            <Link
              href="/"
              onClick={() => {
                setFeedFilter('all')
                setSearchQuery('')
              }}
              className="flex items-center gap-2.5 group text-decoration-none"
            >
              <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-[#0d1f3c] to-[#1e3a5f] flex items-center justify-center text-amber-400 font-extrabold text-lg shadow-sm border border-slate-700/30 group-hover:scale-105 transition-transform">
                <GraduationCap className="w-6 h-6 text-amber-400" />
              </div>
              <div className="flex flex-col">
                <span className="font-bold text-base sm:text-lg text-[#0d1f3c] leading-tight flex items-center gap-1.5">
                  UBDT <span className="text-amber-600 font-extrabold">CSE</span>
                  <span className="hidden md:inline-block text-[11px] uppercase tracking-wider bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded font-mono border border-slate-200">
                    480 Intake
                  </span>
                </span>
                <span className="text-[11px] font-medium text-slate-500 leading-none">
                  Community Hub & Showcase
                </span>
              </div>
            </Link>

            {/* Quick Navigation Filter Pills */}
            <nav className="hidden md:flex items-center gap-1 ml-4 border-l border-slate-200 pl-4">
              <button
                type="button"
                onClick={() => setFeedFilter('all')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  feedFilter === 'all'
                    ? 'bg-[#1e3a5f] text-white shadow-xs'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-[#1e3a5f]'
                }`}
              >
                Feed
              </button>
              <button
                type="button"
                onClick={() => setFeedFilter('events')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1 ${
                  feedFilter === 'events'
                    ? 'bg-[#1e3a5f] text-white shadow-xs'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-[#1e3a5f]'
                }`}
              >
                <Calendar className="w-3.5 h-3.5" />
                Events
              </button>
              <button
                type="button"
                onClick={() => setFeedFilter('discussions')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  feedFilter === 'discussions'
                    ? 'bg-[#1e3a5f] text-white shadow-xs'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-[#1e3a5f]'
                }`}
              >
                Discussions
              </button>
              <button
                type="button"
                onClick={() => setFeedFilter('showcases')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1 ${
                  feedFilter === 'showcases'
                    ? 'bg-amber-600 text-white shadow-xs'
                    : 'text-slate-600 hover:bg-amber-50 hover:text-amber-800'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5" />
                Showcases
              </button>
            </nav>
          </div>

          {/* Search Bar */}
          <div className="flex-1 max-w-xs lg:max-w-md hidden sm:block">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search posts, events, projects, USN..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-1.5 text-xs sm:text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-[#1e3a5f] focus:bg-white focus:ring-2 focus:ring-[#1e3a5f]/10 transition-all text-slate-800"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* Action Buttons & Profile Controls */}
          <div className="flex items-center gap-2">
            {/* Create Dropdown */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setShowCreateMenu(!showCreateMenu)
                  setShowNotifs(false)
                  setShowUserMenu(false)
                }}
                className="inline-flex items-center gap-1.5 px-3 py-2 bg-[#1e3a5f] hover:bg-[#152e4d] text-white text-xs font-semibold rounded-lg shadow-sm transition-all active:scale-95"
              >
                <Plus className="w-4 h-4" />
                <span className="hidden sm:inline">Post / Event</span>
                <ChevronDown className="w-3 h-3 opacity-80" />
              </button>

              {showCreateMenu && (
                <div className="absolute right-0 mt-2 w-48 bg-white border border-slate-200 rounded-xl shadow-lg py-1.5 z-50 animate-fade-in-up">
                  <button
                    type="button"
                    onClick={() => {
                      setIsCreatePostOpen(true)
                      setShowCreateMenu(false)
                    }}
                    className="w-full px-3.5 py-2 text-left text-xs text-slate-700 hover:bg-slate-50 flex items-center gap-2.5 font-medium"
                  >
                    <MessageSquarePlus className="w-4 h-4 text-indigo-600" />
                    New Discussion / Showcase
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsCreateEventOpen(true)
                      setShowCreateMenu(false)
                    }}
                    className="w-full px-3.5 py-2 text-left text-xs text-slate-700 hover:bg-slate-50 flex items-center gap-2.5 font-medium border-t border-slate-100"
                  >
                    <Calendar className="w-4 h-4 text-emerald-600" />
                    Host Workshop / Event
                  </button>
                </div>
              )}
            </div>

            {/* Notification Bell */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setShowNotifs(!showNotifs)
                  setShowCreateMenu(false)
                  setShowUserMenu(false)
                }}
                className="relative p-2 text-slate-600 hover:text-[#1e3a5f] hover:bg-slate-100 rounded-lg transition-colors"
                aria-label="Notifications"
              >
                <Bell className="w-5 h-5" />
                {unreadNotifs.length > 0 && (
                  <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-rose-500 rounded-full ring-2 ring-white" />
                )}
              </button>

              {showNotifs && (
                <div className="absolute right-0 mt-2 w-80 bg-white border border-slate-200 rounded-xl shadow-xl py-2 z-50 animate-fade-in-up">
                  <div className="px-3.5 py-1.5 border-b border-slate-100 flex items-center justify-between">
                    <span className="text-xs font-bold text-[#0d1f3c]">Notifications</span>
                    {unreadNotifs.length > 0 && (
                      <button
                        type="button"
                        onClick={markAllNotificationsAsRead}
                        className="text-[11px] text-indigo-600 hover:underline font-semibold"
                      >
                        Mark all as read
                      </button>
                    )}
                  </div>
                  <div className="max-h-64 overflow-y-auto divide-y divide-slate-100">
                    {notifications.length === 0 ? (
                      <div className="p-4 text-center text-xs text-slate-400">
                        No notifications yet
                      </div>
                    ) : (
                      notifications.map(n => (
                        <div
                          key={n.id}
                          onClick={() => markNotificationAsRead(n.id)}
                          className={`p-3 text-xs cursor-pointer transition-colors ${
                            n.read ? 'bg-white hover:bg-slate-50' : 'bg-indigo-50/50 hover:bg-indigo-50'
                          }`}
                        >
                          <div className="font-semibold text-slate-800 flex items-center justify-between">
                            <span>{n.title}</span>
                            {!n.read && (
                              <span className="w-1.5 h-1.5 bg-indigo-600 rounded-full" />
                            )}
                          </div>
                          {n.body && (
                            <p className="text-slate-600 mt-0.5 line-clamp-2 leading-relaxed">
                              {n.body}
                            </p>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* User Profile Pill & Dropdown */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setShowUserMenu(!showUserMenu)
                  setShowCreateMenu(false)
                  setShowNotifs(false)
                }}
                className="flex items-center gap-2 p-1 pl-1.5 pr-2 rounded-lg hover:bg-slate-100 border border-transparent hover:border-slate-200 transition-all text-left"
              >
                <div className="w-8 h-8 rounded-full overflow-hidden bg-[#1e3a5f] text-white flex items-center justify-center font-bold text-xs ring-2 ring-slate-100">
                  {currentUser.avatar_url ? (
                    <Image
                      src={currentUser.avatar_url}
                      alt={currentUser.name}
                      width={32}
                      height={32}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    getAvatarFallback(currentUser.name)
                  )}
                </div>
                <div className="hidden lg:flex flex-col">
                  <span className="text-xs font-bold text-slate-800 leading-tight">
                    {currentUser.name.split(' ')[0]}
                  </span>
                  <span className="text-[10px] text-amber-700 font-mono font-medium leading-none">
                    {currentUser.usn} ({getYearLabel(currentUser.year)})
                  </span>
                </div>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
              </button>

              {showUserMenu && (
                <div className="absolute right-0 mt-2 w-64 bg-white border border-slate-200 rounded-xl shadow-xl py-2 z-50 animate-fade-in-up">
                  {/* Active User Header */}
                  <div className="px-4 py-2 border-b border-slate-100">
                    <p className="text-xs font-bold text-slate-800">{currentUser.name}</p>
                    <p className="text-[11px] font-mono text-indigo-700 font-semibold">{currentUser.usn}</p>
                    <p className="text-[11px] text-slate-500">
                      {getYearLabel(currentUser.year)} • Department of CSE
                    </p>
                  </div>

                  {/* Switch Active Year / Persona (For effortless testing by examiner/reviewer) */}
                  <div className="px-3 py-2 border-b border-slate-100">
                    <p className="text-[10px] uppercase font-bold tracking-wider text-slate-400 mb-1.5">
                      Switch Role (1-Click Test)
                    </p>
                    <div className="grid grid-cols-2 gap-1 text-[11px]">
                      {[1, 2, 3, 4].map(y => (
                        <button
                          key={y}
                          type="button"
                          onClick={() => {
                            switchUserByYear(y)
                            setShowUserMenu(false)
                          }}
                          className={`px-2 py-1 rounded text-left flex items-center justify-between transition-colors ${
                            currentUser.year === y
                              ? 'bg-[#1e3a5f] text-white font-semibold'
                              : 'hover:bg-slate-100 text-slate-700'
                          }`}
                        >
                          <span>{y}st Year</span>
                          {currentUser.year === y && <Check className="w-3 h-3 text-amber-400" />}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Profile Actions */}
                  <div className="py-1">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedProfileForView(currentUser)
                        setIsProfileModalOpen(true)
                        setShowUserMenu(false)
                      }}
                      className="w-full px-4 py-2 text-left text-xs text-slate-700 hover:bg-slate-50 flex items-center gap-2 font-medium"
                    >
                      <User className="w-3.5 h-3.5 text-slate-500" />
                      View & Edit Profile
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsAuthModalOpen(true)
                        setShowUserMenu(false)
                      }}
                      className="w-full px-4 py-2 text-left text-xs text-slate-700 hover:bg-slate-50 flex items-center gap-2 font-medium"
                    >
                      <GraduationCap className="w-3.5 h-3.5 text-slate-500" />
                      Sign Up with New USN
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        resetToDefaultData()
                        setShowUserMenu(false)
                      }}
                      className="w-full px-4 py-2 text-left text-xs text-amber-700 hover:bg-amber-50 flex items-center gap-2 font-medium border-t border-slate-100"
                    >
                      <RotateCcw className="w-3.5 h-3.5 text-amber-600" />
                      Reset to Fresh Demo Data
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </header>
  )
}
