'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, MessageCircle, Search, Send } from 'lucide-react'
import { Conversation } from '@/lib/types'
import { createClient } from '@/lib/supabase/client'
import AppShell from '@/components/AppShell'
import PageHeader from '@/components/PageHeader'
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

  const fetchConversations = useCallback(async () => {
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
  }, [currentUser, supabase])

  useEffect(() => {
    if (currentUser) queueMicrotask(() => fetchConversations())
  }, [currentUser, fetchConversations])

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
  }, [currentUser, fetchConversations, supabase])

  const filteredConversations = conversations.filter(conv => {
    if (!searchQuery) return true
    const otherName = conv.other?.name?.toLowerCase() || ''
    const preview = conv.last_message_preview?.toLowerCase() || ''
    return otherName.includes(searchQuery.toLowerCase()) || preview.includes(searchQuery.toLowerCase())
  })

  const totalUnread = conversations.reduce((sum, conv) => sum + (conv.unread_count ?? 0), 0)

  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeader
        eyebrow="Inbox"
        title="Messages"
        description="Private conversations with people in your network."
        actions={
          !loading && totalUnread > 0 ? (
            <span className="chip chip-accent self-start">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              {totalUnread} unread
            </span>
          ) : undefined
        }
      />

      <div className="relative mb-4">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-dim" />
        <input
          type="text"
          placeholder="Search conversations"
          aria-label="Search conversations"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="field pl-9"
        />
      </div>

      {loading ? (
        <LoadingSkeleton rows={4} />
      ) : filteredConversations.length === 0 ? (
        <EmptyState
          icon={<MessageCircle className="h-6 w-6" />}
          title={searchQuery ? 'No conversations found' : 'No messages yet'}
          body={
            searchQuery
              ? 'Try a different name or keyword.'
              : 'Start a conversation by messaging one of your connections.'
          }
          action={
            !searchQuery ? (
              <Link href="/connections" className="btn btn-accent">
                <Send className="h-4 w-4" /> View connections
              </Link>
            ) : undefined
          }
        />
      ) : (
        <div className="card divide-y divide-line overflow-hidden">
          {filteredConversations.map(conv => {
            const other = conv.other
            if (!other) return null
            const unread = Boolean(conv.unread_count && conv.unread_count > 0)

            return (
              <Link
                key={conv.id}
                href={`/messages/${conv.id}`}
                className={`group relative flex items-center gap-3.5 px-4 py-4 transition-colors sm:px-5 ${
                  unread ? 'bg-accent/[0.03]' : 'hover:bg-elevated'
                }`}
              >
                {unread && (
                  <span
                    aria-hidden
                    className="absolute inset-y-0 left-0 w-0.5 bg-accent"
                  />
                )}
                <UserAvatar src={other.avatar_url} name={displayName(other)} size={44} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`truncate text-[14px] ${
                        unread ? 'font-semibold text-ink' : 'font-medium text-ink/90'
                      }`}
                    >
                      {displayName(other)}
                    </span>
                    {unread && (
                      <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-accent px-1.5 py-px text-[10px] font-bold text-[#14151f]">
                        {conv.unread_count}
                      </span>
                    )}
                  </div>
                  <p
                    className={`mt-0.5 truncate text-[12.5px] ${
                      unread ? 'text-muted' : 'text-dim'
                    }`}
                  >
                    {conv.last_message_preview || 'No messages yet'}
                  </p>
                </div>
                {conv.last_message_at && (
                  <span className="shrink-0 self-start pt-1 text-[10.5px] text-dim">
                    {formatRelativeTime(conv.last_message_at)}
                  </span>
                )}
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function MessagesPage() {
  return (
    <AppShell>
      <Suspense
        fallback={
          <div className="mx-auto flex w-full max-w-3xl justify-center py-24">
            <Loader2 className="h-6 w-6 animate-spin text-dim" />
          </div>
        }
      >
        <MessagesInbox />
      </Suspense>
    </AppShell>
  )
}
