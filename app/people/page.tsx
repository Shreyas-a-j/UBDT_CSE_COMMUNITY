'use client'

import { Suspense, useEffect, useState } from 'react'
import { Search, Users, Loader2, Filter } from 'lucide-react'
import { Profile } from '@/lib/types'
import { createClient } from '@/lib/supabase/client'
import AppShell from '@/components/AppShell'
import ProfileCard from '@/components/ProfileCard'
import LoadingSkeleton from '@/components/LoadingSkeleton'
import EmptyState from '@/components/EmptyState'
import { useAuth } from '@/contexts/AuthContext'

function PeopleDirectory() {
  const supabase = createClient()
  const { profile: currentUser } = useAuth()
  const [people, setPeople] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [yearFilter, setYearFilter] = useState<number | null>(null)
  const [skillFilter, setSkillFilter] = useState('')

  useEffect(() => {
    fetchPeople()
  }, [])

  const fetchPeople = async () => {
    setLoading(true)
    let query = supabase
      .from('profiles')
      .select('*')
      .eq('role', 'student')
      .order('created_at', { ascending: false })
      .limit(100)

    const { data, error } = await query
    if (error) {
      console.error('Error fetching people:', error)
      setPeople([])
    } else {
      setPeople(data as Profile[])
    }
    setLoading(false)
  }

  const filteredPeople = people.filter(person => {
    if (currentUser && person.id === currentUser.id) return false

    const matchesSearch = searchQuery
      ? person.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        person.usn?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        person.bio?.toLowerCase().includes(searchQuery.toLowerCase())
      : true

    const matchesYear = yearFilter ? person.year === yearFilter : true

    const matchesSkill = skillFilter
      ? person.skills.some(skill => skill.toLowerCase().includes(skillFilter.toLowerCase())) ||
        person.interests.some(interest => interest.toLowerCase().includes(skillFilter.toLowerCase()))
      : true

    return matchesSearch && matchesYear && matchesSkill
  })

  return (
    <AppShell>
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '20px' }}>
        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <Users style={{ width: 28, height: 28, color: '#00aaff' }} />
            <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: '#e8f4fd', margin: 0 }}>
              STUDENT DIRECTORY
            </h1>
          </div>
          <p style={{ fontSize: '0.875rem', color: '#6bafd4', margin: 0 }}>
            Search and connect with students across all years
          </p>
        </div>

        {/* Search & Filters */}
        <div
          style={{
            background: '#0d1426',
            border: '2px solid #1e3560',
            padding: 16,
            marginBottom: 24,
            boxShadow: '4px 4px 0px #000',
          }}
        >
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {/* Search */}
            <div style={{ flex: '1 1 300px' }}>
              <div style={{ position: 'relative' }}>
                <Search
                  style={{
                    position: 'absolute',
                    left: 12,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    width: 16,
                    height: 16,
                    color: '#6bafd4',
                  }}
                />
                <input
                  type="text"
                  placeholder="Search by name, USN, or bio..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 12px 10px 38px',
                    background: '#060a14',
                    border: '2px solid #1e3560',
                    color: '#e8f4fd',
                    fontSize: '0.875rem',
                    outline: 'none',
                  }}
                />
              </div>
            </div>

            {/* Year Filter */}
            <div style={{ flex: '0 0 140px' }}>
              <select
                value={yearFilter ?? ''}
                onChange={e => setYearFilter(e.target.value ? Number(e.target.value) : null)}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  background: '#060a14',
                  border: '2px solid #1e3560',
                  color: '#e8f4fd',
                  fontSize: '0.875rem',
                  outline: 'none',
                }}
              >
                <option value="">All Years</option>
                <option value="1">1st Year</option>
                <option value="2">2nd Year</option>
                <option value="3">3rd Year</option>
                <option value="4">4th Year</option>
              </select>
            </div>

            {/* Skill Filter */}
            <div style={{ flex: '1 1 200px' }}>
              <div style={{ position: 'relative' }}>
                <Filter
                  style={{
                    position: 'absolute',
                    left: 12,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    width: 16,
                    height: 16,
                    color: '#6bafd4',
                  }}
                />
                <input
                  type="text"
                  placeholder="Filter by skill..."
                  value={skillFilter}
                  onChange={e => setSkillFilter(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 12px 10px 38px',
                    background: '#060a14',
                    border: '2px solid #1e3560',
                    color: '#e8f4fd',
                    fontSize: '0.875rem',
                    outline: 'none',
                  }}
                />
              </div>
            </div>
          </div>

          {/* Active filters indicator */}
          {(searchQuery || yearFilter || skillFilter) && (
            <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.75rem', color: '#6bafd4' }}>Active filters:</span>
              {searchQuery && (
                <span
                  style={{
                    fontSize: '0.7rem',
                    background: 'rgba(0,170,255,0.15)',
                    color: '#00aaff',
                    padding: '4px 8px',
                    border: '1px solid rgba(0,170,255,0.3)',
                  }}
                >
                  Search: {searchQuery}
                </span>
              )}
              {yearFilter && (
                <span
                  style={{
                    fontSize: '0.7rem',
                    background: 'rgba(255,224,102,0.15)',
                    color: '#ffe066',
                    padding: '4px 8px',
                    border: '1px solid rgba(255,224,102,0.3)',
                  }}
                >
                  Year {yearFilter}
                </span>
              )}
              {skillFilter && (
                <span
                  style={{
                    fontSize: '0.7rem',
                    background: 'rgba(0,255,204,0.15)',
                    color: '#00ffcc',
                    padding: '4px 8px',
                    border: '1px solid rgba(0,255,204,0.3)',
                  }}
                >
                  Skill: {skillFilter}
                </span>
              )}
              <button
                onClick={() => {
                  setSearchQuery('')
                  setYearFilter(null)
                  setSkillFilter('')
                }}
                style={{
                  fontSize: '0.7rem',
                  background: 'transparent',
                  color: '#ff6688',
                  padding: '4px 8px',
                  border: '1px solid rgba(255,102,136,0.3)',
                  cursor: 'pointer',
                }}
              >
                Clear all
              </button>
            </div>
          )}
        </div>

        {/* Results */}
        {loading ? (
          <LoadingSkeleton rows={6} />
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
            <div style={{ marginBottom: 16, fontSize: '0.875rem', color: '#6bafd4' }}>
              Showing {filteredPeople.length} {filteredPeople.length === 1 ? 'student' : 'students'}
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                gap: 16,
              }}
            >
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
