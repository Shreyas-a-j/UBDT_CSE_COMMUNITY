'use client'

import { Suspense, use, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft,
  Mail,
  Briefcase,
  Calendar,
  GraduationCap,
  Loader2,
  MessageCircle,
  UserX,
} from 'lucide-react'
import { Profile, ConnectionRequest, ConnectionStatus } from '@/lib/types'
import { createClient } from '@/lib/supabase/client'
import AppShell from '@/components/AppShell'
import UserAvatar from '@/components/UserAvatar'
import ConnectButton from '@/components/ConnectButton'
import LoadingSkeleton from '@/components/LoadingSkeleton'
import { useAuth } from '@/contexts/AuthContext'
import { displayName } from '@/lib/profile'
import { getYearLabel, formatDate } from '@/lib/utils'
import toast from 'react-hot-toast'

function ProfileDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const supabase = createClient()
  const { profile: currentUser } = useAuth()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus | null>(null)
  const [isConnected, setIsConnected] = useState(false)

  useEffect(() => {
    fetchProfile()
    if (currentUser) fetchConnectionStatus()
  }, [id, currentUser])

  const fetchProfile = async () => {
    const { data, error } = await supabase.from('profiles').select('*').eq('id', id).maybeSingle()
    if (error || !data) {
      toast.error('Profile not found')
      router.push('/people')
      return
    }
    setProfile(data as Profile)
    setLoading(false)
  }

  const fetchConnectionStatus = async () => {
    if (!currentUser) return
    const { data } = await supabase
      .from('connection_requests')
      .select('*')
      .or(`requester_id.eq.${currentUser.id},addressee_id.eq.${currentUser.id}`)
      .or(`requester_id.eq.${id},addressee_id.eq.${id}`)
      .maybeSingle()

    if (data) {
      setConnectionStatus(data.status as ConnectionStatus)
      setIsConnected(data.status === 'accepted')
    }
  }

  const handleMessage = async () => {
    if (!currentUser || !isConnected) {
      toast.error('You can only message your connections')
      return
    }
    try {
      const { data: convId, error } = await supabase.rpc('get_or_create_direct_conversation', {
        other_user: id,
      })
      if (error) throw error
      router.push(`/messages/${convId}`)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to start conversation'
      toast.error(msg)
    }
  }

  if (loading) {
    return (
      <AppShell>
        <div style={{ maxWidth: 800, margin: '0 auto', padding: 20 }}>
          <LoadingSkeleton rows={1} />
        </div>
      </AppShell>
    )
  }

  if (!profile) return null

  const isSelf = currentUser?.id === profile.id

  return (
    <AppShell>
      <div style={{ maxWidth: 800, margin: '0 auto', padding: 20 }}>
        {/* Back button */}
        <button
          onClick={() => router.back()}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 20,
            padding: '8px 12px',
            background: 'transparent',
            border: '2px solid #1e3560',
            color: '#00aaff',
            fontSize: '0.875rem',
            fontWeight: 600,
            cursor: 'pointer',
            boxShadow: '2px 2px 0px #000',
          }}
        >
          <ArrowLeft style={{ width: 16, height: 16 }} />
          BACK TO DIRECTORY
        </button>

        {/* Profile Card */}
        <div
          style={{
            background: '#0d1426',
            border: '2px solid #1e3560',
            boxShadow: '4px 4px 0px #000',
            overflow: 'hidden',
          }}
        >
          {/* Cover */}
          <div
            style={{
              height: 120,
              background: 'linear-gradient(135deg, #0a1525 0%, #0f1f3d 50%, #0a1525 100%)',
              borderBottom: '2px solid #1e3560',
            }}
          />

          {/* Profile Content */}
          <div style={{ padding: 24, marginTop: -60 }}>
            {/* Avatar and Name */}
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 20, marginBottom: 20 }}>
              <UserAvatar src={profile.avatar_url} name={displayName(profile)} size={100} borderColor="#00aaff" />
              <div style={{ flex: 1 }}>
                <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: '#e8f4fd', marginBottom: 8 }}>
                  {displayName(profile)}
                </h1>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {profile.usn && (
                    <span
                      style={{
                        fontSize: '0.75rem',
                        color: '#00ffcc',
                        background: 'rgba(0,255,204,0.1)',
                        border: '2px solid rgba(0,255,204,0.4)',
                        padding: '4px 10px',
                        boxShadow: '2px 2px 0px #006655',
                        fontWeight: 700,
                      }}
                    >
                      {profile.usn}
                    </span>
                  )}
                  <span
                    style={{
                      fontSize: '0.75rem',
                      color: '#ffe066',
                      background: 'rgba(255,224,102,0.1)',
                      border: '2px solid rgba(255,224,102,0.35)',
                      padding: '4px 10px',
                      boxShadow: '2px 2px 0px #665500',
                      fontWeight: 700,
                    }}
                  >
                    {getYearLabel(profile.year)}
                  </span>
                  {profile.section && (
                    <span
                      style={{
                        fontSize: '0.75rem',
                        color: '#6bafd4',
                        background: 'rgba(107,175,212,0.1)',
                        border: '1px solid rgba(107,175,212,0.3)',
                        padding: '4px 10px',
                        fontWeight: 600,
                      }}
                    >
                      Section {profile.section}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            {!isSelf && currentUser && (
              <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
                <ConnectButton otherUserId={profile.id} />
                {isConnected && (
                  <button
                    onClick={handleMessage}
                    style={{
                      flex: '1',
                      padding: '10px',
                      background: '#00ffcc',
                      color: '#060a14',
                      border: '2px solid #00ccaa',
                      fontSize: '0.875rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                      boxShadow: '3px 3px 0px #006655',
                    }}
                  >
                    <MessageCircle style={{ width: 16, height: 16 }} />
                    MESSAGE
                  </button>
                )}
              </div>
            )}

            {/* Bio */}
            {profile.bio && (
              <div style={{ marginBottom: 24 }}>
                <h3
                  style={{
                    fontSize: '0.875rem',
                    color: '#00aaff',
                    fontWeight: 700,
                    marginBottom: 8,
                    textTransform: 'uppercase',
                  }}
                >
                  About
                </h3>
                <p style={{ fontSize: '0.9rem', color: '#a8d4f0', lineHeight: 1.6, margin: 0 }}>{profile.bio}</p>
              </div>
            )}

            {/* Skills */}
            {profile.skills && profile.skills.length > 0 && (
              <div style={{ marginBottom: 24 }}>
                <h3
                  style={{
                    fontSize: '0.875rem',
                    color: '#00aaff',
                    fontWeight: 700,
                    marginBottom: 8,
                    textTransform: 'uppercase',
                  }}
                >
                  Skills
                </h3>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {profile.skills.map(skill => (
                    <span
                      key={skill}
                      style={{
                        fontSize: '0.8rem',
                        color: '#e8f4fd',
                        background: '#0c1220',
                        border: '2px solid #1e3560',
                        padding: '6px 12px',
                        fontWeight: 600,
                      }}
                    >
                      {skill}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Interests */}
            {profile.interests && profile.interests.length > 0 && (
              <div style={{ marginBottom: 24 }}>
                <h3
                  style={{
                    fontSize: '0.875rem',
                    color: '#00aaff',
                    fontWeight: 700,
                    marginBottom: 8,
                    textTransform: 'uppercase',
                  }}
                >
                  Interests
                </h3>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {profile.interests.map(interest => (
                    <span
                      key={interest}
                      style={{
                        fontSize: '0.8rem',
                        color: '#00ffcc',
                        background: 'rgba(0,255,204,0.08)',
                        border: '1px solid rgba(0,255,204,0.25)',
                        padding: '6px 12px',
                        fontWeight: 600,
                      }}
                    >
                      {interest}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Meta Info */}
            <div
              style={{
                paddingTop: 16,
                borderTop: '2px solid #1e3560',
                display: 'flex',
                gap: 16,
                flexWrap: 'wrap',
                fontSize: '0.8rem',
                color: '#6bafd4',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Calendar style={{ width: 14, height: 14 }} />
                Joined {formatDate(profile.created_at)}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <GraduationCap style={{ width: 14, height: 14 }} />
                {profile.branch}
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  )
}

export default function ProfilePage({ params }: { params: Promise<{ id: string }> }) {
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
      <ProfileDetail params={params} />
    </Suspense>
  )
}
