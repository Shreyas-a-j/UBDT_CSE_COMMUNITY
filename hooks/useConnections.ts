import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import { ConnectionRequest, ConnectionAction } from '@/lib/types'
import toast from 'react-hot-toast'

export function useConnections() {
  const supabase = createClient()
  const { profile } = useAuth()
  const [connections, setConnections] = useState<string[]>([])
  const [outgoing, setOutgoing] = useState<ConnectionRequest[]>([])
  const [incoming, setIncoming] = useState<ConnectionRequest[]>([])

  const fetchConnections = useCallback(async () => {
    if (!profile) return

    const { data } = await supabase
      .from('connection_requests')
      .select('*')
      .or(`requester_id.eq.${profile.id},addressee_id.eq.${profile.id}`)

    if (data) {
      const accepted = data
        .filter(r => r.status === 'accepted')
        .map(r => (r.requester_id === profile.id ? r.addressee_id : r.requester_id))

      setConnections(accepted)
      setOutgoing(data.filter(r => r.requester_id === profile.id && r.status === 'pending'))
      setIncoming(data.filter(r => r.addressee_id === profile.id && r.status === 'pending'))
    }
  }, [profile, supabase])

  useEffect(() => {
    if (profile) queueMicrotask(() => fetchConnections())
  }, [profile, fetchConnections])

  const actionFor = (otherUserId: string): ConnectionAction => {
    if (!profile) return 'none'
    if (otherUserId === profile.id) return 'self'
    if (connections.includes(otherUserId)) return 'connected'
    if (outgoing.some(r => r.addressee_id === otherUserId)) return 'pending_outgoing'
    if (incoming.some(r => r.requester_id === otherUserId)) return 'pending_incoming'
    return 'connect'
  }

  const sendRequest = async (addresseeId: string) => {
    if (!profile) return
    const { error } = await supabase.from('connection_requests').insert({
      requester_id: profile.id,
      addressee_id: addresseeId,
      status: 'pending',
    })
    if (error) {
      toast.error(error.message)
    } else {
      toast.success('Connection request sent')
      fetchConnections()
    }
  }

  const respond = async (requestId: string, status: 'accepted' | 'rejected') => {
    const { error } = await supabase
      .from('connection_requests')
      .update({ status, responded_at: new Date().toISOString() })
      .eq('id', requestId)
    if (error) {
      toast.error(error.message)
    } else {
      toast.success(status === 'accepted' ? 'Connection accepted' : 'Request rejected')
      fetchConnections()
    }
  }

  const cancel = async (requestId: string) => {
    const { error } = await supabase
      .from('connection_requests')
      .update({ status: 'cancelled', responded_at: new Date().toISOString() })
      .eq('id', requestId)
    if (error) {
      toast.error(error.message)
    } else {
      toast.success('Request cancelled')
      fetchConnections()
    }
  }

  return { profile, connections, outgoing, incoming, actionFor, sendRequest, respond, cancel }
}
