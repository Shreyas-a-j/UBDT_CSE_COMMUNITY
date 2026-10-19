'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { AlertCircle, BadgeCheck, GraduationCap, Loader2, RefreshCw, Shield } from 'lucide-react'
import { Profile } from '@/lib/types'
import { createClient } from '@/lib/supabase/client'
import AppShell from '@/components/AppShell'
import PageHeader from '@/components/PageHeader'
import UserAvatar from '@/components/UserAvatar'
import LoadingSkeleton from '@/components/LoadingSkeleton'
import EmptyState from '@/components/EmptyState'
import { displayName, isVerifiedFaculty } from '@/lib/profile'

// Columns from the verified profile schema. `email` is deliberately excluded —
// it is not part of the public profile schema and must never be exposed by a
// directory query. `faculty_status` is included because the approved-faculty
// filter depends on it; if the column is absent the query fails and we fall
// back to a role-only filter below.
const FACULTY_COLUMNS =
  'id, name, designation, branch, bio, avatar_url, role, faculty_status, created_at'

function FacultyDirectory() {
  const supabase = createClient()
  const [faculty, setFaculty] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Approved faculty = admin OR (role=faculty AND faculty_status=verified).
  // A self-declared signup role is NOT proof of approval — pending faculty
  // (faculty_status='pending') and rejected faculty are excluded here.
  const isApprovedFaculty = (p: Record<string, unknown>): boolean => {
    const role = p.role
    if (role === 'admin') return true
    if (role === 'faculty' && p.faculty_status === 'verified') return true
    return false
  }

  const fetchFaculty = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // Primary query: filter server-side by role + faculty_status.
      // If the faculty_status column is missing (pre-migration DB), this
      // fails and we fall back to a role-only query.
      const primaryRes = await supabase
        .from('profiles')
        .select(FACULTY_COLUMNS)
        .eq('role', 'faculty')
        .eq('faculty_status', 'verified')
        .order('name', { ascending: true })
        .limit(200)

      if (primaryRes.error) {
        // Fallback: narrower column set without the migration-added
        // faculty_status column. Show admins + any profile with role=faculty
        // whose faculty_status is not 'pending'/'rejected' (best effort).
        const fallbackRes = await supabase
          .from('profiles')
          .select('id, name, branch, bio, avatar_url, role, faculty_status, created_at')
          .order('name', { ascending: true })
          .limit(500)

        if (fallbackRes.error) {
          throw fallbackRes.error
        }

        const rows = (fallbackRes.data ?? []) as Record<string, unknown>[]
        const filtered = rows.filter(isApprovedFaculty)
        setFaculty(filtered as unknown as Profile[])
      } else {
        const rows = (primaryRes.data ?? []) as Record<string, unknown>[]
        // Re-verify client-side: server-side filter is authoritative but
        // we keep the client-side check for safety against schema drift.
        const filtered = rows.filter(isApprovedFaculty)
        setFaculty(filtered as unknown as Profile[])
      }
    } catch (err) {
      const e = err as { message?: string; code?: string; details?: string; hint?: string }
      const parts = [e.message || 'Unknown error']
      if (e.code) parts.push(`code: ${e.code}`)
      if (e.details) parts.push(`details: ${e.details}`)
      if (e.hint) parts.push(`hint: ${e.hint}`)
      setError(parts.join(' - '))
      setFaculty([])
    } finally {
      setLoading(false)
    }
  }, [supabase])

  useEffect(() => {
    queueMicrotask(() => fetchFaculty())
  }, [fetchFaculty])

  return (
    <div className="page-wrap">
      <PageHeader
        eyebrow="Department"
        title="Faculty directory"
        description="The verified teaching and administrative staff of the CSE department."
        actions={
          <div className="flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-2 text-[12px] text-muted">
            <GraduationCap className="h-4 w-4 text-dim" />
            <span>{loading ? 'Loading' : `${faculty.length} listed`}</span>
          </div>
        }
      />

      {error && !loading && (
        <div className="mb-5 flex flex-col gap-3 rounded-lg border border-error/30 bg-error/[0.06] p-4 sm:flex-row sm:items-start">
          <AlertCircle className="h-5 w-5 shrink-0 text-danger" />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-danger">Failed to load faculty directory</p>
            <p className="mt-1 break-words font-mono text-[11px] text-error/80">{error}</p>
            <p className="mt-2 text-[11.5px] text-muted">
              Ensure the database migrations have been applied and run:{' '}
              <code className="rounded bg-canvas px-1.5 py-0.5 font-mono text-[10.5px] text-ink">
                NOTIFY pgrst, &apos;reload schema&apos;;
              </code>
            </p>
          </div>
          <button
            type="button"
            onClick={() => fetchFaculty()}
            className="btn btn-outline btn-sm shrink-0"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Retry
          </button>
        </div>
      )}

      {loading ? (
        <LoadingSkeleton rows={6} />
      ) : error ? (
        <EmptyState
          icon={<AlertCircle className="h-6 w-6 text-danger" />}
          title="Unable to load faculty"
          body="There was an error fetching the faculty directory. See the error message above for details."
        />
      ) : faculty.length === 0 ? (
        <EmptyState
          icon={<GraduationCap className="h-6 w-6" />}
          title="No approved faculty yet"
          body="Faculty members will appear here once they have been approved by an administrator."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {faculty.map(member => (
            <article key={member.id} className="card card-hover flex h-full flex-col p-5">
              <div className="flex items-start justify-between gap-3">
                <UserAvatar
                  src={member.avatar_url}
                  name={displayName(member)}
                  size={52}
                  borderColor={isVerifiedFaculty(member) ? 'var(--color-warn)' : undefined}
                />
                {member.role === 'admin' ? (
                  <span className="chip chip-accent">
                    <Shield className="h-3 w-3" /> Admin
                  </span>
                ) : (
                  <span className="chip chip-warn">
                    <GraduationCap className="h-3 w-3" /> Faculty
                  </span>
                )}
              </div>

              <h2 className="mt-3.5 text-[15px] font-semibold text-ink">
                {displayName(member)}
              </h2>
              {member.designation && (
                <p className="mt-0.5 text-[12.5px] text-muted">{member.designation}</p>
              )}
              <p className="mt-1 text-[10.5px] text-dim">
                {member.branch ? `${member.branch} department` : 'CSE department'}
              </p>

              {member.bio && (
                <p className="clamp-3 mt-3 text-[13px] leading-relaxed text-muted">{member.bio}</p>
              )}

              <div className="mt-auto flex items-center gap-1.5 border-t border-line pt-3">
                {isVerifiedFaculty(member) ? (
                  <span className="inline-flex items-center gap-1 text-[10.5px] font-medium text-accent-hover">
                    <BadgeCheck className="h-3.5 w-3.5" /> Verified
                  </span>
                ) : (
                  <span className="text-[10.5px] text-dim">Department staff</span>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}

export default function FacultyPage() {
  return (
    <AppShell>
      <Suspense
        fallback={
          <div className="mx-auto flex w-full max-w-6xl justify-center py-24">
            <Loader2 className="h-6 w-6 animate-spin text-dim" />
          </div>
        }
      >
        <FacultyDirectory />
      </Suspense>
    </AppShell>
  )
}
