'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, ShieldCheck } from 'lucide-react'
import toast from 'react-hot-toast'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/contexts/AuthContext'

interface Nomination {
  id: string
  nominated_by: string
  nominee_id: string
  status: string
  note: string | null
  created_at: string
  nominator?: { name: string } | null
}

/**
 * Non-blocking banner for the nominee. A nominee is not an administrator yet,
 * so this is mounted globally in AppShell rather than only on /admin.
 *
 * Accept/decline call the SECURITY DEFINER succession RPCs. The client never
 * writes `profiles.role` directly.
 */
export default function AdminNominationBanner() {
  const { profile, refreshProfile } = useAuth()
  const [nomination, setNomination] = useState<Nomination | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)

  const load = useCallback(async () => {
    if (!profile?.id) return
    const supabase = createClient()
    const { data, error: loadError } = await supabase
      .from('admin_nominations')
      .select('*, nominator:profiles!nominated_by (name)')
      .eq('nominee_id', profile.id)
      .eq('status', 'pending')
      .maybeSingle()

    if (loadError) {
      setError(loadError.message)
      return
    }
    setError(null)
    setNomination((data ?? null) as Nomination | null)
  }, [profile?.id])

  useEffect(() => {
    if (!profile?.id) {
      setNomination(null)
      return
    }
    queueMicrotask(() => void load())
  }, [profile?.id, load])

  useEffect(() => {
    if (!profile?.id) return
    const refresh = () => {
      if (document.visibilityState === 'visible') void load()
    }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [profile?.id, load])

  const respond = async (decision: 'accept' | 'decline') => {
    if (busyRef.current || !nomination) return

    const accepted = decision === 'accept'
    const confirmed = window.confirm(
      accepted
        ? 'Accept the administrator nomination? You will become the only administrator.'
        : 'Decline this nomination? The current administrator stays in place.'
    )
    if (!confirmed) return

    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      const supabase = createClient()
      const { error: rpcError } = await supabase.rpc(
        accepted ? 'accept_admin_nomination' : 'decline_admin_nomination',
        { p_id: nomination.id }
      )
      if (rpcError) {
        setError(rpcError.message)
        return
      }

      toast.success(
        accepted ? 'You are now the administrator' : 'Nomination declined'
      )
      setNomination(null)
      await refreshProfile()
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'The nomination could not be updated. Try again.'
      )
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  if (!profile?.id || !nomination) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed left-1/2 top-20 z-[60] w-[min(92vw,560px)] -translate-x-1/2"
    >
      <div className="card border-accent/40 bg-elevated p-4 shadow-lg">
        <div className="flex items-start gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-accent/30 bg-accent-soft text-accent-text">
            <ShieldCheck className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] text-ink">
              <span className="font-semibold">
                {nomination.nominator?.name || 'The current administrator'}
              </span>{' '}
              nominated you as administrator.
            </p>
            {nomination.note && (
              <p className="mt-1 whitespace-pre-wrap text-[11.5px] leading-relaxed text-muted">
                {nomination.note}
              </p>
            )}
            {error && (
              <p className="mt-2 flex items-start gap-1.5 break-words font-mono text-[11px] text-danger">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {error}
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void respond('accept')}
                disabled={busy}
                className="btn btn-primary btn-sm"
              >
                {busy ? 'Saving…' : 'Accept'}
              </button>
              <button
                type="button"
                onClick={() => void respond('decline')}
                disabled={busy}
                className="btn btn-outline btn-sm"
              >
                Decline
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
