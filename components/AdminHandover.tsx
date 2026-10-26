'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  RefreshCw,
  ShieldCheck,
  UserCheck,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import { isAdmin } from '@/lib/profile'
import { formatDate } from '@/lib/utils'

interface Nominee {
  id: string
  name: string
  usn: string | null
  designation: string | null
  avatar_url?: string | null
}

interface PendingNomination {
  id: string
  nominated_by: string
  nominee_id: string
  status: string
  note: string | null
  created_at: string
  nominee?: { id: string; name: string; usn: string | null } | null
  nominator?: { id: string; name: string } | null
}

interface AuditRow {
  id: string
  action: string
  actor_name: string | null
  target_name: string | null
  outcome: string | null
  detail: string | null
  created_at: string
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Awaiting nominee response',
  accepted: 'Accepted',
  declined: 'Declined',
  cancelled: 'Cancelled',
}

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? 'Unknown'
}

function actionLabel(action: string): string {
  return action.replaceAll('_', ' ')
}

/**
 * Administrator handover.
 *
 * The database succession RPCs are the only write path: this card never
 * updates `profiles.role` or writes the nomination/audit tables directly. It
 * deliberately does not offer resignation or operator recovery.
 */
export default function AdminHandover() {
  const { profile } = useAuth()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [nominees, setNominees] = useState<Nominee[]>([])
  const [pending, setPending] = useState<PendingNomination | null>(null)
  const [audit, setAudit] = useState<AuditRow[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)

  const canManage = Boolean(profile && isAdmin(profile))

  const load = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!profile || !isAdmin(profile)) return
      if (!options?.silent) setLoading(true)
      setError(null)

      const supabase = createClient()
      const [nomineeResult, pendingResult, auditResult] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, name, usn, designation, avatar_url')
          .eq('role', 'faculty')
          .in('faculty_status', ['approved', 'verified'])
          // member_type is descriptive identity, not the privilege model.
          // The database re-checks the same rule in nominate_admin() via
          // is_eligible_admin_candidate(); legacy faculty with
          // member_type='student' must still be eligible.
          .neq('id', profile.id)
          .order('name'),
        supabase
          .from('admin_nominations')
          .select(
            '*, nominee:profiles!nominee_id (id, name, usn), nominator:profiles!nominated_by (id, name)'
          )
          .eq('status', 'pending')
          .maybeSingle(),
        supabase
          .from('admin_audit_log')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(10),
      ])

      const loadError =
        nomineeResult.error?.message ||
        pendingResult.error?.message ||
        auditResult.error?.message ||
        null

      if (loadError) setError(loadError)
      if (!nomineeResult.error) setNominees((nomineeResult.data ?? []) as Nominee[])
      if (!pendingResult.error) {
        setPending((pendingResult.data ?? null) as PendingNomination | null)
      }
      if (!auditResult.error) setAudit((auditResult.data ?? []) as AuditRow[])

      setLoading(false)
    },
    [profile]
  )

  useEffect(() => {
    if (!canManage) return
    queueMicrotask(() => void load())
  }, [canManage, load])

  useEffect(() => {
    if (!canManage) return
    const refresh = () => {
      if (document.visibilityState === 'visible') void load({ silent: true })
    }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [canManage, load])

  const nominate = async () => {
    if (busyRef.current) return
    if (!selectedId) {
      toast.error('Choose an eligible faculty member.')
      return
    }
    const nominee = nominees.find(row => row.id === selectedId)
    if (!nominee) {
      toast.error('That nominee is no longer eligible. Refresh and try again.')
      return
    }
    if (
      !window.confirm(
        `Nominate ${nominee.name} as administrator? They must accept before the role transfers.`
      )
    ) {
      return
    }

    busyRef.current = true
    setBusy(true)
    setActionError(null)
    try {
      const supabase = createClient()
      const { error: rpcError } = await supabase.rpc('nominate_admin', {
        p_nominee: selectedId,
        p_note: note.trim() || null,
      })
      if (rpcError) {
        setActionError(rpcError.message)
        return
      }
      toast.success(`Nomination sent to ${nominee.name}`)
      setSelectedId('')
      setNote('')
      await load({ silent: true })
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'The nomination could not be created.'
      )
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const cancel = async () => {
    if (busyRef.current || !pending) return
    const nomineeName = pending.nominee?.name || 'this nominee'
    if (!window.confirm(`Cancel the pending nomination for ${nomineeName}?`)) return

    busyRef.current = true
    setBusy(true)
    setActionError(null)
    try {
      const supabase = createClient()
      const { error: rpcError } = await supabase.rpc('cancel_admin_nomination', {
        p_id: pending.id,
      })
      if (rpcError) {
        setActionError(rpcError.message)
        return
      }
      toast.success('Nomination cancelled')
      await load({ silent: true })
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'The nomination could not be cancelled.'
      )
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  if (!canManage) return null

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-line px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-accent/30 bg-accent-soft text-accent-text">
            <ShieldCheck className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-[14px] font-semibold text-ink">Administrator handover</h2>
            <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-muted">
              The nominee must accept before the role transfers. If no administrator remains,
              operator recovery is required.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading || busy}
          className="btn btn-outline btn-sm shrink-0"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <div className="grid gap-5 p-5">
        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-error/30 bg-error/[0.06] p-3">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
            <p className="break-words font-mono text-[11px] text-error/90">{error}</p>
          </div>
        )}

        {actionError && (
          <div className="flex items-start gap-2 rounded-lg border border-error/30 bg-error/[0.06] p-3">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
            <p className="break-words font-mono text-[11px] text-error/90">{actionError}</p>
          </div>
        )}

        {loading ? (
          <p className="text-[12px] text-muted">Loading succession state…</p>
        ) : pending ? (
          <div className="rounded-lg border border-warn/30 bg-warn/[0.06] p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Clock className="h-4 w-4 text-warn" />
              <p className="text-[13px] font-semibold text-ink">
                {pending.nominee?.name || 'Unknown nominee'}
              </p>
              <span className="chip text-[10.5px]">{statusLabel(pending.status)}</span>
            </div>
            <p className="mt-2 text-[11.5px] text-muted">
              Nominated by {pending.nominator?.name || 'the current administrator'} on{' '}
              {formatDate(pending.created_at)}
            </p>
            {pending.note && (
              <p className="mt-2 whitespace-pre-wrap text-[12px] leading-relaxed text-muted">
                {pending.note}
              </p>
            )}
            <button
              type="button"
              onClick={() => void cancel()}
              disabled={busy}
              className="btn btn-outline btn-sm mt-3"
            >
              Cancel nomination
            </button>
          </div>
        ) : (
          <div className="grid gap-3">
            {nominees.length === 0 ? (
              <p className="text-[12px] text-muted">No approved faculty are eligible yet.</p>
            ) : (
              <>
                <div className="grid gap-1.5">
                  <label htmlFor="admin-nominee" className="text-[11.5px] font-medium text-muted">
                    Eligible nominee
                  </label>
                  <select
                    id="admin-nominee"
                    value={selectedId}
                    onChange={event => setSelectedId(event.target.value)}
                    disabled={busy}
                    className="input"
                  >
                    <option value="">Choose an approved faculty member</option>
                    {nominees.map(nominee => (
                      <option key={nominee.id} value={nominee.id}>
                        {nominee.name}
                        {nominee.designation ? ` — ${nominee.designation}` : ''}
                        {nominee.usn ? ` (${nominee.usn})` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid gap-1.5">
                  <label htmlFor="admin-note" className="text-[11.5px] font-medium text-muted">
                    Optional note
                  </label>
                  <textarea
                    id="admin-note"
                    value={note}
                    onChange={event => setNote(event.target.value)}
                    maxLength={500}
                    rows={3}
                    disabled={busy}
                    placeholder="Context for the nominee (max 500 characters)"
                    className="input resize-y"
                  />
                  <p className="text-right text-[10.5px] text-dim">{note.length}/500</p>
                </div>

                <div>
                  <button
                    type="button"
                    onClick={() => void nominate()}
                    disabled={busy || !selectedId}
                    className="btn btn-primary btn-sm"
                  >
                    <UserCheck className="h-3.5 w-3.5" />
                    {busy ? 'Nominating…' : 'Nominate successor'}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        <div>
          <div className="mb-2 flex items-center gap-2">
            <CheckCircle2 className="h-3.5 w-3.5 text-muted" />
            <h3 className="text-[12px] font-semibold text-ink">Recent succession activity</h3>
          </div>
          {audit.length === 0 ? (
            <p className="text-[12px] text-muted">No succession activity yet.</p>
          ) : (
            <ul className="grid gap-1.5">
              {audit.map(row => (
                <li
                  key={row.id}
                  className="rounded-md border border-line bg-elevated/60 px-3 py-2 text-[11.5px]"
                >
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-medium capitalize text-ink">
                      {actionLabel(row.action)}
                    </span>
                    <span className="text-dim">·</span>
                    <span className="text-muted">
                      {row.actor_name || 'System'} → {row.target_name || '—'}
                    </span>
                    {row.outcome && (
                      <span className="chip text-[10px] capitalize">{row.outcome}</span>
                    )}
                    <time dateTime={row.created_at} className="ml-auto text-[10.5px] text-dim">
                      {formatDate(row.created_at)}
                    </time>
                  </div>
                  {row.detail && (
                    <p className="mt-1 break-words text-[11px] leading-relaxed text-muted">
                      {row.detail}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[10.5px] text-dim">
            Read-only audit. Recovery is operator-only and is not available from this page.
          </p>
        </div>
      </div>
    </section>
  )
}
