'use client'

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertCircle,
  CheckCircle,
  Clock,
  Loader2,
  RefreshCw,
  Shield,
  ShieldCheck,
  XCircle,
} from 'lucide-react'
import { FacultyApplication, Profile } from '@/lib/types'
import { createClient } from '@/lib/supabase/client'
import AppShell from '@/components/AppShell'
import PageHeader from '@/components/PageHeader'
import UserAvatar from '@/components/UserAvatar'
import LoadingSkeleton from '@/components/LoadingSkeleton'
import EmptyState from '@/components/EmptyState'
import EmailVerificationBadge from '@/components/EmailVerificationBadge'
import CommunityActivityExport from '@/components/CommunityActivityExport'
import AdminHandover from '@/components/AdminHandover'
import { useAuth } from '@/contexts/AuthContext'
import { isAdmin, displayName, normalizeProfile } from '@/lib/profile'
import { formatDate } from '@/lib/utils'
import toast from 'react-hot-toast'

interface AdminFacultyPayload {
  applications?: FacultyApplication[]
  profiles?: Record<string, unknown>[]
  emailVerified?: Record<string, boolean>
  emailVerificationError?: string | null
  error?: string
}

function AdminDashboard() {
  const router = useRouter()
  const { profile: currentUser, loading: authLoading } = useAuth()
  const [applications, setApplications] = useState<FacultyApplication[]>([])
  const [profiles, setProfiles] = useState<Record<string, Profile>>({})
  const [emailVerified, setEmailVerified] = useState<Record<string, boolean>>({})
  const [emailVerificationError, setEmailVerificationError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [processingId, setProcessingId] = useState<string | null>(null)
  // A ref, not state, is the duplicate-submit guard: two clicks in the same
  // render can both observe the previous `processingId`.
  const processingRef = useRef<Set<string>>(new Set())

  // The admin route is the server-side authorisation boundary. The dashboard
  // never updates faculty_applications directly: POST re-reads the caller's
  // role before the database's RLS + transition triggers run.
  const fetchApplications = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!currentUser || !isAdmin(currentUser)) return
      if (!options?.silent) setLoading(true)
      setError(null)

      try {
        const response = await fetch('/api/admin/faculty', {
          cache: 'no-store',
          credentials: 'same-origin',
        })
        const payload = (await response.json().catch(() => null)) as AdminFacultyPayload | null

        if (!response.ok) {
          throw new Error(payload?.error || `Request failed (${response.status}).`)
        }

        setApplications(payload?.applications ?? [])
        setEmailVerified(payload?.emailVerified ?? {})
        setEmailVerificationError(payload?.emailVerificationError ?? null)

        const profileMap: Record<string, Profile> = {}
        for (const row of payload?.profiles ?? []) {
          const normalized = normalizeProfile(row)
          if (normalized) profileMap[normalized.id] = normalized
        }
        setProfiles(profileMap)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load faculty applications.')
      } finally {
        setLoading(false)
      }
    },
    [currentUser],
  )

  useEffect(() => {
    if (authLoading) return
    if (!currentUser) return
    if (!isAdmin(currentUser)) {
      toast.error('Access denied: Admin privileges required')
      router.push('/')
      return
    }
    queueMicrotask(() => fetchApplications())
  }, [authLoading, currentUser, fetchApplications, router])

  // Refresh after another administrator acts, or when the tab regains focus.
  useEffect(() => {
    if (authLoading || !currentUser || !isAdmin(currentUser)) return

    const supabase = createClient()
    const channel = supabase
      .channel('admin-faculty-applications')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'faculty_applications' },
        () => {
          void fetchApplications({ silent: true })
        },
      )
      .subscribe()

    const refreshSilently = () => {
      void fetchApplications({ silent: true })
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refreshSilently()
    }

    window.addEventListener('focus', refreshSilently)
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      window.removeEventListener('focus', refreshSilently)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      void supabase.removeChannel(channel)
    }
  }, [authLoading, currentUser, fetchApplications])

  const decide = async (
    applicationId: string,
    decision: 'approve' | 'reject',
    notes?: string,
  ) => {
    if (processingRef.current.has(applicationId)) return
    processingRef.current.add(applicationId)
    setProcessingId(applicationId)

    try {
      const response = await fetch(`/api/admin/faculty/${applicationId}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, notes }),
      })
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; outcome?: string; application?: FacultyApplication }
        | null

      if (!response.ok) {
        // The API reports the real state: not found, already approved, already
        // rejected, or changed by another administrator. Never replace that
        // with a generic "already reviewed" message.
        toast.error(
          payload?.error ||
            `Failed to ${decision === 'approve' ? 'approve' : 'reject'} application.`,
        )
        await fetchApplications({ silent: true })
        return
      }

      toast.success(
        decision === 'approve'
          ? 'Faculty application approved — faculty access granted'
          : 'Faculty application rejected',
      )
      await fetchApplications({ silent: true })
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : 'The request failed. Check your connection and try again.',
      )
    } finally {
      processingRef.current.delete(applicationId)
      setProcessingId(null)
    }
  }

  const handleApprove = (applicationId: string) => decide(applicationId, 'approve')

  const handleReject = (applicationId: string, notes?: string) =>
    decide(applicationId, 'reject', notes || 'Application not approved')

  if (authLoading) {
    return (
      <div className="mx-auto w-full max-w-5xl">
        <LoadingSkeleton rows={3} />
      </div>
    )
  }

  if (!currentUser || !isAdmin(currentUser)) {
    return (
      <div className="mx-auto w-full max-w-5xl">
        <EmptyState
          icon={<AlertCircle className="h-6 w-6 text-danger" />}
          title="Access denied"
          body="Admin privileges are required to review faculty applications."
        />
      </div>
    )
  }

  const pendingApplications = applications.filter(app => app.status === 'pending')
  const reviewedApplications = applications.filter(app => app.status !== 'pending')
  const approvedCount = applications.filter(a => a.status === 'approved').length
  const rejectedCount = applications.filter(a => a.status === 'rejected').length

  const stats = [
    { label: 'Pending applications', value: pendingApplications.length, tone: 'text-warn' },
    { label: 'Approved', value: approvedCount, tone: 'text-accent-text' },
    { label: 'Rejected', value: rejectedCount, tone: 'text-danger' },
  ]

  return (
    <div className="mx-auto w-full max-w-5xl">
      <PageHeader
        eyebrow={<><Shield className="h-3.5 w-3.5" /> Administration</>}
        title="Faculty applications"
        description="Review requests for faculty access. Approving an application grants verified publishing permissions immediately."
        actions={
          <button
            type="button"
            onClick={() => fetchApplications()}
            disabled={loading}
            className="btn btn-outline btn-sm"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        }
      />

      {error && (
        <div className="mb-5 flex flex-col gap-3 rounded-lg border border-error/30 bg-error/[0.06] p-4 sm:flex-row sm:items-start">
          <AlertCircle className="h-5 w-5 shrink-0 text-danger" />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-danger">
              Could not load faculty applications
            </p>
            <p className="mt-1 break-words font-mono text-[11px] text-error/80">{error}</p>
            <p className="mt-2 text-[11.5px] text-muted">
              This is the database or server error, not an empty queue. Retry, or check the
              migration and RLS configuration.
            </p>
          </div>
          <button
            type="button"
            onClick={() => fetchApplications()}
            className="btn btn-outline btn-sm shrink-0"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Retry
          </button>
        </div>
      )}

      {emailVerificationError && !loading && (
        <div className="mb-5 flex flex-col gap-3 rounded-lg border border-warn/30 bg-warn/[0.05] p-4 sm:flex-row sm:items-start">
          <AlertCircle className="h-5 w-5 shrink-0 text-warn" />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-ink">
              Email verification status unavailable
            </p>
            <p className="mt-1 break-words font-mono text-[11px] text-muted">
              {emailVerificationError}
            </p>
            <p className="mt-2 text-[11.5px] text-muted">
              Applications remain reviewable. No verified badge is shown until the trusted
              status can be read.
            </p>
          </div>
          <button
            type="button"
            onClick={() => fetchApplications({ silent: true })}
            className="btn btn-outline btn-sm shrink-0"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Retry
          </button>
        </div>
      )}

      {loading ? (
        <LoadingSkeleton rows={3} />
      ) : (
        <div className="grid gap-5">
          {/* Community activity export */}
          <CommunityActivityExport />

          {/* Administrator succession */}
          <AdminHandover />

          {/* Stats */}
          <div className="grid gap-3 sm:grid-cols-3">
            {stats.map(stat => (
              <div key={stat.label} className="card p-4">
                <p className={`font-display text-[28px] font-semibold leading-none ${stat.tone}`}>
                  {stat.value}
                </p>
                <p className="mt-2 text-[12px] text-muted">{stat.label}</p>
              </div>
            ))}
          </div>

          {/* Pending Applications */}
          <section className="card overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
              <h2 className="flex items-center gap-2 text-[14px] font-semibold text-ink">
                <Clock className="h-4 w-4 text-warn" />
                Awaiting review
              </h2>
              <span className="chip text-[10.5px]">{pendingApplications.length}</span>
            </div>

            {pendingApplications.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  icon={<CheckCircle className="h-5 w-5 text-accent-text" />}
                  title={applications.length === 0 ? 'No applications yet' : 'Nothing to review'}
                  body={
                    applications.length === 0
                      ? 'New faculty signups will appear here automatically. If a member says they applied and nothing appears, check the signup provisioning trigger and RLS.'
                      : 'All faculty applications have been processed.'
                  }
                />
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {pendingApplications.map(app => {
                  const profile = profiles[app.user_id]
                  const busy = processingId === app.id
                  return (
                    <li key={app.id} className="p-5">
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                        <div className="flex min-w-0 flex-1 items-start gap-3.5">
                          {profile ? (
                            <UserAvatar
                              src={profile.avatar_url}
                              name={displayName(profile)}
                              size={48}
                              borderColor="var(--color-warn)"
                            />
                          ) : (
                            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-line bg-elevated font-mono text-[12px] text-dim">
                              ?
                            </span>
                          )}
                          <div className="min-w-0">
                            <h3 className="text-[15px] font-semibold text-ink">
                              {app.full_name}
                            </h3>
                            <p className="mt-0.5 text-[12.5px] text-warn">
                              {app.designation} · {app.department}
                            </p>
                            <div className="mt-1.5 space-y-0.5 break-words text-[10.5px] text-dim">
                              <p>Email: {app.official_email}</p>
                              <EmailVerificationBadge
                                verified={emailVerified[app.user_id]}
                                className="mt-1"
                              />
                              {app.employee_id && <p>Employee ID: {app.employee_id}</p>}
                              <p>Applied {formatDate(app.created_at)}</p>
                            </div>
                          </div>
                        </div>

                        <div className="flex shrink-0 items-center gap-2 sm:flex-col sm:items-end">
                          <button
                            type="button"
                            onClick={() => handleApprove(app.id)}
                            disabled={busy}
                            className="btn btn-accent btn-sm flex-1 sm:flex-none"
                          >
                            {busy ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <CheckCircle className="h-3.5 w-3.5" />
                            )}
                            Approve
                          </button>
                          <button
                            type="button"
                            onClick={() => handleReject(app.id)}
                            disabled={busy}
                            className="btn btn-danger btn-sm flex-1 sm:flex-none"
                          >
                            <XCircle className="h-3.5 w-3.5" />
                            Reject
                          </button>
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          {/* Reviewed Applications */}
          {reviewedApplications.length > 0 && (
            <section className="card overflow-hidden">
              <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
                <h2 className="flex items-center gap-2 text-[14px] font-semibold text-ink">
                  <ShieldCheck className="h-4 w-4 text-dim" />
                  Recent reviews
                </h2>
                <span className="chip text-[10.5px]">
                  {reviewedApplications.slice(0, 5).length}
                </span>
              </div>

              <ul className="divide-y divide-line">
                {reviewedApplications.slice(0, 5).map(app => (
                  <li
                    key={app.id}
                    className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium text-ink">{app.full_name}</p>
                      <p className="mt-0.5 truncate text-[10.5px] text-dim">
                        {app.designation} · Reviewed {formatDate(app.reviewed_at || app.created_at)}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 self-start sm:self-auto">
                      <EmailVerificationBadge verified={emailVerified[app.user_id]} />
                      <span
                        className={`chip capitalize ${
                          app.status === 'approved' ? 'chip-accent' : 'chip-danger'
                        }`}
                      >
                        {app.status}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  )
}

export default function AdminPage() {
  return (
    <AppShell>
      <Suspense
        fallback={
          <div className="mx-auto flex w-full max-w-5xl justify-center py-24">
            <Loader2 className="h-6 w-6 animate-spin text-dim" />
          </div>
        }
      >
        <AdminDashboard />
      </Suspense>
    </AppShell>
  )
}
