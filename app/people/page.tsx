'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { AlertCircle, Filter, RefreshCw, Search, Users, X } from 'lucide-react'
import { Profile } from '@/lib/types'
import { createClient } from '@/lib/supabase/client'
import { isVerifiedFaculty, normalizeProfile } from '@/lib/profile'
import {
  DIRECTORY_FILTERS,
  DirectoryFilter,
  filterDirectoryPeople,
  parseDirectoryFilter,
} from '@/lib/directory'
import AppShell from '@/components/AppShell'
import PageHeader from '@/components/PageHeader'
import ProfileCard from '@/components/ProfileCard'
import LoadingSkeleton from '@/components/LoadingSkeleton'
import EmptyState from '@/components/EmptyState'
import { useAuth } from '@/contexts/AuthContext'
import { useEmailVerification } from '@/hooks/useEmailVerification'

const PEOPLE_COLUMNS =
  'id, usn, name, year, branch, section, bio, avatar_url, skills, interests, role, faculty_status, designation, member_type, graduation_year, created_at'

// Legacy schemas may predate member_type/graduation_year. These columns are
// enough for normalizeProfile to derive a safe identity from role instead.
const PEOPLE_FALLBACK_COLUMNS =
  'id, usn, name, year, branch, section, bio, avatar_url, skills, interests, role, faculty_status, designation, created_at'

function normalizePeople(rows: unknown[] | null): Profile[] {
  return (rows ?? [])
    .map(row => normalizeProfile(row as Record<string, unknown>))
    .filter((person): person is Profile => person !== null)
}

function PeopleDirectory() {
  const supabase = createClient()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { profile: currentUser } = useAuth()
  const [people, setPeople] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [skillFilter, setSkillFilter] = useState('')
  // The URL is the single source of truth, so browser back/forward, a shared
  // link and the select cannot disagree. No effect is needed to mirror it.
  const directoryFilter = parseDirectoryFilter(searchParams?.get('filter'))

  const updateDirectoryFilter = useCallback(
    (filter: DirectoryFilter) => {
      const params = new URLSearchParams(searchParams?.toString() ?? '')
      if (filter === 'all') params.delete('filter')
      else params.set('filter', filter)
      const query = params.toString()
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
    },
    [pathname, router, searchParams],
  )

  // Verification is only meaningful for approved faculty profiles. The RPC
  // omits ids this viewer may not inspect, so an undefined value is "unknown".
  const facultyIds = people.filter(isVerifiedFaculty).map(person => person.id)
  const {
    status: emailVerification,
    error: emailVerificationError,
    loading: emailVerificationLoading,
    refresh: refreshEmailVerification,
  } = useEmailVerification(facultyIds)

  const fetchPeople = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const primaryRes = await supabase
        .from('profiles')
        .select(PEOPLE_COLUMNS)
        .order('created_at', { ascending: false })
        .limit(500)

      if (primaryRes.error) {
        const fallbackRes = await supabase
          .from('profiles')
          .select(PEOPLE_FALLBACK_COLUMNS)
          .order('created_at', { ascending: false })
          .limit(500)

        if (fallbackRes.error) throw fallbackRes.error

        setPeople(normalizePeople(fallbackRes.data as unknown[] | null))
      } else {
        setPeople(normalizePeople(primaryRes.data as unknown[] | null))
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

  const filteredPeople = filterDirectoryPeople(
    people.filter(person => {
      if (currentUser && person.id === currentUser.id) return false

      const matchesSearch = searchQuery
        ? person.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          person.usn?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          person.bio?.toLowerCase().includes(searchQuery.toLowerCase())
        : true

      const personSkills = Array.isArray(person.skills) ? person.skills : []
      const personInterests = Array.isArray(person.interests) ? person.interests : []
      const matchesSkill = skillFilter
        ? personSkills.some(skill => skill.toLowerCase().includes(skillFilter.toLowerCase())) ||
          personInterests.some(interest => interest.toLowerCase().includes(skillFilter.toLowerCase()))
        : true

      return matchesSearch && matchesSkill
    }),
    directoryFilter,
  )

  const activeFilterLabel = DIRECTORY_FILTERS.find(option => option.value === directoryFilter)?.label
  const hasFilters = Boolean(
    searchQuery || skillFilter || directoryFilter !== 'all',
  )
  const clearFilters = () => {
    setSearchQuery('')
    setSkillFilter('')
    router.replace(pathname, { scroll: false })
  }

  return (
    <AppShell>
      <div className="page-wrap">
        <PageHeader
          eyebrow="Community directory"
          title="Find your people"
          description="Search students, alumni and faculty across all CSE batches by name, USN, skill or interest."
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

        {emailVerificationError && !emailVerificationLoading && facultyIds.length > 0 && (
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
                Faculty profiles are still shown. No verified badge is displayed until the
                trusted status can be read.
              </p>
            </div>
            <button
              type="button"
              onClick={refreshEmailVerification}
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
                aria-label="Search members"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="field pl-9"
              />
            </div>
            <select
              value={directoryFilter}
              onChange={e => updateDirectoryFilter(e.target.value as DirectoryFilter)}
              aria-label="Filter people"
              className="field-select sm:w-40"
            >
              {DIRECTORY_FILTERS.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
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
              {directoryFilter !== 'all' && activeFilterLabel && (
                <span className="chip">Filter: {activeFilterLabel}</span>
              )}
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
            body="The People directory could not be reached. Retry above, or check the error details."
          />
        ) : filteredPeople.length === 0 ? (
          <EmptyState
            icon={<Users className="h-6 w-6 text-dim" />}
            title={hasFilters ? 'No members matched' : 'No members yet'}
            body={
              hasFilters
                ? 'Try a broader search, a different filter, or clear the filters.'
                : 'Member profiles will appear here as people join the community.'
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
              <ProfileCard
                key={person.id}
                profile={person}
                emailVerified={emailVerification[person.id]}
              />
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
