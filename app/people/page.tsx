'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { AlertCircle, Filter, RefreshCw, Search, Users, X } from 'lucide-react'
import { Profile } from '@/lib/types'
import { createClient } from '@/lib/supabase/client'
import AppShell from '@/components/AppShell'
import PageHeader from '@/components/PageHeader'
import ProfileCard from '@/components/ProfileCard'
import LoadingSkeleton from '@/components/LoadingSkeleton'
import EmptyState from '@/components/EmptyState'
import { useAuth } from '@/contexts/AuthContext'

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
      const primaryRes = await supabase
        .from('profiles')
        .select(PEOPLE_COLUMNS)
        .eq('role', 'student')
        .order('created_at', { ascending: false })
        .limit(200)

      if (primaryRes.error) {
        const fallbackRes = await supabase
          .from('profiles')
          .select('id, usn, name, year, branch, section, bio, avatar_url, skills, interests, role, created_at')
          .order('created_at', { ascending: false })
          .limit(200)

        if (fallbackRes.error) throw fallbackRes.error

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
    queueMicrotask(() => fetchPeople())
  }, [fetchPeople])

  const filteredPeople = people.filter(person => {
    if (currentUser && person.id === currentUser.id) return false

    const matchesSearch = searchQuery
      ? person.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        person.usn?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        person.bio?.toLowerCase().includes(searchQuery.toLowerCase())
      : true

    const matchesYear = yearFilter ? person.year === yearFilter : true

    const personSkills = Array.isArray(person.skills) ? person.skills : []
    const personInterests = Array.isArray(person.interests) ? person.interests : []
    const matchesSkill = skillFilter
      ? personSkills.some(skill => skill.toLowerCase().includes(skillFilter.toLowerCase())) ||
        personInterests.some(interest => interest.toLowerCase().includes(skillFilter.toLowerCase()))
      : true

    return matchesSearch && matchesYear && matchesSkill
  })

  const hasFilters = Boolean(searchQuery || yearFilter || skillFilter)
  const clearFilters = () => {
    setSearchQuery('')
    setYearFilter(null)
    setSkillFilter('')
  }

  return (
    <AppShell>
      <div className="page-wrap">
        <PageHeader
          eyebrow="Student directory"
          title="Find your people"
          description="Search students across all four CSE batches by name, USN, skill or interest."
          actions={
            <div className="flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-2 text-[12px] text-muted">
              <Users className="h-4 w-4 text-dim" />
              <span>{loading ? 'Loading' : `${filteredPeople.length} shown`}</span>
            </div>
          }
        />

        {error && !loading && (
          <div className="mb-5 flex flex-col gap-3 rounded-lg border border-error/30 bg-error/[0.06] p-4 sm:flex-row sm:items-start">
            <AlertCircle className="h-5 w-5 shrink-0 text-danger" />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-danger">Could not load the directory</p>
              <p className="mt-1 break-words font-mono text-[11px] text-error/80">{error}</p>
              <p className="mt-2 text-[11.5px] text-muted">
                If the schema changed recently, apply the migration and run{' '}
                <code className="rounded bg-canvas px-1.5 py-0.5 font-mono text-[10.5px] text-ink">
                  NOTIFY pgrst, &apos;reload schema&apos;;
                </code>
              </p>
            </div>
            <button
              type="button"
              onClick={() => fetchPeople()}
              className="btn btn-outline btn-sm shrink-0"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Retry
            </button>
          </div>
        )}

        <div className="card mb-5 p-3.5">
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,0.7fr)]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-dim" />
              <input
                type="text"
                placeholder="Search name, USN or bio"
                aria-label="Search students"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="field pl-9"
              />
            </div>
            <select
              value={yearFilter ?? ''}
              onChange={e => setYearFilter(e.target.value ? Number(e.target.value) : null)}
              aria-label="Filter by year"
              className="field-select sm:w-36"
            >
              <option value="">All years</option>
              <option value="1">1st year</option>
              <option value="2">2nd year</option>
              <option value="3">3rd year</option>
              <option value="4">4th year</option>
            </select>
            <div className="relative">
              <Filter className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-dim" />
              <input
                type="text"
                placeholder="Filter by skill"
                aria-label="Filter by skill"
                value={skillFilter}
                onChange={e => setSkillFilter(e.target.value)}
                className="field pl-9"
              />
            </div>
          </div>

          {hasFilters && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-line pt-3">
              <span className="text-[11px] text-dim">Active</span>
              {searchQuery && <span className="chip">Search: {searchQuery}</span>}
              {yearFilter && <span className="chip">Year {yearFilter}</span>}
              {skillFilter && <span className="chip">Skill: {skillFilter}</span>}
              <button
                type="button"
                onClick={clearFilters}
                className="ml-auto inline-flex items-center gap-1 text-[11px] font-medium text-muted transition-colors hover:text-ink"
              >
                <X className="h-3 w-3" /> Clear all
              </button>
            </div>
          )}
        </div>

        {loading ? (
          <LoadingSkeleton rows={6} />
        ) : error ? (
          <EmptyState
            icon={<AlertCircle className="h-6 w-6 text-danger" />}
            title="Directory unavailable"
            body="The student directory could not be reached. Retry above, or check the error details."
          />
        ) : filteredPeople.length === 0 ? (
          <EmptyState
            icon={<Users className="h-6 w-6 text-dim" />}
            title={hasFilters ? 'No students matched' : 'No students yet'}
            body={
              hasFilters
                ? 'Try a broader search, a different batch, or clear the filters.'
                : 'Student profiles will appear here as people join the community.'
            }
            action={
              hasFilters ? (
                <button type="button" className="btn btn-outline" onClick={clearFilters}>
                  Clear filters
                </button>
              ) : undefined
            }
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {filteredPeople.map(person => (
              <ProfileCard key={person.id} profile={person} />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  )
}

export default function PeoplePage() {
  return (
    <Suspense
      fallback={
        <AppShell>
          <LoadingSkeleton rows={6} />
        </AppShell>
      }
    >
      <PeopleDirectory />
    </Suspense>
  )
}
