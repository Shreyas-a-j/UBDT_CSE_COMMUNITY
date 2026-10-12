'use client'

import React, { useState, useEffect } from 'react'
import {
  Calendar,
  Clock,
  Sparkles,
  ArrowBigUp,
  ShieldCheck,
  ChevronRight,
  ExternalLink,
} from 'lucide-react'
import { useCommunity } from '@/contexts/CommunityContext'
import { formatEventDateTime, getCountdown } from '@/lib/utils'

export default function SidebarRight() {
  const { events, posts, setFeedFilter, toggleRsvpEvent, rsvpedEventIds } = useCommunity()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  // Upcoming top 3 events
  const upcomingEvents = events.slice(0, 3)

  // Top 3 showcases sorted by upvotes
  const topShowcases = posts
    .filter(p => p.type === 'showcase')
    .sort((a, b) => (b.upvote_count ?? 0) - (a.upvote_count ?? 0))
    .slice(0, 3)

  return (
    <aside className="space-y-4">
      {/* Upcoming Events Box */}
      <div className="card p-4 bg-white">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-bold text-slate-800 flex items-center gap-1.5 uppercase tracking-wide">
            <Calendar className="w-3.5 h-3.5 text-indigo-600" />
            Upcoming Events
          </h3>
          <button
            type="button"
            onClick={() => setFeedFilter('events')}
            className="text-[11px] font-semibold text-[#1e3a5f] hover:underline flex items-center"
          >
            See all <ChevronRight className="w-3 h-3" />
          </button>
        </div>

        <div className="space-y-3">
          {upcomingEvents.length === 0 ? (
            <p className="text-xs text-slate-400 italic py-1 text-center">
              No upcoming events yet.
            </p>
          ) : (
            upcomingEvents.map(evt => {
              const isRsvped = rsvpedEventIds.has(evt.id)
              const countdown = mounted ? getCountdown(evt.event_date, evt.event_time) : ''

              return (
                <div
                  key={evt.id}
                  className="p-2.5 rounded-lg border border-slate-100 hover:border-slate-200 bg-slate-50/50 hover:bg-slate-50 transition-all text-xs"
                >
                  <div className="flex items-center justify-between gap-1 mb-1">
                    <span
                      className={`text-[9px] font-bold px-1.5 py-0.2 rounded uppercase ${
                        evt.type === 'Workshop'
                          ? 'bg-indigo-100 text-indigo-700'
                          : evt.type === 'Meeting'
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {evt.type}
                    </span>
                    {countdown && countdown !== 'Event ended' && (
                      <span className="text-[10px] font-mono font-semibold text-amber-700">
                        {countdown}
                      </span>
                    )}
                  </div>

                  <h4 className="font-bold text-slate-900 line-clamp-1 mb-1 leading-snug">
                    {evt.title}
                  </h4>

                  <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1">
                    <span>{evt.event_time} • {evt.rsvp_count ?? 0} going</span>
                    <button
                      type="button"
                      onClick={() => toggleRsvpEvent(evt.id)}
                      className={`text-[10px] font-bold px-2 py-0.5 rounded transition-all ${
                        isRsvped
                          ? 'bg-emerald-600 text-white'
                          : 'bg-[#1e3a5f] text-white hover:bg-[#152e4d]'
                      }`}
                    >
                      {isRsvped ? 'Going ✓' : 'RSVP'}
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Top Showcases Box */}
      <div className="card p-4 bg-white">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-bold text-slate-800 flex items-center gap-1.5 uppercase tracking-wide">
            <Sparkles className="w-3.5 h-3.5 text-amber-600" />
            Top Showcases
          </h3>
          <button
            type="button"
            onClick={() => setFeedFilter('showcases')}
            className="text-[11px] font-semibold text-amber-700 hover:underline flex items-center"
          >
            Explore <ChevronRight className="w-3 h-3" />
          </button>
        </div>

        <div className="space-y-2.5">
          {topShowcases.length === 0 ? (
            <p className="text-xs text-slate-400 italic py-1 text-center">
              No project showcases yet.
            </p>
          ) : (
            topShowcases.map(proj => (
              <div
                key={proj.id}
                className="p-2.5 rounded-lg border border-slate-100 hover:border-amber-200 bg-amber-50/20 hover:bg-amber-50/50 transition-all text-xs"
              >
                <div className="flex items-center justify-between gap-1 mb-1">
                  <span className="font-bold text-slate-900 line-clamp-1 leading-snug">
                    {proj.title}
                  </span>
                  <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-amber-700 bg-amber-100 px-1.5 py-0.2 rounded shrink-0">
                    <ArrowBigUp className="w-3 h-3 fill-amber-700" />
                    {proj.upvote_count ?? 0}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 line-clamp-2 leading-relaxed">
                  {proj.body}
                </p>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Community Etiquette & Guidelines */}
      <div className="card p-4 bg-white text-xs text-slate-600">
        <div className="flex items-center gap-1.5 font-bold text-slate-800 mb-2">
          <ShieldCheck className="w-4 h-4 text-emerald-600" />
          <span>CSE Community Guidelines</span>
        </div>
        <ul className="space-y-1.5 text-[11px] text-slate-500 leading-relaxed list-disc list-inside">
          <li>Help juniors and seniors with constructive feedback.</li>
          <li>Share GitHub repos and demo links for VTU projects.</li>
          <li>Keep virtual meet links free for all verified students.</li>
          <li>Practice academic honesty and open collaboration.</li>
        </ul>
      </div>
    </aside>
  )
}
