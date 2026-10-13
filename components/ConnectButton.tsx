'use client'

import Link from 'next/link'
import { useConnections } from '@/hooks/useConnections'
import { startConversation } from '@/hooks/useMessages'
import { useRouter } from 'next/navigation'

export default function ConnectButton({ otherUserId }: { otherUserId: string }) {
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
      <button type="button" className="btn-neon" onClick={startChat}>
        Message
      </button>
    )
  }
  if (action === 'pending_outgoing') {
    return <span className="badge badge-neon">Pending</span>
  }
  if (action === 'pending_incoming' && pendingIncoming) {
    return (
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="btn-primary" onClick={() => respond(pendingIncoming.id, 'accepted')}>Accept</button>
        <button type="button" className="btn-outline" onClick={() => respond(pendingIncoming.id, 'rejected')}>Decline</button>
      </div>
    )
  }
  if (action === 'none') {
    return <Link href="/signin" className="btn-primary">Sign in to connect</Link>
  }
  return (
    <button type="button" className="btn-primary" onClick={() => sendRequest(otherUserId)}>
      Connect
    </button>
  )
}
