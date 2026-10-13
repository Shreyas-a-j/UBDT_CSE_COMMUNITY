'use client'

import { Suspense, use, useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Send, Loader2, AlertCircle } from 'lucide-react'
import { Message, Profile } from '@/lib/types'
import { createClient } from '@/lib/supabase/client'
import AppShell from '@/components/AppShell'
import UserAvatar from '@/components/UserAvatar'
import LoadingSkeleton from '@/components/LoadingSkeleton'
import { useAuth } from '@/contexts/AuthContext'
import { displayName } from '@/lib/profile'
import { formatRelativeTime } from '@/lib/utils'
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

  useEffect(() => {
    if (currentUser) {
      fetchConversation()
      markAsRead()
    }
  }, [conversationId, currentUser])

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
  }, [conversationId, currentUser])

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  const fetchConversation = async () => {
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
  }

  const markAsRead = async () => {
    if (!currentUser) return
    await supabase
      .from('conversation_participants')
      .update({ last_read_at: new Date().toISOString() })
      .eq('conversation_id', conversationId)
      .eq('user_id', currentUser.id)
  }

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
      <AppShell>
        <div style={{ maxWidth: 900, margin: '0 auto', padding: 20 }}>
          <LoadingSkeleton rows={1} />
        </div>
      </AppShell>
    )
  }

  if (!otherUser) {
    return (
      <AppShell>
        <div style={{ maxWidth: 900, margin: '0 auto', padding: 60, textAlign: 'center' }}>
          <AlertCircle style={{ width: 48, height: 48, color: '#ff6688', margin: '0 auto 16px' }} />
          <p style={{ color: '#e8f4fd', fontSize: '1rem' }}>Conversation not found</p>
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell>
      <div
        style={{
          maxWidth: 900,
          margin: '0 auto',
          height: 'calc(100vh - 80px)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div
          style={{
            background: '#0d1426',
            border: '2px solid #1e3560',
            padding: 16,
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            boxShadow: '4px 4px 0px #000',
            margin: '20px 20px 0',
          }}
        >
          <button
            onClick={() => router.push('/messages')}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#00aaff',
              cursor: 'pointer',
              padding: 8,
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <ArrowLeft style={{ width: 20, height: 20 }} />
          </button>
          <UserAvatar src={otherUser.avatar_url} name={displayName(otherUser)} size={40} />
          <div style={{ flex: 1 }}>
            <h2 style={{ fontSize: '1.125rem', fontWeight: 700, color: '#e8f4fd', margin: 0 }}>
              {displayName(otherUser)}
            </h2>
            <div style={{ fontSize: '0.8rem', color: '#6bafd4' }}>
              {otherUser.usn && <span>{otherUser.usn}</span>}
            </div>
          </div>
        </div>

        {/* Messages */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: 20,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          {messages.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 60, color: '#6bafd4' }}>
              <p>No messages yet. Start the conversation!</p>
            </div>
          ) : (
            messages.map((msg, idx) => {
              const isCurrentUser = msg.sender_id === currentUser?.id
              const showAvatar = idx === 0 || messages[idx - 1].sender_id !== msg.sender_id

              return (
                <div
                  key={msg.id}
                  style={{
                    display: 'flex',
                    gap: 12,
                    alignItems: 'flex-start',
                    flexDirection: isCurrentUser ? 'row-reverse' : 'row',
                  }}
                >
                  {showAvatar ? (
                    <UserAvatar
                      src={isCurrentUser ? currentUser.avatar_url : otherUser.avatar_url}
                      name={isCurrentUser ? displayName(currentUser) : displayName(otherUser)}
                      size={32}
                    />
                  ) : (
                    <div style={{ width: 32 }} />
                  )}
                  <div
                    style={{
                      maxWidth: '70%',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: isCurrentUser ? 'flex-end' : 'flex-start',
                    }}
                  >
                    <div
                      style={{
                        padding: '10px 14px',
                        background: isCurrentUser ? '#00aaff' : '#0d1426',
                        color: isCurrentUser ? '#060a14' : '#e8f4fd',
                        border: isCurrentUser ? '2px solid #0088cc' : '2px solid #1e3560',
                        fontSize: '0.9rem',
                        lineHeight: 1.5,
                        boxShadow: '2px 2px 0px #000',
                        wordWrap: 'break-word',
                      }}
                    >
                      {msg.body}
                    </div>
                    <div
                      style={{
                        fontSize: '0.7rem',
                        color: '#6bafd4',
                        marginTop: 4,
                        paddingLeft: isCurrentUser ? 0 : 4,
                        paddingRight: isCurrentUser ? 4 : 0,
                      }}
                    >
                      {formatRelativeTime(msg.created_at)}
                    </div>
                  </div>
                </div>
              )
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <form
          onSubmit={handleSend}
          style={{
            background: '#0d1426',
            border: '2px solid #1e3560',
            padding: 16,
            margin: '0 20px 20px',
            display: 'flex',
            gap: 12,
            boxShadow: '4px 4px 0px #000',
          }}
        >
          <input
            type="text"
            placeholder="Type a message..."
            value={messageBody}
            onChange={e => setMessageBody(e.target.value)}
            disabled={sending}
            style={{
              flex: 1,
              padding: '10px 14px',
              background: '#060a14',
              border: '2px solid #1e3560',
              color: '#e8f4fd',
              fontSize: '0.9rem',
              outline: 'none',
            }}
            maxLength={4000}
          />
          <button
            type="submit"
            disabled={!messageBody.trim() || sending}
            style={{
              padding: '10px 16px',
              background: messageBody.trim() && !sending ? '#00aaff' : '#1e3560',
              color: messageBody.trim() && !sending ? '#060a14' : '#6bafd4',
              border: '2px solid',
              borderColor: messageBody.trim() && !sending ? '#0088cc' : '#1e3560',
              fontSize: '0.875rem',
              fontWeight: 700,
              cursor: messageBody.trim() && !sending ? 'pointer' : 'not-allowed',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              boxShadow: messageBody.trim() && !sending ? '3px 3px 0px #003366' : 'none',
            }}
          >
            {sending ? (
              <Loader2 style={{ width: 16, height: 16 }} className="animate-spin" />
            ) : (
              <Send style={{ width: 16, height: 16 }} />
            )}
            SEND
          </button>
        </form>
      </div>
    </AppShell>
  )
}

export default function MessageThreadPage({ params }: { params: Promise<{ id: string }> }) {
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
      <ConversationThread params={params} />
    </Suspense>
  )
}
