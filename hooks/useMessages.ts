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

export async function sendMessage(conversationId: string, body: string): Promise<boolean> {
  const supabase = createClient()
  const trimmed = body.trim()
  if (!trimmed || trimmed.length > 4000) {
    toast.error('Message must be between 1 and 4000 characters')
    return false
  }

  const { error } = await supabase.from('messages').insert({
    conversation_id: conversationId,
    sender_id: (await supabase.auth.getUser()).data.user?.id,
    body: trimmed,
  })

  if (error) {
    toast.error(error.message)
    return false
  }
  return true
}
