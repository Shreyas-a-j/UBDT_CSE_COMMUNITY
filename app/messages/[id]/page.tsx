'use client'

import { Suspense, useCallback, use, useEffect, useState, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertCircle, ArrowLeft, Loader2, MessageCircle, Send } from 'lucide-react'
import { Message, Profile } from '@/lib/types'
import { createClient } from '@/lib/supabase/client'
import AppShell from '@/components/AppShell'
import UserAvatar from '@/components/UserAvatar'
import LoadingSkeleton from '@/components/LoadingSkeleton'
import EmptyState from '@/components/EmptyState'
import { useAuth } from '@/contexts/AuthContext'
import { displayName } from '@/lib/profile'
import { formatRelativeTime, getYearLabel } from '@/lib/utils'
import { validateMessageBody } from '@/lib/validation'
import toast from 'react-hot-toast'

function ConversationThread({ params }: { params: Promise<{ id: string }> }) {
  const { id: conversationId } = use(params)
  const router = useRouter()
  const supabase = createClient()
  const { profile: currentUser } = useAuth()
  const [messages, setMessages] = useState<Message[]>([])
  const [otherUser, setOtherUser] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [messageBody, setMessageBody] = useState('')
  const [sending, setSending] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  const fetchConversation = useCallback(async () => {
    if (!currentUser) return
    setLoading(true)

    // Check if user is a participant
    const { data: participant } = await supabase
      .from('conversation_participants')
      .select('*')
      .eq('conversation_id', conversationId)
      .eq('user_id', currentUser.id)
      .maybeSingle()

    if (!participant) {
      toast.error('You do not have access to this conversation')
      router.push('/messages')
      return
    }

    // Fetch other participant
    const { data: participants } = await supabase
      .from('conversation_participants')
      .select('user_id')
      .eq('conversation_id', conversationId)
      .neq('user_id', currentUser.id)

    if (participants && participants.length > 0) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', participants[0].user_id)
        .maybeSingle()
      setOtherUser(profile)
    }

    // Fetch messages
    const { data: messagesData } = await supabase
      .from('messages')
      .select(`
        *,
        sender:profiles!sender_id(name, avatar_url)
      `)
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })

    if (messagesData) {
      setMessages(
        messagesData.map(msg => ({
          id: msg.id,
          conversation_id: msg.conversation_id,
          sender_id: msg.sender_id,
          body: msg.body,
          created_at: msg.created_at,
          sender_name: msg.sender?.name,
          sender_avatar: msg.sender?.avatar_url,
        }))
      )
    }

    setLoading(false)
  }, [conversationId, currentUser, supabase, router])

  const markAsRead = useCallback(async () => {
    if (!currentUser) return
    await supabase
      .from('conversation_participants')
      .update({ last_read_at: new Date().toISOString() })
      .eq('conversation_id', conversationId)
      .eq('user_id', currentUser.id)
  }, [conversationId, currentUser, supabase])

  useEffect(() => {
    if (currentUser) {
      queueMicrotask(() => fetchConversation())
      markAsRead()
    }
  }, [conversationId, currentUser, fetchConversation, markAsRead])

  useEffect(() => {
    if (!currentUser) return
    const channel = supabase
      .channel(`conversation:${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        payload => {
          const newMessage = payload.new as Message
          setMessages(prev => [...prev, newMessage])
          scrollToBottom()
          markAsRead()
        }
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [conversationId, currentUser, supabase, markAsRead])

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!currentUser || sending) return

    const error = validateMessageBody(messageBody)
    if (error) {
      toast.error(error)
      return
    }

    setSending(true)
    const { error: sendError } = await supabase.from('messages').insert({
      conversation_id: conversationId,
      sender_id: currentUser.id,
      body: messageBody.trim(),
    })

    if (sendError) {
      toast.error(sendError.message)
    } else {
      setMessageBody('')
    }
    setSending(false)
  }

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <LoadingSkeleton rows={1} />
        <div className="mt-4 flex justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-dim" />
        </div>
      </div>
    )
  }

  if (!otherUser) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <EmptyState
          icon={<AlertCircle className="h-6 w-6 text-danger" />}
          title="Conversation not found"
          body="This conversation may have been removed, or you no longer have access to it."
          action={
            <Link href="/messages" className="btn btn-outline">
              <ArrowLeft className="h-4 w-4" /> Back to inbox
            </Link>
          }
        />
      </div>
    )
  }

  return (
    <div className="mx-auto flex h-[calc(100dvh-8.5rem)] min-h-[520px] w-full max-w-3xl flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-line pb-3">
        <button
          type="button"
          onClick={() => router.push('/messages')}
          className="btn-icon -ml-1 border-transparent"
          aria-label="Back to messages"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <Link href={`/people/${otherUser.id}`} className="shrink-0">
          <UserAvatar src={otherUser.avatar_url} name={displayName(otherUser)} size={38} />
        </Link>
        <div className="min-w-0 flex-1">
          <Link
            href={`/people/${otherUser.id}`}
            className="block truncate text-[15px] font-semibold text-ink transition-colors hover:text-accent-hover"
          >
            {displayName(otherUser)}
          </Link>
          <p className="truncate text-[10.5px] text-dim">
            {otherUser.usn ? `${otherUser.usn} · ` : ''}
            {getYearLabel(otherUser.year)}
          </p>
        </div>
        <span className="hidden items-center gap-1.5 text-[11px] text-dim sm:inline-flex">
          <MessageCircle className="h-3.5 w-3.5" />
          Private thread
        </span>
      </div>

      {/* Messages */}
      <div className="flex-1 space-y-1 overflow-y-auto px-0.5 py-5">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-line bg-elevated text-dim">
              <MessageCircle className="h-5 w-5" />
            </span>
            <p className="font-display text-[15px] font-semibold text-ink">No messages yet</p>
            <p className="max-w-xs text-[12.5px] leading-relaxed text-muted">
              Say hello to {displayName(otherUser).split(' ')[0]}. This thread is only visible to the
              two of you.
            </p>
          </div>
        ) : (
          messages.map((msg, idx) => {
            const isCurrentUser = msg.sender_id === currentUser?.id
            const prev = messages[idx - 1]
            const showAvatar = idx === 0 || prev.sender_id !== msg.sender_id
            const showDay =
              idx === 0 ||
              new Date(prev.created_at).toDateString() !== new Date(msg.created_at).toDateString()

            return (
              <div key={msg.id}>
                {showDay && (
                  <div className="flex items-center gap-3 py-4">
                    <span className="h-px flex-1 bg-line" />
                    <span className="text-[10px] font-medium uppercase tracking-wide text-dim">
                      {new Date(msg.created_at).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </span>
                    <span className="h-px flex-1 bg-line" />
                  </div>
                )}
                <div
                  className={`flex items-start gap-2.5 ${
                    showAvatar ? 'mt-3' : 'mt-1'
                  } ${isCurrentUser ? 'flex-row-reverse' : 'flex-row'}`}
                >
                  {showAvatar ? (
                    <UserAvatar
                      src={isCurrentUser ? currentUser?.avatar_url : otherUser.avatar_url}
                      name={isCurrentUser ? displayName(currentUser) : displayName(otherUser)}
                      size={30}
                    />
                  ) : (
                    <div className="w-[30px] shrink-0" aria-hidden />
                  )}
                  <div
                    className={`flex max-w-[82%] flex-col ${
                      isCurrentUser ? 'items-end' : 'items-start'
                    }`}
                  >
                    <div
                      className={`whitespace-pre-wrap break-words px-3.5 py-2.5 text-[13.5px] leading-relaxed ${
                        isCurrentUser
                          ? 'rounded-2xl rounded-tr-md bg-ink text-canvas'
                          : 'rounded-2xl rounded-tl-md border border-line bg-elevated text-ink'
                      }`}
                    >
                      {msg.body}
                    </div>
                    <span className="mt-1 px-1 text-[10px] text-dim">
                      {formatRelativeTime(msg.created_at)}
                    </span>
                  </div>
                </div>
              </div>
            )
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Composer */}
      <form
        onSubmit={handleSend}
        className="border-t border-line bg-canvas pt-3"
      >
        <div className="flex items-end gap-2">
          <input
            type="text"
            placeholder="Write a message…"
            aria-label="Message"
            value={messageBody}
            onChange={e => setMessageBody(e.target.value)}
            disabled={sending}
            className="field h-11"
            maxLength={4000}
          />
          <button
            type="submit"
            disabled={!messageBody.trim() || sending}
            className="btn btn-accent h-11 shrink-0 px-4"
            aria-label="Send message"
          >
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            <span className="hidden sm:inline">Send</span>
          </button>
        </div>
        <p className="mt-2 flex items-center justify-between text-[10px] text-dim">
          <span>Enter to send</span>
          <span>{messageBody.length}/4000</span>
        </p>
      </form>
    </div>
  )
}

export default function MessageThreadPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-dvh items-center justify-center bg-canvas">
          <Loader2 className="h-6 w-6 animate-spin text-dim" />
        </div>
      }
    >
      <AppShell>
        <ConversationThread params={params} />
      </AppShell>
    </Suspense>
  )
}
