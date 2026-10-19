'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Check, Clock, MessageCircle, UserPlus } from 'lucide-react'
import { useConnections } from '@/hooks/useConnections'
import { startConversation } from '@/hooks/useMessages'

export default function ConnectButton({
  otherUserId,
  className = '',
}: {
  otherUserId: string
  className?: string
}) {
  const { profile, actionFor, sendRequest, incoming, respond } = useConnections()
  const router = useRouter()
  const action = actionFor(otherUserId)

  if (!profile || action === 'self') return null

  const pendingIncoming = incoming.find(r => r.requester_id === otherUserId)

  const startChat = async () => {
    const id = await startConversation(otherUserId)
    if (id) router.push(`/messages/${id}`)
  }

  if (action === 'connected') {
    return (
      <button type="button" className={`btn btn-soft btn-sm ${className}`} onClick={startChat}>
        <MessageCircle className="h-3.5 w-3.5" />
        Message
      </button>
    )
  }

  if (action === 'pending_outgoing') {
    return (
      <span className="chip chip-mono">
        <Clock className="h-3 w-3" />
        Request sent
      </span>
    )
  }

  if (action === 'pending_incoming' && pendingIncoming) {
    return (
      <div className="flex gap-2">
        <button
          type="button"
          className="btn btn-accent btn-sm"
          onClick={() => respond(pendingIncoming.id, 'accepted')}
        >
          <Check className="h-3.5 w-3.5" />
          Accept
        </button>
        <button
          type="button"
          className="btn btn-outline btn-sm"
          onClick={() => respond(pendingIncoming.id, 'rejected')}
        >
          Decline
        </button>
      </div>
    )
  }

  if (action === 'none') {
    return (
      <Link href="/signin" className={`btn btn-outline btn-sm ${className}`}>
        Sign in to connect
      </Link>
    )
  }

  return (
    <button
      type="button"
      className={`btn btn-accent btn-sm ${className}`}
      onClick={() => sendRequest(otherUserId)}
    >
      <UserPlus className="h-3.5 w-3.5" />
      Connect
    </button>
  )
}
