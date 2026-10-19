'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Check, Clock, Loader2, MessageSquare, UserCheck, UserPlus, Users, X } from 'lucide-react'
import { ConnectionRequest, Profile } from '@/lib/types'
import { createClient } from '@/lib/supabase/client'
import AppShell from '@/components/AppShell'
import PageHeader from '@/components/PageHeader'
import UserAvatar from '@/components/UserAvatar'
import LoadingSkeleton from '@/components/LoadingSkeleton'
import EmptyState from '@/components/EmptyState'
import { useAuth } from '@/contexts/AuthContext'
import { displayName } from '@/lib/profile'
import { getYearLabel, formatRelativeTime } from '@/lib/utils'
import toast from 'react-hot-toast'

type Tab = 'connections' | 'received' | 'sent'

const TABS: Array<{ key: Tab; label: string; icon: typeof UserCheck }> = [
  { key: 'connections', label: 'Connections', icon: UserCheck },
  { key: 'received', label: 'Received', icon: UserPlus },
  { key: 'sent', label: 'Sent', icon: Clock },
]

function RowShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="card-hover card flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:gap-5">
      {children}
    </div>
  )
}

function PersonIdentity({ person }: { person: Profile }) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3.5">
      <Link href={`/people/${person.id}`} className="shrink-0" tabIndex={-1} aria-hidden>
        <UserAvatar src={person.avatar_url} name={displayName(person)} size={48} />
      </Link>
      <div className="min-w-0">
        <Link
          href={`/people/${person.id}`}
          className="block truncate text-[14.5px] font-semibold text-ink transition-colors hover:text-accent-hover"
        >
          {displayName(person)}
        </Link>
        <p className="mt-0.5 truncate text-[11px] text-dim">
          {person.usn ? `${person.usn} · ` : ''}
          {getYearLabel(person.year)}
        </p>
      </div>
    </div>
  )
}

function ConnectionsManager() {
  const supabase = createClient()
  const { profile: currentUser } = useAuth()
  const [activeTab, setActiveTab] = useState<Tab>('connections')
  const [connections, setConnections] = useState<Profile[]>([])
  const [receivedRequests, setReceivedRequests] = useState<ConnectionRequest[]>([])
  const [sentRequests, setSentRequests] = useState<ConnectionRequest[]>([])
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    if (!currentUser) {
      setLoading(false)
      return
    }
    setLoading(true)

    // Fetch accepted connections
    const { data: connData } = await supabase
      .from('connection_requests')
      .select(`
        *,
        requester:profiles!requester_id(*),
        addressee:profiles!addressee_id(*)
      `)
      .eq('status', 'accepted')
      .or(`requester_id.eq.${currentUser.id},addressee_id.eq.${currentUser.id}`)

    if (connData) {
      const connProfiles = connData.map(req => {
        const isRequester = req.requester_id === currentUser.id
        return isRequester ? req.addressee : req.requester
      }) as Profile[]
      setConnections(connProfiles)
    }

    // Fetch received pending requests
    const { data: receivedData } = await supabase
      .from('connection_requests')
      .select(`
        *,
        requester:profiles!requester_id(*)
      `)
      .eq('addressee_id', currentUser.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })

    if (receivedData) {
      setReceivedRequests(receivedData as ConnectionRequest[])
    }

    // Fetch sent pending requests
    const { data: sentData } = await supabase
      .from('connection_requests')
      .select(`
        *,
        addressee:profiles!addressee_id(*)
      `)
      .eq('requester_id', currentUser.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })

    if (sentData) {
      setSentRequests(sentData as ConnectionRequest[])
    }

    setLoading(false)
  }, [currentUser, supabase])

  useEffect(() => {
    queueMicrotask(() => fetchData())
  }, [fetchData])

  const handleAccept = async (requestId: string) => {
    const { error } = await supabase
      .from('connection_requests')
      .update({ status: 'accepted' })
      .eq('id', requestId)
    if (error) {
      toast.error(error.message)
    } else {
      toast.success('Connection request accepted')
      fetchData()
    }
  }

  const handleReject = async (requestId: string) => {
    const { error } = await supabase
      .from('connection_requests')
      .update({ status: 'rejected' })
      .eq('id', requestId)
    if (error) {
      toast.error(error.message)
    } else {
      toast.success('Connection request rejected')
      fetchData()
    }
  }

  const handleCancel = async (requestId: string) => {
    const { error } = await supabase
      .from('connection_requests')
      .update({ status: 'cancelled' })
      .eq('id', requestId)
    if (error) {
      toast.error(error.message)
    } else {
      toast.success('Connection request cancelled')
      fetchData()
    }
  }

  const counts: Record<Tab, number> = {
    connections: connections.length,
    received: receivedRequests.length,
    sent: sentRequests.length,
  }

  return (
    <div className="mx-auto w-full max-w-4xl">
      <PageHeader
        eyebrow="Your network"
        title="Connections"
        description="Manage the people you have connected with, and the requests waiting on either side."
      />

      {/* Tabs */}
      <div
        role="tablist"
        aria-label="Connection views"
        className="mb-5 flex gap-1 overflow-x-auto border-b border-line"
      >
        {TABS.map(tab => {
          const active = activeTab === tab.key
          const Icon = tab.icon
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setActiveTab(tab.key)}
              className={`relative -mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-3 text-[12.5px] font-medium transition-colors sm:gap-2 sm:px-4 sm:text-[13px] ${
                active
                  ? 'border-accent text-ink'
                  : 'border-transparent text-muted hover:text-ink'
              }`}
            >
              <Icon className="hidden h-4 w-4 sm:block" aria-hidden />
              {tab.label}
              <span
                className={`rounded px-1.5 py-0.5 text-[10.5px] tabular-nums ${
                  active
                    ? 'bg-accent-soft text-accent-hover'
                    : 'bg-elevated text-dim'
                }`}
              >
                {counts[tab.key]}
              </span>
            </button>
          )
        })}
      </div>

      {loading ? (
        <LoadingSkeleton rows={3} />
      ) : (
        <>
          {activeTab === 'connections' && (
            <>
              {connections.length === 0 ? (
                <EmptyState
                  icon={<UserCheck className="h-6 w-6" />}
                  title="No connections yet"
                  body="Start connecting with students in the directory. Accepted requests appear here."
                  action={
                    <Link href="/people" className="btn btn-accent">
                      <Users className="h-4 w-4" /> Browse students
                    </Link>
                  }
                />
              ) : (
                <ul className="flex flex-col gap-3">
                  {connections.map(person => (
                    <li key={person.id}>
                      <RowShell>
                        <PersonIdentity person={person} />
                        <Link
                          href="/messages"
                          className="btn btn-outline btn-sm w-full sm:w-auto"
                        >
                          <MessageSquare className="h-3.5 w-3.5" /> Message
                        </Link>
                      </RowShell>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {activeTab === 'received' && (
            <>
              {receivedRequests.length === 0 ? (
                <EmptyState
                  icon={<UserPlus className="h-6 w-6" />}
                  title="No pending requests"
                  body="When someone asks to connect with you, their request will show up here."
                />
              ) : (
                <ul className="flex flex-col gap-3">
                  {receivedRequests.map(request => {
                    const requester = request.requester
                    if (!requester) return null
                    return (
                      <li key={request.id}>
                        <RowShell>
                          <PersonIdentity person={requester} />
                          <div className="flex shrink-0 flex-col gap-2 sm:items-end">
                            <span className="inline-flex items-center gap-1.5 text-[10.5px] text-dim">
                              <Clock className="h-3 w-3" />
                              {formatRelativeTime(request.created_at)}
                            </span>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => handleReject(request.id)}
                                className="btn btn-danger btn-sm"
                              >
                                <X className="h-3.5 w-3.5" /> Decline
                              </button>
                              <button
                                type="button"
                                onClick={() => handleAccept(request.id)}
                                className="btn btn-accent btn-sm"
                              >
                                <Check className="h-3.5 w-3.5" /> Accept
                              </button>
                            </div>
                          </div>
                        </RowShell>
                      </li>
                    )
                  })}
                </ul>
              )}
            </>
          )}

          {activeTab === 'sent' && (
            <>
              {sentRequests.length === 0 ? (
                <EmptyState
                  icon={<Clock className="h-6 w-6" />}
                  title="No pending requests"
                  body="Connection requests you send will wait here until they are answered."
                />
              ) : (
                <ul className="flex flex-col gap-3">
                  {sentRequests.map(request => {
                    const addressee = request.addressee
                    if (!addressee) return null
                    return (
                      <li key={request.id}>
                        <RowShell>
                          <PersonIdentity person={addressee} />
                          <div className="flex shrink-0 flex-col gap-2 sm:items-end">
                            <span className="chip chip-warn">
                              <Clock className="h-3 w-3" />
                              Pending · {formatRelativeTime(request.created_at)}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleCancel(request.id)}
                              className="btn btn-ghost btn-sm self-start sm:self-auto"
                            >
                              Cancel request
                            </button>
                          </div>
                        </RowShell>
                      </li>
                    )
                  })}
                </ul>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}

export default function ConnectionsPage() {
  return (
    <AppShell>
      <Suspense
        fallback={
          <div className="mx-auto flex w-full max-w-4xl justify-center py-24">
            <Loader2 className="h-6 w-6 animate-spin text-dim" />
          </div>
        }
      >
        <ConnectionsManager />
      </Suspense>
    </AppShell>
  )
}
