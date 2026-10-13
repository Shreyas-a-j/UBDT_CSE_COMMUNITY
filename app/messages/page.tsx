'use client'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { MessageCircle, Loader2, Search, Send } from 'lucide-react'
import { Conversation } from '@/lib/types'
import { createClient } from '@/lib/supabase/client'
import AppShell from '@/components/AppShell'
import UserAvatar from '@/components/UserAvatar'
import LoadingSkeleton from '@/components/LoadingSkeleton'
import EmptyState from '@/components/EmptyState'
import { useAuth } from '@/contexts/AuthContext'
import { displayName } from '@/lib/profile'
import { formatRelativeTime } from '@/lib/utils'

function MessagesInbox() {
  const supabase = createClient()
  const { profile: currentUser } = useAuth()
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    if (currentUser) fetchConversations()
  }, [currentUser])

  useEffect(() => {
    if (!currentUser) return
    const channel = supabase
      .channel(`messages:${currentUser.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'messages' },
        () => {
          fetchConversations()
        }
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [currentUser])

  const fetchConversations = async () => {
    if (!currentUser) return
    setLoading(true)

    const { data: participantData } = await supabase
      .from('conversation_participants')
      .select('conversation_id, last_read_at')
      .eq('user_id', currentUser.id)

    if (!participantData || participantData.length === 0) {
      setConversations([])
      setLoading(false)
      return
    }

    const conversationIds = participantData.map(p => p.conversation_id)

    const { data: convData } = await supabase
      .from('conversations')
      .select('*')
      .in('id', conversationIds)
      .order('last_message_at', { ascending: false, nullsFirst: false })

    if (!convData) {
      setConversations([])
      setLoading(false)
      return
    }

    // Fetch other participants for each conversation
    const enriched = await Promise.all(
      convData.map(async conv => {
        const { data: participants } = await supabase
          .from('conversation_participants')
          .select('user_id')
          .eq('conversation_id', conv.id)
          .neq('user_id', currentUser.id)

        const otherId = participants?.[0]?.user_id
        let other = null
        if (otherId) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', otherId)
            .maybeSingle()
          other = profile
        }

        // Calculate unread count
        const participant = participantData.find(p => p.conversation_id === conv.id)
        const lastRead = participant?.last_read_at || '1970-01-01'
        const { count } = await supabase
          .from('messages')
          .select('*', { count: 'exact', head: true })
          .eq('conversation_id', conv.id)
          .neq('sender_id', currentUser.id)
          .gt('created_at', lastRead)

        return {
          ...conv,
          other,
          unread_count: count || 0,
        } as Conversation
      })
    )

    setConversations(enriched)
    setLoading(false)
  }

  const filteredConversations = conversations.filter(conv => {
    if (!searchQuery) return true
    const otherName = conv.other?.name?.toLowerCase() || ''
    const preview = conv.last_message_preview?.toLowerCase() || ''
    return otherName.includes(searchQuery.toLowerCase()) || preview.includes(searchQuery.toLowerCase())
  })

  return (
    <AppShell>
      <div style={{ maxWidth: 1000, margin: '0 auto', padding: 20 }}>
        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <MessageCircle style={{ width: 28, height: 28, color: '#00aaff' }} />
            <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: '#e8f4fd', margin: 0 }}>MESSAGES</h1>
          </div>
          <p style={{ fontSize: '0.875rem', color: '#6bafd4', margin: 0 }}>
            Private conversations with your connections
          </p>
        </div>

        {/* Search */}
        <div
          style={{
            background: '#0d1426',
            border: '2px solid #1e3560',
            padding: 16,
            marginBottom: 24,
            boxShadow: '4px 4px 0px #000',
          }}
        >
          <div style={{ position: 'relative' }}>
            <Search
              style={{
                position: 'absolute',
                left: 12,
                top: '50%',
                transform: 'translateY(-50%)',
                width: 16,
                height: 16,
                color: '#6bafd4',
              }}
            />
            <input
              type="text"
              placeholder="Search conversations..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                padding: '10px 12px 10px 38px',
                background: '#060a14',
                border: '2px solid #1e3560',
                color: '#e8f4fd',
                fontSize: '0.875rem',
                outline: 'none',
              }}
            />
          </div>
        </div>

        {/* Conversations List */}
        {loading ? (
          <LoadingSkeleton rows={4} />
        ) : filteredConversations.length === 0 ? (
          <EmptyState
            icon={<MessageCircle style={{ width: 48, height: 48, color: '#00aaff' }} />}
            title={searchQuery ? 'No conversations found' : 'No messages yet'}
            body={
              searchQuery
                ? 'Try a different search term'
                : 'Start a conversation by messaging one of your connections'
            }
            action={
              !searchQuery ? (
                <Link
                  href="/connections"
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
                  <Send style={{ width: 16, height: 16 }} />
                  VIEW CONNECTIONS
                </Link>
              ) : undefined
            }
          />
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            {filteredConversations.map(conv => {
              const other = conv.other
              if (!other) return null

              return (
                <Link
                  key={conv.id}
                  href={`/messages/${conv.id}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 16,
                    padding: 16,
                    background: conv.unread_count && conv.unread_count > 0 ? 'rgba(0,170,255,0.05)' : '#0d1426',
                    border: '2px solid',
                    borderColor: conv.unread_count && conv.unread_count > 0 ? '#00aaff' : '#1e3560',
                    textDecoration: 'none',
                    boxShadow: '3px 3px 0px #000',
                    transition: 'all 0.05s',
                  }}
                >
                  <UserAvatar src={other.avatar_url} name={displayName(other)} size={56} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span
                        style={{
                          fontSize: '1rem',
                          fontWeight: 700,
                          color: '#e8f4fd',
                        }}
                      >
                        {displayName(other)}
                      </span>
                      {conv.unread_count && conv.unread_count > 0 && (
                        <span
                          style={{
                            fontSize: '0.7rem',
                            background: '#00aaff',
                            color: '#060a14',
                            padding: '2px 6px',
                            fontWeight: 700,
                            borderRadius: 10,
                          }}
                        >
                          {conv.unread_count}
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        fontSize: '0.85rem',
                        color: '#6bafd4',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {conv.last_message_preview || 'No messages yet'}
                    </div>
                  </div>
                  {conv.last_message_at && (
                    <div style={{ fontSize: '0.75rem', color: '#6bafd4', whiteSpace: 'nowrap' }}>
                      {formatRelativeTime(conv.last_message_at)}
                    </div>
                  )}
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </AppShell>
  )
}

export default function MessagesPage() {
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
      <MessagesInbox />
    </Suspense>
  )
}
