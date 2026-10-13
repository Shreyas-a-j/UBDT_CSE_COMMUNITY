'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { LayoutDashboard, Megaphone, Calendar, Loader2 } from 'lucide-react'
import { Event, Announcement } from '@/lib/types'
import { createClient } from '@/lib/supabase/client'
import AppShell from '@/components/AppShell'
import LoadingSkeleton from '@/components/LoadingSkeleton'
import EmptyState from '@/components/EmptyState'
import { useAuth } from '@/contexts/AuthContext'
import { canPublishFacultyContent } from '@/lib/profile'
import { formatDate, formatEventDateTime } from '@/lib/utils'
import { useRouter } from 'next/navigation'
import toast from 'react-hot-toast'

function FacultyDashboard() {
  const router = useRouter()
  const supabase = createClient()
  const { profile: currentUser } = useAuth()
  const [myEvents, setMyEvents] = useState<Event[]>([])
  const [myAnnouncements, setMyAnnouncements] = useState<Announcement[]>([])
  const [loading, setLoading] = useState(true)

  const fetchMyContent = useCallback(async () => {
    if (!currentUser) return
    setLoading(true)

    const { data: eventsData } = await supabase
      .from('events')
      .select('*')
      .eq('host_id', currentUser.id)
      .order('event_date', { ascending: false })
      .limit(10)

    if (eventsData) setMyEvents(eventsData as Event[])

    const { data: announcementsData } = await supabase
      .from('announcements')
      .select('*')
      .eq('author_id', currentUser.id)
      .order('created_at', { ascending: false })
      .limit(10)

    if (announcementsData) setMyAnnouncements(announcementsData as Announcement[])

    setLoading(false)
  }, [currentUser, supabase])

  useEffect(() => {
    if (currentUser) {
      if (!canPublishFacultyContent(currentUser)) {
        toast.error('Access denied: Faculty verification required')
        router.push('/faculty')
        return
      }
      queueMicrotask(() => fetchMyContent())
    }
  }, [currentUser, fetchMyContent, router])

  const handleDeleteAnnouncement = async (id: string) => {
    if (!confirm('Delete this announcement?')) return
    const { error } = await supabase.from('announcements').delete().eq('id', id)
    if (error) {
      toast.error(error.message)
    } else {
      toast.success('Announcement deleted')
      fetchMyContent()
    }
  }

  if (!currentUser || !canPublishFacultyContent(currentUser)) {
    return null
  }

  return (
    <AppShell>
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: 20 }}>
        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <LayoutDashboard style={{ width: 28, height: 28, color: '#ffe066' }} />
            <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: '#e8f4fd', margin: 0 }}>
              FACULTY DASHBOARD
            </h1>
          </div>
          <p style={{ fontSize: '0.875rem', color: '#6bafd4', margin: 0 }}>
            Manage your announcements and events
          </p>
        </div>

        {loading ? (
          <LoadingSkeleton rows={3} />
        ) : (
          <div style={{ display: 'grid', gap: 24 }}>
            {/* Quick Actions */}
            <div
              style={{
                background: '#0d1426',
                border: '2px solid #1e3560',
                padding: 20,
                boxShadow: '4px 4px 0px #000',
              }}
            >
              <h2
                style={{
                  fontSize: '1rem',
                  fontWeight: 700,
                  color: '#ffe066',
                  marginBottom: 16,
                  textTransform: 'uppercase',
                }}
              >
                Quick Actions
              </h2>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <Link
                  href="/faculty/announcements/create"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '10px 16px',
                    background: '#ffe066',
                    color: '#060a14',
                    border: '2px solid #ccb300',
                    fontSize: '0.875rem',
                    fontWeight: 700,
                    textDecoration: 'none',
                    boxShadow: '3px 3px 0px #665500',
                  }}
                >
                  <Megaphone style={{ width: 16, height: 16 }} />
                  NEW ANNOUNCEMENT
                </Link>
                <button
                  onClick={() => {
                    // Trigger create event modal from context
                    toast('Event creation coming soon')
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '10px 16px',
                    background: '#00aaff',
                    color: '#060a14',
                    border: '2px solid #0088cc',
                    fontSize: '0.875rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    boxShadow: '3px 3px 0px #003366',
                  }}
                >
                  <Calendar style={{ width: 16, height: 16 }} />
                  NEW EVENT
                </button>
              </div>
            </div>

            {/* Recent Announcements */}
            <div
              style={{
                background: '#0d1426',
                border: '2px solid #1e3560',
                padding: 20,
                boxShadow: '4px 4px 0px #000',
              }}
            >
              <h2
                style={{
                  fontSize: '1rem',
                  fontWeight: 700,
                  color: '#ffe066',
                  marginBottom: 16,
                  textTransform: 'uppercase',
                }}
              >
                My Announcements ({myAnnouncements.length})
              </h2>
              {myAnnouncements.length === 0 ? (
                <EmptyState
                  icon={<Megaphone style={{ width: 36, height: 36, color: '#ffe066' }} />}
                  title="No announcements yet"
                  body="Create your first announcement to reach students"
                />
              ) : (
                <div style={{ display: 'grid', gap: 12 }}>
                  {myAnnouncements.map(announcement => (
                    <div
                      key={announcement.id}
                      style={{
                        background: '#060a14',
                        border: '2px solid #1e3560',
                        padding: 16,
                      }}
                    >
                      <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#e8f4fd', marginBottom: 8 }}>
                        {announcement.title}
                      </h3>
                      <p
                        style={{
                          fontSize: '0.875rem',
                          color: '#a8d4f0',
                          marginBottom: 12,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                        }}
                      >
                        {announcement.body}
                      </p>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          fontSize: '0.75rem',
                          color: '#6bafd4',
                        }}
                      >
                        <span>Posted {formatDate(announcement.created_at)}</span>
                        <button
                          onClick={() => handleDeleteAnnouncement(announcement.id)}
                          style={{
                            padding: '6px 12px',
                            background: 'transparent',
                            color: '#ff6688',
                            border: '1px solid #ff6688',
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          DELETE
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Recent Events */}
            <div
              style={{
                background: '#0d1426',
                border: '2px solid #1e3560',
                padding: 20,
                boxShadow: '4px 4px 0px #000',
              }}
            >
              <h2
                style={{
                  fontSize: '1rem',
                  fontWeight: 700,
                  color: '#ffe066',
                  marginBottom: 16,
                  textTransform: 'uppercase',
                }}
              >
                My Events ({myEvents.length})
              </h2>
              {myEvents.length === 0 ? (
                <EmptyState
                  icon={<Calendar style={{ width: 36, height: 36, color: '#00aaff' }} />}
                  title="No events yet"
                  body="Create events to organize workshops and sessions"
                />
              ) : (
                <div style={{ display: 'grid', gap: 12 }}>
                  {myEvents.map(event => (
                    <div
                      key={event.id}
                      style={{
                        background: '#060a14',
                        border: '2px solid #1e3560',
                        padding: 16,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div style={{ flex: 1 }}>
                          <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#e8f4fd', marginBottom: 4 }}>
                            {event.title}
                          </h3>
                          <div style={{ fontSize: '0.8rem', color: '#00aaff', marginBottom: 8 }}>
                            {formatEventDateTime(event.event_date, event.event_time)}
                          </div>
                          <div style={{ fontSize: '0.75rem', color: '#6bafd4' }}>
                            {event.type} • {event.duration} minutes
                          </div>
                        </div>
                        <span
                          style={{
                            fontSize: '0.7rem',
                            background: 'rgba(255,224,102,0.15)',
                            color: '#ffe066',
                            padding: '4px 8px',
                            border: '1px solid rgba(255,224,102,0.3)',
                            fontWeight: 700,
                          }}
                        >
                          {event.rsvp_count || 0} RSVPs
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  )
}

export default function FacultyDashboardPage() {
  return (
    <Suspense
      fallback={
        <AppShell>
          <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
            <Loader2 style={{ width: 48, height: 48, color: '#ffe066' }} className="animate-spin" />
          </div>
        </AppShell>
      }
    >
      <FacultyDashboard />
    </Suspense>
  )
}
