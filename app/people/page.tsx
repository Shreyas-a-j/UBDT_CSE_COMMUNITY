'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { Search, Users, Loader2, Filter, AlertCircle, RefreshCw } from 'lucide-react'
import { Profile } from '@/lib/types'
import { createClient } from '@/lib/supabase/client'
import AppShell from '@/components/AppShell'
import ProfileCard from '@/components/ProfileCard'
import LoadingSkeleton from '@/components/LoadingSkeleton'
import EmptyState from '@/components/EmptyState'
import { useAuth } from '@/contexts/AuthContext'

// Only select columns that are guaranteed to exist on every install.
// Do NOT include: email (private, not part of the public profile schema),
// faculty_status, expertise, employee_id — these were added by migrations
// and may not be present on all databases.
const PEOPLE_COLUMNS =
  'id, usn, name, year, branch, section, bio, avatar_url, skills, interests, role, created_at'

function PeopleDirectory() {
  const supabase = createClient()
  const { profile: currentUser } = useAuth()
  const [people, setPeople] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [yearFilter, setYearFilter] = useState<number | null>(null)
  const [skillFilter, setSkillFilter] = useState('')

  const fetchPeople = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // Primary query: only core, always-present columns.
      // Filter by role=student server-side; if the role column is missing
      // this fails and we fall back to a broader query.
      const primaryRes = await supabase
        .from('profiles')
        .select(PEOPLE_COLUMNS)
        .eq('role', 'student')
        .order('created_at', { ascending: false })
        .limit(200)

      if (primaryRes.error) {
        // Fallback: wider query without role filter (works when role column
        // or other migration columns are absent). Client-side filters below
        // will still exclude non-student rows when role is present.
        const fallbackRes = await supabase
          .from('profiles')
          .select('id, usn, name, year, branch, section, bio, avatar_url, skills, interests, role, created_at')
          .order('created_at', { ascending: false })
          .limit(200)

        if (fallbackRes.error) {
          throw fallbackRes.error
        }

        const rows = (fallbackRes.data ?? []) as Record<string, unknown>[]
        const filtered = rows.filter((p: Record<string, unknown>) => {
          const role = p.role
          return role === undefined || role === 'student' || role === null
        })
        setPeople(filtered as unknown as Profile[])
      } else {
        setPeople((primaryRes.data ?? []) as unknown as Profile[])
      }
    } catch (err) {
      const e = err as { message?: string; code?: string; details?: string; hint?: string }
      const parts = [e.message || 'Unknown error']
      if (e.code) parts.push(`code: ${e.code}`)
      if (e.details) parts.push(`details: ${e.details}`)
      if (e.hint) parts.push(`hint: ${e.hint}`)
      setError(parts.join(' - '))
      setPeople([])
    } finally {
      setLoading(false)
    }
  }, [supabase])

  useEffect(() => {
    fetchPeople()
  }, [fetchPeople])

  const filteredPeople = people.filter(person => {
    // Exclude the current viewer from their own directory listing.
    if (currentUser && person.id === currentUser.id) return false

    const matchesSearch = searchQuery
      ? person.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        person.usn?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        person.bio?.toLowerCase().includes(searchQuery.toLowerCase())
      : true

    const matchesYear = yearFilter ? person.year === yearFilter : true

    // Safely handle missing skills/interests arrays — treat empty as matching.
    const personSkills = Array.isArray(person.skills) ? person.skills : []
    const personInterests = Array.isArray(person.interests) ? person.interests : []
    const matchesSkill = skillFilter
      ? personSkills.some(skill => skill.toLowerCase().includes(skillFilter.toLowerCase())) ||
        personInterests.some(interest => interest.toLowerCase().includes(skillFilter.toLowerCase()))
      : true

    return matchesSearch && matchesYear && matchesSkill
  })

  return (
    <AppShell>
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: 20 }}>
        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <Users style={{ width: 28, height: 28, color: '#00aaff' }} />
            <h1 style={style_h1}>STUDENT DIRECTORY</h1>
          </div>
          <p style={style_subtitle}>Search and connect with students across all years</p>
        </div>

        {/* Error State */}
        {error && !loading && (
          <div style={style_error_container}>
            <AlertCircle style={style_error_icon} />
            <div style={style_error_content}>
              <p style={style_error_title}>Failed to load student directory</p>
              <p style={style_error_detail}>{error}</p>
              <p style={style_error_hint}>
                If the database schema hasn&apos;t been updated, apply the migration and run:{' '}
                <code style={style_code}>NOTIFY pgrst, 'reload schema';</code>
              </p>
            </div>
            <button onClick={() => fetchPeople()} style={style_retry_btn}>
              <RefreshCw style={{ width: 14, height: 14 }} />
              RETRY
            </button>
          </div>
        )}

        {/* Search & Filters */}
        <div style={style_search_box}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 300px' }}>
              <div style={{ position: 'relative' }}>
                <Search style={style_search_icon} />
                <input
                  type="text"
                  placeholder="Search by name, USN, or bio..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  style={style_input}
                />
              </div>
            </div>
            <div style={{ flex: '0 0 140px' }}>
              <select
                value={yearFilter ?? ''}
                onChange={e => setYearFilter(e.target.value ? Number(e.target.value) : null)}
                style={style_select}
              >
                <option value="">All Years</option>
                <option value="1">1st Year</option>
                <option value="2">2nd Year</option>
                <option value="3">3rd Year</option>
                <option value="4">4th Year</option>
              </select>
            </div>
            <div style={{ flex: '1 1 200px' }}>
              <div style={{ position: 'relative' }}>
                <Filter style={style_search_icon} />
                <input
                  type="text"
                  placeholder="Filter by skill..."
                  value={skillFilter}
                  onChange={e => setSkillFilter(e.target.value)}
                  style={style_input}
                />
              </div>
            </div>
          </div>

          {(searchQuery || yearFilter || skillFilter) && (
            <div style={style_active_filters}>
              <span style={style_filter_label}>Active filters:</span>
              {searchQuery && <span style={style_tag_search}>Search: {searchQuery}</span>}
              {yearFilter && <span style={style_tag_year}>Year {yearFilter}</span>}
              {skillFilter && <span style={style_tag_skill}>Skill: {skillFilter}</span>}
              <button
                onClick={() => { setSearchQuery(''); setYearFilter(null); setSkillFilter('') }}
                style={style_clear_btn}
              >
                Clear all
              </button>
            </div>
          )}
        </div>

        {/* Results */}
        {loading ? (
          <LoadingSkeleton rows={6} />
        ) : error ? (
          <EmptyState
            icon={<AlertCircle style={{ width: 48, height: 48, color: '#ff6688' }} />}
            title="Unable to load students"
            body="There was an error fetching the student directory. Try again or check the error message above."
          />
        ) : filteredPeople.length === 0 ? (
          <EmptyState
            icon={<Users style={{ width: 48, height: 48, color: '#00aaff' }} />}
            title="No students found"
            body={
              searchQuery || yearFilter || skillFilter
                ? 'Try adjusting your search filters'
                : 'No students in the directory yet'
            }
          />
        ) : (
          <>
            <div style={style_result_count}>
              Showing {filteredPeople.length} {filteredPeople.length === 1 ? 'student' : 'students'}
            </div>
            <div style={style_grid}>
              {filteredPeople.map(person => (
                <ProfileCard key={person.id} profile={person} />
              ))}
            </div>
          </>
        )}
      </div>
    </AppShell>
  )
}

// Styles
const style_h1: React.CSSProperties = { fontSize: '1.75rem', fontWeight: 800, color: '#e8f4fd', margin: 0 }
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
const style_search_box: React.CSSProperties = {
  background: '#0d1426', border: '2px solid #1e3560', padding: 16,
  marginBottom: 24, boxShadow: '4px 4px 0px #000',
}
const style_search_icon: React.CSSProperties = {
  position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
  width: 16, height: 16, color: '#6bafd4',
}
const style_input: React.CSSProperties = {
  width: '100%', padding: '10px 12px 10px 38px', background: '#060a14',
  border: '2px solid #1e3560', color: '#e8f4fd', fontSize: '0.875rem', outline: 'none',
}
const style_select: React.CSSProperties = {
  width: '100%', padding: '10px 12px', background: '#060a14',
  border: '2px solid #1e3560', color: '#e8f4fd', fontSize: '0.875rem', outline: 'none',
}
const style_active_filters: React.CSSProperties = {
  marginTop: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
}
const style_filter_label: React.CSSProperties = { fontSize: '0.75rem', color: '#6bafd4' }
const style_tag_search: React.CSSProperties = {
  fontSize: '0.7rem', background: 'rgba(0,170,255,0.15)', color: '#00aaff',
  padding: '4px 8px', border: '1px solid rgba(0,170,255,0.3)',
}
const style_tag_year: React.CSSProperties = {
  fontSize: '0.7rem', background: 'rgba(255,224,102,0.15)', color: '#ffe066',
  padding: '4px 8px', border: '1px solid rgba(255,224,102,0.3)',
}
const style_tag_skill: React.CSSProperties = {
  fontSize: '0.7rem', background: 'rgba(0,255,204,0.15)', color: '#00ffcc',
  padding: '4px 8px', border: '1px solid rgba(0,255,204,0.3)',
}
const style_clear_btn: React.CSSProperties = {
  fontSize: '0.7rem', background: 'transparent', color: '#ff6688',
  padding: '4px 8px', border: '1px solid rgba(255,102,136,0.3)', cursor: 'pointer',
}
const style_result_count: React.CSSProperties = { marginBottom: 16, fontSize: '0.875rem', color: '#6bafd4' }
const style_grid: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16,
}

export default function PeoplePage() {
  return (
    <Suspense
      fallback={
        <AppShell>
          <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
            <Loader2 style={{ width: 48, height: 48, color: '#00aaff' }} className="animate-spin" />
          </div>
        </AppShell>
      }
    >
      <PeopleDirectory />
    </Suspense>
  )
}
