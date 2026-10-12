'use client'

import React, { useState, useEffect } from 'react'
import { Calendar, Clock, Sparkles, ArrowBigUp, ShieldCheck, ChevronRight } from 'lucide-react'
import { useCommunity } from '@/contexts/CommunityContext'
import { getCountdown } from '@/lib/utils'

export default function SidebarRight() {
  const { events, posts, setFeedFilter, toggleRsvpEvent, rsvpedEventIds } = useCommunity()
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  const upcomingEvents = events.slice(0, 3)
  const topShowcases = posts
    .filter(p => p.type === 'showcase')
    .sort((a, b) => (b.upvote_count ?? 0) - (a.upvote_count ?? 0))
    .slice(0, 3)

  return (
    <aside style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Upcoming Events */}
      <div style={{ background: '#0d1426', border: '2px solid #1e3560', padding: '14px', boxShadow: '4px 4px 0px #000' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, borderBottom: '2px solid #1e3560', paddingBottom: 8 }}>
          <h3 style={{ fontSize: '0.75rem', color: '#e8f4fd', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
            <Calendar style={{ width: 14, height: 14, color: '#00ffcc' }} /> UPCOMING EVENTS
          </h3>
          <button type="button" onClick={() => setFeedFilter('events')} style={{ fontSize: '0.7rem', color: '#00aaff', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', display: 'flex', alignItems: 'center', fontWeight: 600 }}>
            ALL <ChevronRight style={{ width: 12, height: 12 }} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {upcomingEvents.length === 0 ? (
            <p style={{ fontSize: '0.75rem', color: '#3d6b8a', textAlign: 'center', padding: '10px 0' }}>NO UPCOMING EVENTS</p>
          ) : (
            upcomingEvents.map(evt => {
              const isRsvped = rsvpedEventIds.has(evt.id)
              const countdown = mounted ? getCountdown(evt.event_date, evt.event_time) : ''
              return (
                <div key={evt.id} style={{ background: '#0c1220', border: '2px solid #1e3560', padding: '10px', boxShadow: '2px 2px 0px #000' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{
                      fontSize: '0.68rem', fontWeight: 700, padding: '2px 6px',
                      background: evt.type === 'Workshop' ? 'rgba(170,102,255,0.15)' : evt.type === 'Meeting' ? 'rgba(0,255,204,0.12)' : 'rgba(255,224,102,0.12)',
                      color: evt.type === 'Workshop' ? '#cc99ff' : evt.type === 'Meeting' ? '#00ffcc' : '#ffe066',
                      border: `2px solid ${evt.type === 'Workshop' ? 'rgba(170,102,255,0.35)' : evt.type === 'Meeting' ? 'rgba(0,255,204,0.35)' : 'rgba(255,224,102,0.35)'}`,
                      textTransform: 'uppercase',
                    }}>
                      {evt.type}
                    </span>
                    {countdown && countdown !== 'Event ended' && (
                      <span style={{ fontSize: '0.7rem', color: '#ffe066', display: 'flex', alignItems: 'center', gap: 4, fontWeight: 600 }}>
                        <Clock style={{ width: 11, height: 11 }} />{countdown}
                      </span>
                    )}
                  </div>
                  <h4 style={{ fontSize: '0.8rem', color: '#e8f4fd', fontWeight: 600, marginBottom: 8, lineHeight: 1.4, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{evt.title}</h4>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '0.7rem', color: '#6bafd4' }}>{evt.event_time} • {evt.rsvp_count ?? 0} GOING</span>
                    <button
                      type="button"
                      onClick={() => toggleRsvpEvent(evt.id)}
                      style={{
                        fontSize: '0.7rem', fontWeight: 700, padding: '4px 10px', border: '2px solid', cursor: 'pointer',
                        background: isRsvped ? '#00ffcc' : '#00aaff',
                        color: '#060a14',
                        borderColor: isRsvped ? '#00ccaa' : '#0088cc',
                        boxShadow: isRsvped ? '2px 2px 0px #006655' : '2px 2px 0px #003366',
                        textTransform: 'uppercase',
                        letterSpacing: '0.02em',
                      }}
                    >
                      {isRsvped ? 'GOING ✓' : 'RSVP'}
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Top Showcases */}
      <div style={{ background: '#0d1426', border: '2px solid #1e3560', padding: '14px', boxShadow: '4px 4px 0px #000' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, borderBottom: '2px solid #1e3560', paddingBottom: 8 }}>
          <h3 style={{ fontSize: '0.75rem', color: '#e8f4fd', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
            <Sparkles style={{ width: 14, height: 14, color: '#ffe066' }} /> TOP SHOWCASES
          </h3>
          <button type="button" onClick={() => setFeedFilter('showcases')} style={{ fontSize: '0.7rem', color: '#ffe066', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', display: 'flex', alignItems: 'center', fontWeight: 600 }}>
            ALL <ChevronRight style={{ width: 12, height: 12 }} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {topShowcases.length === 0 ? (
            <p style={{ fontSize: '0.75rem', color: '#3d6b8a', textAlign: 'center', padding: '10px 0' }}>NO SHOWCASES YET</p>
          ) : (
            topShowcases.map(proj => (
              <div key={proj.id} style={{ background: '#0c1220', border: '2px solid #1e3560', padding: '10px', boxShadow: '2px 2px 0px #000' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: '0.8rem', color: '#e8f4fd', fontWeight: 700, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', flex: 1, marginRight: 8 }}>{proj.title}</span>
                  <span style={{ fontSize: '0.7rem', color: '#ffe066', background: 'rgba(255,224,102,0.12)', border: '2px solid rgba(255,224,102,0.35)', padding: '2px 6px', display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0, boxShadow: '2px 2px 0px #665500', fontWeight: 700 }}>
                    <ArrowBigUp style={{ width: 12, height: 12, fill: '#ffe066', color: '#ffe066' }} />
                    {proj.upvote_count ?? 0}
                  </span>
                </div>
                <p style={{ fontSize: '0.75rem', color: '#6bafd4', lineHeight: 1.5, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{proj.body}</p>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Community Guidelines */}
      <div style={{ background: '#0d1426', border: '2px solid #1e3560', padding: '14px', boxShadow: '4px 4px 0px #000' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, borderBottom: '2px solid #1e3560', paddingBottom: 8 }}>
          <ShieldCheck style={{ width: 14, height: 14, color: '#00ffcc' }} />
          <span style={{ fontSize: '0.75rem', color: '#e8f4fd', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em' }}>COMMUNITY RULES</span>
        </div>
        <ul style={{ display: 'flex', flexDirection: 'column', gap: 8, listStyle: 'none', padding: 0, margin: 0 }}>
          {[
            '▸ Help juniors with constructive feedback',
            '▸ Share GitHub repos for academic projects',
            '▸ Keep workshop links free for students',
            '▸ Practice academic honesty & peer collab',
          ].map((rule, i) => (
            <li key={i} style={{ fontSize: '0.75rem', color: '#a8d4f0', lineHeight: 1.5 }}>{rule}</li>
          ))}
        </ul>
      </div>
    </aside>
  )
}
