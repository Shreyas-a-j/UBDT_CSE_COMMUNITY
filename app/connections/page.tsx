'use client'

import { Suspense, useState } from 'react'
import Link from 'next/link'
import { Users, UserCheck, UserPlus, Clock, X, Check, Loader2 } from 'lucide-react'
import { ConnectionRequest, Profile } from '@/lib/types'
import { createClient } from '@/lib/supabase/client'
import AppShell from '@/components/AppShell'
import UserAvatar from '@/components/UserAvatar'
import LoadingSkeleton from '@/components/LoadingSkeleton'
import EmptyState from '@/components/EmptyState'
import { useAuth } from '@/contexts/AuthContext'
import { displayName } from '@/lib/profile'
import { getYearLabel, formatRelativeTime } from '@/lib/utils'
import toast from 'react-hot-toast'

type Tab = 'connections' | 'received' | 'sent'

function ConnectionsManager() {
  const supabase = createClient()
  const { profile: currentUser } = useAuth()
  const [activeTab, setActiveTab] = useState<Tab>('connections')
  const [connections, setConnections] = useState<Profile[]>([])
  const [receivedRequests, setReceivedRequests] = useState<ConnectionRequest[]>([])
  const [sentRequests, setSentRequests] = useState<ConnectionRequest[]>([])
  const [loading, setLoading] = useState(true)

  const fetchData = async () => {
    if (!currentUser) return
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
  }

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

  return (
    <AppShell>
      <div style={{ maxWidth: 1000, margin: '0 auto', padding: 20 }}>
        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <Users style={{ width: 28, height: 28, color: '#00aaff' }} />
            <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: '#e8f4fd', margin: 0 }}>
              MY CONNECTIONS
            </h1>
          </div>
          <p style={{ fontSize: '0.875rem', color: '#6bafd4', margin: 0 }}>
            Manage your network and connection requests
          </p>
        </div>

        {/* Tabs */}
        <div
          style={{
            display: 'flex',
            gap: 8,
            marginBottom: 24,
            borderBottom: '2px solid #1e3560',
            paddingBottom: 0,
          }}
        >
          {[
            { key: 'connections', label: 'Connections', count: connections.length, icon: UserCheck },
            { key: 'received', label: 'Received', count: receivedRequests.length, icon: UserPlus },
            { key: 'sent', label: 'Sent', count: sentRequests.length, icon: Clock },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as Tab)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '12px 20px',
                background: activeTab === tab.key ? '#00aaff' : 'transparent',
                color: activeTab === tab.key ? '#060a14' : '#a8d4f0',
                borderTop: '2px solid',
                borderTopColor: activeTab === tab.key ? '#0088cc' : '#1e3560',
                borderRight: '2px solid',
                borderRightColor: activeTab === tab.key ? '#0088cc' : '#1e3560',
                borderLeft: '2px solid',
                borderLeftColor: activeTab === tab.key ? '#0088cc' : '#1e3560',
                borderBottom: '2px solid transparent',
                fontSize: '0.875rem',
                fontWeight: 700,
                cursor: 'pointer',
                position: 'relative',
                top: '2px',
                boxShadow: activeTab === tab.key ? '3px 0px 0px #003366' : 'none',
              }}
            >
              <tab.icon style={{ width: 16, height: 16 }} />
              {tab.label}
              {tab.count > 0 && (
                <span
                  style={{
                    fontSize: '0.7rem',
                    background: activeTab === tab.key ? '#060a14' : '#1e3560',
                    color: activeTab === tab.key ? '#00aaff' : '#e8f4fd',
                    padding: '2px 6px',
                    fontWeight: 700,
                    minWidth: 20,
                    textAlign: 'center',
                  }}
                >
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Content */}
        {loading ? (
          <LoadingSkeleton rows={3} />
        ) : (
          <>
            {/* Connections Tab */}
            {activeTab === 'connections' && (
              <>
                {connections.length === 0 ? (
                  <EmptyState
                    icon={<UserCheck style={{ width: 48, height: 48, color: '#00aaff' }} />}
                    title="No connections yet"
                    body="Start connecting with students in the directory"
                    action={
                      <Link
                        href="/people"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 8,
                          padding: '10px 16px',
                          background: '#00aaff',
                          color: '#060a14',
                          border: '2px solid #0088cc',
                          fontSize: '0.875rem',
                          fontWeight: 700,
                          textDecoration: 'none',
                          boxShadow: '3px 3px 0px #003366',
                        }}
                      >
                        <Users style={{ width: 16, height: 16 }} />
                        BROWSE STUDENTS
                      </Link>
                    }
                  />
                ) : (
                  <div style={{ display: 'grid', gap: 12 }}>
                    {connections.map(person => (
                      <div
                        key={person.id}
                        style={{
                          background: '#0d1426',
                          border: '2px solid #1e3560',
                          padding: 16,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 16,
                          boxShadow: '3px 3px 0px #000',
                        }}
                      >
                        <Link href={`/people/${person.id}`}>
                          <UserAvatar src={person.avatar_url} name={displayName(person)} size={56} />
                        </Link>
                        <div style={{ flex: 1 }}>
                          <Link
                            href={`/people/${person.id}`}
                            style={{
                              fontSize: '1rem',
                              fontWeight: 700,
                              color: '#e8f4fd',
                              textDecoration: 'none',
                              display: 'block',
                              marginBottom: 4,
                            }}
                          >
                            {displayName(person)}
                          </Link>
                          <div style={{ display: 'flex', gap: 8, fontSize: '0.8rem', color: '#6bafd4' }}>
                            {person.usn && <span>{person.usn}</span>}
                            <span>•</span>
                            <span>{getYearLabel(person.year)}</span>
                          </div>
                        </div>
                        <Link
                          href={`/messages`}
                          style={{
                            padding: '8px 14px',
                            background: '#00ffcc',
                            color: '#060a14',
                            border: '2px solid #00ccaa',
                            fontSize: '0.8rem',
                            fontWeight: 700,
                            textDecoration: 'none',
                            boxShadow: '2px 2px 0px #006655',
                          }}
                        >
                          MESSAGE
                        </Link>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {/* Received Requests Tab */}
            {activeTab === 'received' && (
              <>
                {receivedRequests.length === 0 ? (
                  <EmptyState
                    icon={<UserPlus style={{ width: 48, height: 48, color: '#00aaff' }} />}
                    title="No pending requests"
                    body="You'll see connection requests here"
                  />
                ) : (
                  <div style={{ display: 'grid', gap: 12 }}>
                    {receivedRequests.map(request => {
                      const requester = request.requester
                      if (!requester) return null
                      return (
                        <div
                          key={request.id}
                          style={{
                            background: '#0d1426',
                            border: '2px solid #1e3560',
                            padding: 16,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 16,
                            boxShadow: '3px 3px 0px #000',
                          }}
                        >
                          <Link href={`/people/${requester.id}`}>
                            <UserAvatar src={requester.avatar_url} name={displayName(requester)} size={56} />
                          </Link>
                          <div style={{ flex: 1 }}>
                            <Link
                              href={`/people/${requester.id}`}
                              style={{
                                fontSize: '1rem',
                                fontWeight: 700,
                                color: '#e8f4fd',
                                textDecoration: 'none',
                                display: 'block',
                                marginBottom: 4,
                              }}
                            >
                              {displayName(requester)}
                            </Link>
                            <div style={{ fontSize: '0.75rem', color: '#6bafd4', marginBottom: 4 }}>
                              {requester.usn} • {getYearLabel(requester.year)}
                            </div>
                            <div style={{ fontSize: '0.75rem', color: '#6bafd4' }}>
                              {formatRelativeTime(request.created_at)}
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button
                              onClick={() => handleAccept(request.id)}
                              style={{
                                padding: '8px 14px',
                                background: '#00ffcc',
                                color: '#060a14',
                                border: '2px solid #00ccaa',
                                fontSize: '0.8rem',
                                fontWeight: 700,
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                boxShadow: '2px 2px 0px #006655',
                              }}
                            >
                              <Check style={{ width: 14, height: 14 }} />
                              ACCEPT
                            </button>
                            <button
                              onClick={() => handleReject(request.id)}
                              style={{
                                padding: '8px 14px',
                                background: 'transparent',
                                color: '#ff6688',
                                borderTop: '2px solid #ff6688',
                                borderRight: '2px solid #ff6688',
                                borderLeft: '2px solid #ff6688',
                                borderBottom: '2px solid transparent',
                                fontSize: '0.8rem',
                                fontWeight: 700,
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                boxShadow: '2px 2px 0px #661133',
                              }}
                            >
                              <X style={{ width: 14, height: 14 }} />
                              REJECT
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </>
            )}

            {/* Sent Requests Tab */}
            {activeTab === 'sent' && (
              <>
                {sentRequests.length === 0 ? (
                  <EmptyState
                    icon={<Clock style={{ width: 48, height: 48, color: '#00aaff' }} />}
                    title="No pending requests"
                    body="Connection requests you send will appear here"
                  />
                ) : (
                  <div style={{ display: 'grid', gap: 12 }}>
                    {sentRequests.map(request => {
                      const addressee = request.addressee
                      if (!addressee) return null
                      return (
                        <div
                          key={request.id}
                          style={{
                            background: '#0d1426',
                            border: '2px solid #1e3560',
                            padding: 16,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 16,
                            boxShadow: '3px 3px 0px #000',
                          }}
                        >
                          <Link href={`/people/${addressee.id}`}>
                            <UserAvatar src={addressee.avatar_url} name={displayName(addressee)} size={56} />
                          </Link>
                          <div style={{ flex: 1 }}>
                            <Link
                              href={`/people/${addressee.id}`}
                              style={{
                                fontSize: '1rem',
                                fontWeight: 700,
                                color: '#e8f4fd',
                                textDecoration: 'none',
                                display: 'block',
                                marginBottom: 4,
                              }}
                            >
                              {displayName(addressee)}
                            </Link>
                            <div style={{ fontSize: '0.75rem', color: '#6bafd4', marginBottom: 4 }}>
                              {addressee.usn} • {getYearLabel(addressee.year)}
                            </div>
                            <div
                              style={{
                                fontSize: '0.75rem',
                                color: '#ffe066',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 4,
                              }}
                            >
                              <Clock style={{ width: 12, height: 12 }} />
                              Pending • {formatRelativeTime(request.created_at)}
                            </div>
                          </div>
                          <button
                            onClick={() => handleCancel(request.id)}
                            style={{
                              padding: '8px 14px',
                              background: 'transparent',
                              color: '#6bafd4',
                              borderTop: '2px solid #1e3560',
                              borderRight: '2px solid #1e3560',
                              borderLeft: '2px solid #1e3560',
                              borderBottom: '2px solid transparent',
                              fontSize: '0.8rem',
                              fontWeight: 700,
                              cursor: 'pointer',
                              boxShadow: '2px 2px 0px #000',
                            }}
                          >
                            CANCEL
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </AppShell>
  )
}

export default function ConnectionsPage() {
  return (
    <Suspense
      fallback={
        <AppShell>
          <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
            <Loader2 style={{ width: 48, height: 48, color: '#00aaff' }} className="animate-spin" />
          </div>
        </AppShell>
      }
    >
      <ConnectionsManager />
    </Suspense>
  )
}
