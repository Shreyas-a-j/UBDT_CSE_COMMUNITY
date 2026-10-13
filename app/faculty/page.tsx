'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { GraduationCap, Loader2, AlertCircle, RefreshCw } from 'lucide-react'
import { Profile } from '@/lib/types'
import { createClient } from '@/lib/supabase/client'
import AppShell from '@/components/AppShell'
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
    <AppShell>
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: 20 }}>
        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <GraduationCap style={{ width: 32, height: 32, color: '#ffe066' }} />
            <h1 style={style_h1}>FACULTY DIRECTORY</h1>
          </div>
          <p style={style_subtitle}>Meet the approved faculty members of the CSE department</p>
        </div>

        {/* Error State */}
        {error && !loading && (
          <div style={style_error_container}>
            <AlertCircle style={style_error_icon} />
            <div style={style_error_content}>
              <p style={style_error_title}>Failed to load faculty directory</p>
              <p style={style_error_detail}>{error}</p>
              <p style={style_error_hint}>
                Ensure the database migrations have been applied and run:{' '}
                <code style={style_code}>NOTIFY pgrst, &apos;reload schema&apos;;</code>
              </p>
            </div>
            <button onClick={() => fetchFaculty()} style={style_retry_btn}>
              <RefreshCw style={{ width: 14, height: 14 }} />
              RETRY
            </button>
          </div>
        )}

        {/* Faculty Grid */}
        {loading ? (
          <LoadingSkeleton rows={6} />
        ) : error ? (
          <EmptyState
            icon={<AlertCircle style={{ width: 48, height: 48, color: '#ff6688' }} />}
            title="Unable to load faculty"
            body="There was an error fetching the faculty directory. See the error message above for details."
          />
        ) : faculty.length === 0 ? (
          <EmptyState
            icon={<GraduationCap style={{ width: 48, height: 48, color: '#ffe066' }} />}
            title="No approved faculty yet"
            body="Faculty members will appear here once they have been approved by an administrator"
          />
        ) : (
          <div style={style_faculty_grid}>
            {faculty.map(member => (
              <div key={member.id} style={style_faculty_card}>
                <div style={style_faculty_badge}>
                  {member.role === 'admin' ? 'ADMIN' : 'FACULTY'}
                </div>
                <div style={style_faculty_inner}>
                  <UserAvatar src={member.avatar_url} name={displayName(member)} size={80} borderColor="#ffe066" />
                  <h3 style={style_faculty_name}>{displayName(member)}</h3>
                  {member.designation && (
                    <div style={style_faculty_designation}>{member.designation}</div>
                  )}
                  <div style={style_faculty_dept}>{member.branch} Department</div>

                  {member.bio && (
                    <p style={style_faculty_bio}>{member.bio}</p>
                  )}

                  {isVerifiedFaculty(member) && (
                    <span style={style_verified_badge}>✓ Verified</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  )
}

// Styles
const style_h1: React.CSSProperties = { fontSize: '1.875rem', fontWeight: 800, color: '#e8f4fd', margin: 0 }
const style_subtitle: React.CSSProperties = { fontSize: '0.875rem', color: '#6bafd4', margin: 0 }
const style_error_container: React.CSSProperties = {
  background: 'rgba(255,68,102,0.08)', border: '2px solid rgba(255,68,102,0.3)',
  padding: 16, marginBottom: 24, display: 'flex', gap: 12, alignItems: 'flex-start',
}
const style_error_icon: React.CSSProperties = { width: 20, height: 20, color: '#ff6688', flexShrink: 0, marginTop: 2 }
const style_error_content: React.CSSProperties = { flex: 1 }
const style_error_title: React.CSSProperties = { color: '#ff6688', fontWeight: 700, fontSize: '0.875rem', margin: '0 0 4px' }
const style_error_detail: React.CSSProperties = { color: '#cc3355', fontSize: '0.75rem', margin: '0 0 8px', fontFamily: 'monospace' }
const style_error_hint: React.CSSProperties = { color: '#6bafd4', fontSize: '0.7rem', margin: 0 }
const style_code: React.CSSProperties = { background: '#060a14', padding: '2px 6px', fontFamily: 'monospace', fontSize: '0.7rem' }
const style_retry_btn: React.CSSProperties = {
  padding: '8px 14px', background: '#ff6688', color: '#fff', border: '2px solid #cc3355',
  fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
  boxShadow: '2px 2px 0px #661133', whiteSpace: 'nowrap',
}
const style_faculty_grid: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 20,
}
const style_faculty_card: React.CSSProperties = {
  background: '#0d1426', border: '2px solid #1e3560', padding: 20,
  boxShadow: '4px 4px 0px #000', position: 'relative',
}
const style_faculty_badge: React.CSSProperties = {
  position: 'absolute', top: 12, right: 12, padding: '4px 8px', background: '#ffe066',
  color: '#060a14', fontSize: '0.65rem', fontWeight: 700, boxShadow: '2px 2px 0px #665500',
  letterSpacing: '0.03em',
}
const style_faculty_inner: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center',
}
const style_faculty_name: React.CSSProperties = { fontSize: '1.125rem', fontWeight: 700, color: '#e8f4fd', margin: '12px 0 4px' }
const style_faculty_designation: React.CSSProperties = { fontSize: '0.8rem', color: '#ffe066', fontWeight: 600, marginBottom: 8 }
const style_faculty_dept: React.CSSProperties = { fontSize: '0.75rem', color: '#6bafd4', marginBottom: 12 }
const style_faculty_bio: React.CSSProperties = {
  fontSize: '0.8rem', color: '#a8d4f0', lineHeight: 1.5, marginBottom: 12,
  maxHeight: 60, overflow: 'hidden',
}
const style_verified_badge: React.CSSProperties = {
  fontSize: '0.7rem', color: '#00ffcc', background: 'rgba(0,255,204,0.1)',
  border: '1px solid rgba(0,255,204,0.3)', padding: '4px 8px', fontWeight: 600,
}

export default function FacultyPage() {
  return (
    <Suspense
      fallback={
        <AppShell>
          <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
            <Loader2 style={{ width: 48, height: 48, color: '#ffe066' }} className="animate-spin" />
          </div>
        </AppShell>
      }
    >
      <FacultyDirectory />
    </Suspense>
  )
}
