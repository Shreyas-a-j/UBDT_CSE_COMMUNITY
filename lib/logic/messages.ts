import { MESSAGE_MAX_LENGTH, sanitizeText } from '@/lib/validation'

export function prepareMessageBody(raw: string): { ok: true; body: string } | { ok: false; error: string } {
  const body = sanitizeText(raw, MESSAGE_MAX_LENGTH)
  if (!body) return { ok: false, error: 'Message cannot be empty.' }
  if (body.length > MESSAGE_MAX_LENGTH) {
    return { ok: false, error: `Messages must be ${MESSAGE_MAX_LENGTH} characters or fewer.` }
  }
  return { ok: true, body }
}

export function conversationUnreadCount(params: {
  lastMessageAt: string | null
  lastReadAt: string | null
  lastSenderId: string | null
  currentUserId: string
  unreadFromQuery?: number
}): number {
  if (typeof params.unreadFromQuery === 'number') return Math.max(0, params.unreadFromQuery)
  if (!params.lastMessageAt) return 0
  if (params.lastSenderId === params.currentUserId) return 0
  if (!params.lastReadAt) return 1
  return new Date(params.lastMessageAt).getTime() > new Date(params.lastReadAt).getTime() ? 1 : 0
}

export function canAccessConversation(participantIds: string[], userId: string): boolean {
  return participantIds.includes(userId)
}
