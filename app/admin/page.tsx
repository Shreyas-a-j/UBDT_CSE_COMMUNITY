'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { Shield, CheckCircle, XCircle, Clock, Loader2, AlertCircle } from 'lucide-react'
import { FacultyApplication, Profile } from '@/lib/types'
import { createClient } from '@/lib/supabase/client'
import AppShell from '@/components/AppShell'
import UserAvatar from '@/components/UserAvatar'
import LoadingSkeleton from '@/components/LoadingSkeleton'
import EmptyState from '@/components/EmptyState'
import { useAuth } from '@/contexts/AuthContext'
import { isAdmin, displayName } from '@/lib/profile'
import { formatDate } from '@/lib/utils'
import { useRouter } from 'next/navigation'
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
      <AppShell>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: 60, textAlign: 'center' }}>
          <AlertCircle style={{ width: 48, height: 48, color: '#ff6688', margin: '0 auto 16px' }} />
          <p style={{ color: '#e8f4fd', fontSize: '1rem' }}>Access denied: Admin privileges required</p>
        </div>
      </AppShell>
    )
  }

  const pendingApplications = applications.filter(app => app.status === 'pending')
  const reviewedApplications = applications.filter(app => app.status !== 'pending')

  return (
    <AppShell>
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: 20 }}>
        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <Shield style={{ width: 32, height: 32, color: '#ff6688' }} />
            <h1 style={{ fontSize: '1.875rem', fontWeight: 800, color: '#e8f4fd', margin: 0 }}>
              ADMIN DASHBOARD
            </h1>
          </div>
          <p style={{ fontSize: '0.875rem', color: '#6bafd4', margin: 0 }}>
            Manage faculty applications and user permissions
          </p>
        </div>

        {loading ? (
          <LoadingSkeleton rows={3} />
        ) : (
          <div style={{ display: 'grid', gap: 24 }}>
            {/* Stats */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
              <div
                style={{
                  background: '#0d1426',
                  border: '2px solid #1e3560',
                  padding: 20,
                  boxShadow: '3px 3px 0px #000',
                }}
              >
                <div style={{ fontSize: '2rem', fontWeight: 800, color: '#ffe066', marginBottom: 4 }}>
                  {pendingApplications.length}
                </div>
                <div style={{ fontSize: '0.875rem', color: '#6bafd4' }}>Pending Applications</div>
              </div>
              <div
                style={{
                  background: '#0d1426',
                  border: '2px solid #1e3560',
                  padding: 20,
                  boxShadow: '3px 3px 0px #000',
                }}
              >
                <div style={{ fontSize: '2rem', fontWeight: 800, color: '#00ffcc', marginBottom: 4 }}>
                  {applications.filter(a => a.status === 'approved').length}
                </div>
                <div style={{ fontSize: '0.875rem', color: '#6bafd4' }}>Approved</div>
              </div>
              <div
                style={{
                  background: '#0d1426',
                  border: '2px solid #1e3560',
                  padding: 20,
                  boxShadow: '3px 3px 0px #000',
                }}
              >
                <div style={{ fontSize: '2rem', fontWeight: 800, color: '#ff6688', marginBottom: 4 }}>
                  {applications.filter(a => a.status === 'rejected').length}
                </div>
                <div style={{ fontSize: '0.875rem', color: '#6bafd4' }}>Rejected</div>
              </div>
            </div>

            {/* Pending Applications */}
            <div
              style={{
                background: '#0d1426',
                border: '2px solid #1e3560',
                padding: 20,
                boxShadow: '4px 4px 0px #000',
              }}
            >
              <h2
                style={{
                  fontSize: '1.125rem',
                  fontWeight: 700,
                  color: '#ffe066',
                  marginBottom: 16,
                  textTransform: 'uppercase',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <Clock style={{ width: 20, height: 20 }} />
                Pending Applications ({pendingApplications.length})
              </h2>

              {pendingApplications.length === 0 ? (
                <EmptyState
                  icon={<CheckCircle style={{ width: 36, height: 36, color: '#00ffcc' }} />}
                  title="No pending applications"
                  body="All faculty applications have been reviewed"
                />
              ) : (
                <div style={{ display: 'grid', gap: 16 }}>
                  {pendingApplications.map(app => {
                    const profile = profiles[app.user_id]
                    return (
                      <div
                        key={app.id}
                        style={{
                          background: '#060a14',
                          border: '2px solid #ffe066',
                          padding: 16,
                        }}
                      >
                        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                          {profile && (
                            <UserAvatar
                              src={profile.avatar_url}
                              name={displayName(profile)}
                              size={64}
                              borderColor="#ffe066"
                            />
                          )}
                          <div style={{ flex: 1 }}>
                            <h3 style={{ fontSize: '1.125rem', fontWeight: 700, color: '#e8f4fd', marginBottom: 4 }}>
                              {app.full_name}
                            </h3>
                            <div style={{ fontSize: '0.875rem', color: '#ffe066', marginBottom: 8 }}>
                              {app.designation} • {app.department}
                            </div>
                            <div style={{ fontSize: '0.8rem', color: '#6bafd4', marginBottom: 8 }}>
                              <div>Email: {app.official_email}</div>
                              {app.employee_id && <div>Employee ID: {app.employee_id}</div>}
                            </div>
                            <div style={{ fontSize: '0.75rem', color: '#6bafd4' }}>
                              Applied {formatDate(app.created_at)}
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button
                              onClick={() => handleApprove(app.id)}
                              disabled={processingId === app.id}
                              style={{
                                padding: '8px 14px',
                                background: '#00ffcc',
                                color: '#060a14',
                                border: '2px solid #00ccaa',
                                fontSize: '0.8rem',
                                fontWeight: 700,
                                cursor: processingId === app.id ? 'not-allowed' : 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                boxShadow: '2px 2px 0px #006655',
                                opacity: processingId === app.id ? 0.6 : 1,
                              }}
                            >
                              {processingId === app.id ? (
                                <Loader2 style={{ width: 14, height: 14 }} className="animate-spin" />
                              ) : (
                                <CheckCircle style={{ width: 14, height: 14 }} />
                              )}
                              APPROVE
                            </button>
                            <button
                              onClick={() => handleReject(app.id)}
                              disabled={processingId === app.id}
                              style={{
                                padding: '8px 14px',
                                background: 'transparent',
                                color: '#ff6688',
                                border: '2px solid #ff6688',
                                fontSize: '0.8rem',
                                fontWeight: 700,
                                cursor: processingId === app.id ? 'not-allowed' : 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                boxShadow: '2px 2px 0px #661133',
                                opacity: processingId === app.id ? 0.6 : 1,
                              }}
                            >
                              <XCircle style={{ width: 14, height: 14 }} />
                              REJECT
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Reviewed Applications */}
            {reviewedApplications.length > 0 && (
              <div
                style={{
                  background: '#0d1426',
                  border: '2px solid #1e3560',
                  padding: 20,
                  boxShadow: '4px 4px 0px #000',
                }}
              >
                <h2
                  style={{
                    fontSize: '1.125rem',
                    fontWeight: 700,
                    color: '#6bafd4',
                    marginBottom: 16,
                    textTransform: 'uppercase',
                  }}
                >
                  Recent Reviews ({reviewedApplications.slice(0, 5).length})
                </h2>
                <div style={{ display: 'grid', gap: 12 }}>
                  {reviewedApplications.slice(0, 5).map(app => (
                    <div
                      key={app.id}
                      style={{
                        background: '#060a14',
                        border: '2px solid #1e3560',
                        padding: 12,
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <div>
                        <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#e8f4fd', marginBottom: 4 }}>
                          {app.full_name}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: '#6bafd4' }}>
                          {app.designation} • Reviewed {formatDate(app.reviewed_at || app.created_at)}
                        </div>
                      </div>
                      <span
                        style={{
                          fontSize: '0.75rem',
                          padding: '4px 10px',
                          background:
                            app.status === 'approved' ? 'rgba(0,255,204,0.15)' : 'rgba(255,102,136,0.15)',
                          color: app.status === 'approved' ? '#00ffcc' : '#ff6688',
                          border: `1px solid ${app.status === 'approved' ? 'rgba(0,255,204,0.3)' : 'rgba(255,102,136,0.3)'}`,
                          fontWeight: 700,
                          textTransform: 'uppercase',
                        }}
                      >
                        {app.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </AppShell>
  )
}

export default function AdminPage() {
  return (
    <Suspense
      fallback={
        <AppShell>
          <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
            <Loader2 style={{ width: 48, height: 48, color: '#ff6688' }} className="animate-spin" />
          </div>
        </AppShell>
      }
    >
      <AdminDashboard />
    </Suspense>
  )
}
