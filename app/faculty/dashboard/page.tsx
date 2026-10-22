'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Calendar, LayoutDashboard, Loader2, Megaphone, Plus } from 'lucide-react'
import { Event, Announcement } from '@/lib/types'
import { createClient } from '@/lib/supabase/client'
import AppShell from '@/components/AppShell'
import PageHeader from '@/components/PageHeader'
import LoadingSkeleton from '@/components/LoadingSkeleton'
import EmptyState from '@/components/EmptyState'
import CommunityActivityExport from '@/components/CommunityActivityExport'
import { useAuth } from '@/contexts/AuthContext'
import { useCommunity } from '@/contexts/CommunityContext'
import { canPublishFacultyContent } from '@/lib/profile'
import { formatDate, formatEventDateTime } from '@/lib/utils'
import toast from 'react-hot-toast'

function FacultyDashboard() {
  const router = useRouter()
  const supabase = createClient()
  const { profile: currentUser } = useAuth()
  const { openCreateEvent } = useCommunity()
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
    <div className="mx-auto w-full max-w-5xl">
      <PageHeader
        eyebrow="Faculty workspace"
        title="Dashboard"
        description="Publish announcements and keep track of the events you host."
        actions={
          <>
            <Link href="/faculty/announcements/create" className="btn btn-accent">
              <Megaphone className="h-4 w-4" /> New announcement
            </Link>
            <button
              type="button"
              onClick={openCreateEvent}
              className="btn btn-outline"
            >
              <Calendar className="h-4 w-4" /> New event
            </button>
          </>
        }
      />

      <div className="mb-5">
        <CommunityActivityExport />
      </div>

      {loading ? (
        <LoadingSkeleton rows={3} />
      ) : (
        <div className="grid items-start gap-5 lg:grid-cols-2">
          {/* Announcements */}
          <section className="card flex flex-col overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
              <h2 className="flex items-center gap-2 text-[14px] font-semibold text-ink">
                <Megaphone className="h-4 w-4 text-accent-text" />
                Announcements
              </h2>
              <div className="flex items-center gap-2">
                <Link
                  href="/announcements"
                  className="text-[11px] font-medium text-muted transition-colors hover:text-ink"
                >
                  Open channel
                </Link>
                <span className="chip text-[10.5px]">{myAnnouncements.length}</span>
              </div>
            </div>

            {myAnnouncements.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  icon={<Megaphone className="h-5 w-5" />}
                  title="No announcements yet"
                  body="Publish your first announcement to reach students in the community feed."
                  action={
                    <Link href="/faculty/announcements/create" className="btn btn-outline btn-sm">
                      <Plus className="h-3.5 w-3.5" /> Create announcement
                    </Link>
                  }
                />
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {myAnnouncements.map(announcement => (
                  <li key={announcement.id} className="p-5">
                    <h3 className="text-[14px] font-semibold text-ink">
                      {announcement.title}
                    </h3>
                    <p className="clamp-2 mt-1 text-[13px] leading-relaxed text-muted">
                      {announcement.body}
                    </p>
                    <div className="mt-2.5 flex items-center justify-between gap-3">
                      <span className="text-[10.5px] text-dim">
                        Posted {formatDate(announcement.created_at)}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleDeleteAnnouncement(announcement.id)}
                        className="btn btn-danger btn-sm"
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Events */}
          <section className="card flex flex-col overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
              <h2 className="flex items-center gap-2 text-[14px] font-semibold text-ink">
                <Calendar className="h-4 w-4 text-info" />
                Events
              </h2>
              <span className="chip text-[10.5px]">{myEvents.length}</span>
            </div>

            {myEvents.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  icon={<Calendar className="h-5 w-5" />}
                  title="No events yet"
                  body="Events you create will appear here with their RSVP counts."
                />
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {myEvents.map(event => (
                  <li key={event.id} className="p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="text-[14px] font-semibold text-ink">
                          {event.title}
                        </h3>
                        <p className="mt-1 text-[10.5px] text-info">
                          {formatEventDateTime(event.event_date, event.event_time)}
                        </p>
                        <p className="mt-1 text-[11.5px] capitalize text-dim">
                          {event.type} · {event.duration} minutes
                        </p>
                      </div>
                      <span className="chip shrink-0 text-[10.5px]">
                        {event.rsvp_count || 0} RSVPs
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      <p className="mt-6 flex items-center gap-1.5 text-[10.5px] text-dim">
        <LayoutDashboard className="h-3 w-3" />
        Only approved faculty and admins can publish content.
      </p>
    </div>
  )
}

export default function FacultyDashboardPage() {
  return (
    <AppShell>
      <Suspense
        fallback={
          <div className="mx-auto flex w-full max-w-5xl justify-center py-24">
            <Loader2 className="h-6 w-6 animate-spin text-dim" />
          </div>
        }
      >
        <FacultyDashboard />
      </Suspense>
    </AppShell>
  )
}
