import type { ConnectionAction, ConnectionRequest } from '@/lib/types'

export function connectionPairKey(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`
}

export function canRequestConnection(requesterId: string, addresseeId: string): string | null {
  if (!requesterId || !addresseeId) return 'Both users are required.'
  if (requesterId === addresseeId) return 'You cannot connect with yourself.'
  return null
}

export function resolveConnectionAction(
  currentUserId: string | null,
  otherUserId: string,
  requests: Pick<ConnectionRequest, 'requester_id' | 'addressee_id' | 'status'>[]
): ConnectionAction {
  if (!currentUserId) return 'none'
  if (currentUserId === otherUserId) return 'self'

  const active = requests.find(req => {
    if (req.status !== 'pending' && req.status !== 'accepted') return false
    return (
      (req.requester_id === currentUserId && req.addressee_id === otherUserId) ||
      (req.requester_id === otherUserId && req.addressee_id === currentUserId)
    )
  })

  if (!active) return 'connect'
  if (active.status === 'accepted') return 'connected'
  if (active.requester_id === currentUserId) return 'pending_outgoing'
  return 'pending_incoming'
}

export function countAcceptedConnections(
  userId: string,
  requests: Pick<ConnectionRequest, 'requester_id' | 'addressee_id' | 'status'>[]
): number {
  return requests.filter(
    req =>
      req.status === 'accepted' &&
      (req.requester_id === userId || req.addressee_id === userId)
  ).length
}

export function otherPartyId(userId: string, request: Pick<ConnectionRequest, 'requester_id' | 'addressee_id'>): string {
  return request.requester_id === userId ? request.addressee_id : request.requester_id
}
