import { createClient } from '@/lib/supabase/client'
import toast from 'react-hot-toast'

export async function startConversation(otherUserId: string): Promise<string | null> {
  const supabase = createClient()
  try {
    const { data: convId, error } = await supabase.rpc('get_or_create_direct_conversation', {
      other_user: otherUserId,
    })
    if (error) throw error
    return convId
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to start conversation'
    toast.error(msg)
    return null
  }
}


export type SentMessage = {
  id: string
  conversation_id: string
  sender_id: string
  body: string
  created_at: string
}

export async function sendMessage(
  conversationId: string,
  body: string
): Promise<SentMessage | null> {
  const supabase = createClient()
  const trimmed = body.trim()

  if (!trimmed || trimmed.length > 4000) {
    toast.error('Message must be between 1 and 4000 characters')
    return null
  }

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    toast.error('Please sign in to send a message')
    return null
  }

  const { data, error } = await supabase
    .from('messages')
    .insert({
      conversation_id: conversationId,
      sender_id: user.id,
      body: trimmed,
    })
    .select('id, conversation_id, sender_id, body, created_at')
    .single()

  if (error) {
    toast.error(error.message)
    return null
  }

  return data as SentMessage
}

