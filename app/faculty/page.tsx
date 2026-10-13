'use client'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { GraduationCap, Users, Briefcase, Award, Loader2 } from 'lucide-react'
import { Profile } from '@/lib/types'
import { createClient } from '@/lib/supabase/client'
import AppShell from '@/components/AppShell'
import UserAvatar from '@/components/UserAvatar'
import LoadingSkeleton from '@/components/LoadingSkeleton'
import EmptyState from '@/components/EmptyState'
import { displayName } from '@/lib/profile'

function FacultyDirectory() {
  const supabase = createClient()
  const [faculty, setFaculty] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchFaculty()
  }, [])

  const fetchFaculty = async () => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('role', 'faculty')
      .eq('faculty_status', 'verified')
      .order('name', { ascending: true })

    if (error) {
      console.error('Error fetching faculty:', error)
    } else {
      setFaculty(data as Profile[])
    }
    setLoading(false)
  }

  return (
    <AppShell>
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: 20 }}>
        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <GraduationCap style={{ width: 32, height: 32, color: '#ffe066' }} />
            <h1 style={{ fontSize: '1.875rem', fontWeight: 800, color: '#e8f4fd', margin: 0 }}>
              FACULTY DIRECTORY
            </h1>
          </div>
          <p style={{ fontSize: '0.875rem', color: '#6bafd4', margin: 0 }}>
            Meet the verified faculty members of the CSE department
          </p>
        </div>

        {/* Faculty Grid */}
        {loading ? (
          <LoadingSkeleton rows={6} />
        ) : faculty.length === 0 ? (
          <EmptyState
            icon={<GraduationCap style={{ width: 48, height: 48, color: '#ffe066' }} />}
            title="No verified faculty yet"
            body="Faculty members will appear here once they are verified"
          />
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
              gap: 20,
            }}
          >
            {faculty.map(member => (
              <div
                key={member.id}
                style={{
                  background: '#0d1426',
                  border: '2px solid #1e3560',
                  padding: 20,
                  boxShadow: '4px 4px 0px #000',
                  position: 'relative',
                }}
              >
                {/* Faculty Badge */}
                <div
                  style={{
                    position: 'absolute',
                    top: 12,
                    right: 12,
                    padding: '4px 8px',
                    background: '#ffe066',
                    color: '#060a14',
                    fontSize: '0.65rem',
                    fontWeight: 700,
                    boxShadow: '2px 2px 0px #665500',
                    letterSpacing: '0.03em',
                  }}
                >
                  FACULTY
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
                  <UserAvatar src={member.avatar_url} name={displayName(member)} size={80} borderColor="#ffe066" />
                  <h3
                    style={{
                      fontSize: '1.125rem',
                      fontWeight: 700,
                      color: '#e8f4fd',
                      margin: '12px 0 4px',
                    }}
                  >
                    {displayName(member)}
                  </h3>
                  {member.designation && (
                    <div
                      style={{
                        fontSize: '0.8rem',
                        color: '#ffe066',
                        fontWeight: 600,
                        marginBottom: 8,
                      }}
                    >
                      {member.designation}
                    </div>
                  )}
                  <div
                    style={{
                      fontSize: '0.75rem',
                      color: '#6bafd4',
                      marginBottom: 12,
                    }}
                  >
                    {member.branch} Department
                  </div>

                  {member.bio && (
                    <p
                      style={{
                        fontSize: '0.8rem',
                        color: '#a8d4f0',
                        lineHeight: 1.5,
                        marginBottom: 12,
                        maxHeight: 60,
                        overflow: 'hidden',
                      }}
                    >
                      {member.bio}
                    </p>
                  )}

                  {member.expertise && member.expertise.length > 0 && (
                    <div style={{ marginBottom: 12, width: '100%' }}>
                      <div
                        style={{
                          fontSize: '0.7rem',
                          color: '#6bafd4',
                          marginBottom: 6,
                          textAlign: 'left',
                          textTransform: 'uppercase',
                          fontWeight: 700,
                        }}
                      >
                        Expertise
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }}>
                        {member.expertise.slice(0, 4).map(area => (
                          <span
                            key={area}
                            style={{
                              fontSize: '0.7rem',
                              color: '#ffe066',
                              background: 'rgba(255,224,102,0.1)',
                              border: '1px solid rgba(255,224,102,0.3)',
                              padding: '4px 8px',
                              fontWeight: 600,
                            }}
                          >
                            {area}
                          </span>
                        ))}
                        {member.expertise.length > 4 && (
                          <span style={{ fontSize: '0.7rem', color: '#6bafd4' }}>
                            +{member.expertise.length - 4}
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {member.email && (
                    <div
                      style={{
                        fontSize: '0.75rem',
                        color: '#00aaff',
                        wordBreak: 'break-all',
                        marginTop: 'auto',
                      }}
                    >
                      {member.email}
                    </div>
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
