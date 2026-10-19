'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertCircle,
  CheckCircle,
  Clock,
  Loader2,
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
import { useAuth } from '@/contexts/AuthContext'
import { isAdmin, displayName } from '@/lib/profile'
import { formatDate } from '@/lib/utils'
import toast from 'react-hot-toast'

function AdminDashboard() {
  const router = useRouter()
  const supabase = createClient()
  const { profile: currentUser } = useAuth()
  const [applications, setApplications] = useState<FacultyApplication[]>([])
  const [profiles, setProfiles] = useState<Record<string, Profile>>({})
  const [loading, setLoading] = useState(true)
  const [processingId, setProcessingId] = useState<string | null>(null)

  const fetchApplications = useCallback(async () => {
    if (!currentUser) return
    setLoading(true)

    const { data, error } = await supabase
      .from('faculty_applications')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching applications:', error)
    } else if (data) {
      setApplications(data as FacultyApplication[])

      // Fetch user profiles
      const userIds = data.map(app => app.user_id)
      const { data: profilesData } = await supabase
        .from('profiles')
        .select('*')
        .in('id', userIds)

      if (profilesData) {
        const profileMap: Record<string, Profile> = {}
        profilesData.forEach(p => {
          profileMap[p.id] = p as Profile
        })
        setProfiles(profileMap)
      }
    }

    setLoading(false)
  }, [currentUser, supabase])

  useEffect(() => {
    if (currentUser) {
      if (!isAdmin(currentUser)) {
        toast.error('Access denied: Admin privileges required')
        router.push('/')
        return
      }
      queueMicrotask(() => fetchApplications())
    }
  }, [currentUser, fetchApplications, router])

  const handleApprove = async (applicationId: string) => {
    if (!currentUser) return
    setProcessingId(applicationId)

    // First update the faculty application
    const { error: appError } = await supabase
      .from('faculty_applications')
      .update({
        status: 'approved',
        reviewed_by: currentUser.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', applicationId)
      .eq('status', 'pending') // Prevent double approval

    if (appError) {
      toast.error(`Failed to approve application: ${appError.message}`)
      setProcessingId(null)
      return
    }

    // Get the application to find the user_id for profile update
    const { data: appData, error: fetchError } = await supabase
      .from('faculty_applications')
      .select('user_id, designation, employee_id')
      .eq('id', applicationId)
      .single()

    if (fetchError || !appData) {
      toast.error('Failed to fetch application details')
      fetchApplications()
      setProcessingId(null)
      return
    }

    // Update the user's profile to grant faculty access
    const { error: profileError } = await supabase
      .from('profiles')
      .update({
        role: 'faculty',
        faculty_status: 'verified',
        designation: appData.designation, // Set designation from application
        employee_id: appData.employee_id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', appData.user_id)
      .eq('role', 'student') // Prevent re-approval of already approved users

    if (profileError) {
      toast.error(`Failed to update faculty profile: ${profileError.message}`)
    } else {
      toast.success('Faculty application approved - faculty access granted')
    }

    fetchApplications()
    setProcessingId(null)
  }

  const handleReject = async (applicationId: string, notes?: string) => {
    if (!currentUser) return
    setProcessingId(applicationId)

    const { error } = await supabase
      .from('faculty_applications')
      .update({
        status: 'rejected',
        reviewed_by: currentUser.id,
        reviewed_at: new Date().toISOString(),
        notes: notes || 'Application not approved',
      })
      .eq('id', applicationId)
      .eq('status', 'pending') // Prevent double rejection

    if (error) {
      toast.error(`Failed to reject application: ${error.message}`)
    } else {
      toast.success('Faculty application rejected')

      // Also update the user's profile to mark as rejected
      const { data: appData } = await supabase
        .from('faculty_applications')
        .select('user_id')
        .eq('id', applicationId)
        .single()

      if (appData) {
        await supabase
          .from('profiles')
          .update({ faculty_status: 'rejected', updated_at: new Date().toISOString() })
          .eq('id', appData.user_id)
          .eq('role', 'student') // Only update students who applied
      }
    }

    fetchApplications()
    setProcessingId(null)
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
    { label: 'Approved', value: approvedCount, tone: 'text-accent' },
    { label: 'Rejected', value: rejectedCount, tone: 'text-danger' },
  ]

  return (
    <div className="mx-auto w-full max-w-5xl">
      <PageHeader
        eyebrow={<><Shield className="h-3.5 w-3.5" /> Administration</>}
        title="Faculty applications"
        description="Review requests for faculty access. Approving an application grants verified publishing permissions immediately."
      />

      {loading ? (
        <LoadingSkeleton rows={3} />
      ) : (
        <div className="grid gap-5">
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
                  icon={<CheckCircle className="h-5 w-5 text-accent" />}
                  title="Nothing to review"
                  body="All faculty applications have been processed."
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
                    <span
                      className={`chip self-start capitalize sm:self-auto ${
                        app.status === 'approved' ? 'chip-accent' : 'chip-danger'
                      }`}
                    >
                      {app.status}
                    </span>
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
