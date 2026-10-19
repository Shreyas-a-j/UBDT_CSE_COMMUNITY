'use client'

import { Suspense, use, useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, Briefcase, Calendar, GraduationCap, Loader2, Mail, MessageCircle,
} from 'lucide-react'
import { Profile, ConnectionStatus } from '@/lib/types'
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
  const [isConnected, setIsConnected] = useState(false)

  const fetchProfile = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase.from('profiles').select('*').eq('id', id).maybeSingle()
    if (error || !data) {
      toast.error('Profile not found')
      router.push('/people')
      return
    }
    setProfile(data as Profile)
    setLoading(false)
  }, [id, router, supabase])

  const fetchConnectionStatus = useCallback(async () => {
    if (!currentUser) return
    const { data } = await supabase
      .from('connection_requests')
      .select('*')
      .or(`requester_id.eq.${currentUser.id},addressee_id.eq.${currentUser.id}`)
      .or(`requester_id.eq.${id},addressee_id.eq.${id}`)
      .maybeSingle()

    if (data) {
      setIsConnected((data.status as ConnectionStatus) === 'accepted')
    }
  }, [id, currentUser, supabase])

  useEffect(() => {
    queueMicrotask(() => fetchProfile())
    if (currentUser) queueMicrotask(() => fetchConnectionStatus())
  }, [fetchProfile, fetchConnectionStatus, currentUser])

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
      const message = err instanceof Error ? err.message : 'Failed to start conversation'
      toast.error(message)
    }
  }

  if (loading) {
    return (
      <AppShell>
        <div className="mx-auto w-full max-w-4xl">
          <LoadingSkeleton rows={2} />
        </div>
      </AppShell>
    )
  }

  if (!profile) return null

  const isSelf = currentUser?.id === profile.id
  const skills = Array.isArray(profile.skills) ? profile.skills : []
  const interests = Array.isArray(profile.interests) ? profile.interests : []

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-4xl">
        <button
          type="button"
          onClick={() => router.back()}
          className="mb-4 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-muted transition-colors hover:text-ink"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to directory
        </button>

        <div className="card overflow-hidden">
          <div className="relative h-24 overflow-hidden border-b border-line bg-[#191a2b] sm:h-28">
            <div className="absolute inset-0 dot-grid opacity-25" aria-hidden />
            <div
              className="pointer-events-none absolute -right-3 top-1/2 -translate-y-1/2 select-none font-mono text-[76px] font-bold leading-none text-white/[0.04]"
              aria-hidden
            >
              &lt;/&gt;
            </div>
          </div>

          <div className="relative z-10 px-4 pb-5 sm:px-6">
            <div className="-mt-9 flex flex-wrap items-end justify-between gap-3 sm:-mt-10">
              <UserAvatar
                src={profile.avatar_url}
                name={displayName(profile)}
                size={76}
                className="ring-4 ring-surface"
              />
              {!isSelf && currentUser && (
                <div className="flex flex-wrap items-center gap-2 pb-1">
                  <ConnectButton otherUserId={profile.id} />
                  {isConnected && (
                    <button type="button" className="btn btn-soft btn-sm" onClick={handleMessage}>
                      <MessageCircle className="h-3.5 w-3.5" />
                      Message
                    </button>
                  )}
                </div>
              )}
              {isSelf && (
                <span className="chip mb-1">This is you</span>
              )}
            </div>

            <div className="mt-4">
              <h1 className="font-display text-[26px] font-semibold tracking-tight text-ink sm:text-[28px]">
                {displayName(profile)}
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {profile.usn && <span className="chip chip-mono">{profile.usn}</span>}
                <span className="chip">{getYearLabel(profile.year)}</span>
                {profile.section && <span className="chip">Section {profile.section}</span>}
                {profile.role === 'faculty' && <span className="chip chip-warn">Faculty</span>}
                {profile.role === 'admin' && <span className="chip chip-accent">Admin</span>}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
          <div className="space-y-4">
            <section className="card p-5">
              <h2 className="text-[14px] font-semibold text-ink">About</h2>
              {profile.bio ? (
                <p className="mt-2.5 max-w-[68ch] whitespace-pre-line text-[14px] leading-relaxed text-muted">
                  {profile.bio}
                </p>
              ) : (
                <p className="mt-2.5 text-[13px] text-dim">
                  {displayName(profile)} hasn&apos;t added a bio yet.
                </p>
              )}
            </section>

            <section className="card p-5">
              <h2 className="text-[14px] font-semibold text-ink">Skills</h2>
              {skills.length > 0 ? (
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {skills.map(skill => (
                    <span key={skill} className="chip py-1 text-[11.5px]">{skill}</span>
                  ))}
                </div>
              ) : (
                <p className="mt-2.5 text-[13px] text-dim">No skills listed.</p>
              )}
            </section>

            <section className="card p-5">
              <h2 className="text-[14px] font-semibold text-ink">Interests</h2>
              {interests.length > 0 ? (
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {interests.map(interest => (
                    <span key={interest} className="chip chip-accent py-1 text-[11.5px]">{interest}</span>
                  ))}
                </div>
              ) : (
                <p className="mt-2.5 text-[13px] text-dim">No interests listed.</p>
              )}
            </section>
          </div>

          <aside className="card p-5">
            <h2 className="text-[14px] font-semibold text-ink">Details</h2>
            <dl className="mt-3 space-y-3 text-[12.5px]">
              <div className="flex items-start gap-2.5">
                <GraduationCap className="mt-0.5 h-4 w-4 shrink-0 text-dim" />
                <div>
                  <dt className="text-[11px] text-dim">Department</dt>
                  <dd className="mt-0.5 text-muted">{profile.branch || 'CSE'}</dd>
                </div>
              </div>
              <div className="flex items-start gap-2.5">
                <Calendar className="mt-0.5 h-4 w-4 shrink-0 text-dim" />
                <div>
                  <dt className="text-[11px] text-dim">Joined</dt>
                  <dd className="mt-0.5 text-muted">{formatDate(profile.created_at)}</dd>
                </div>
              </div>
              {profile.designation && (
                <div className="flex items-start gap-2.5">
                  <Briefcase className="mt-0.5 h-4 w-4 shrink-0 text-dim" />
                  <div>
                    <dt className="text-[11px] text-dim">Designation</dt>
                    <dd className="mt-0.5 text-muted">{profile.designation}</dd>
                  </div>
                </div>
              )}
              <div className="flex items-start gap-2.5">
                <Mail className="mt-0.5 h-4 w-4 shrink-0 text-dim" />
                <div>
                  <dt className="text-[11px] text-dim">Contact</dt>
                  <dd className="mt-0.5 text-muted">
                    {isConnected || isSelf ? 'Message via the inbox' : 'Connect to message'}
                  </dd>
                </div>
              </div>
            </dl>
          </aside>
        </div>
      </div>
    </AppShell>
  )
}

export default function ProfilePage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-dvh items-center justify-center bg-canvas">
          <Loader2 className="h-8 w-8 animate-spin text-accent" />
        </div>
      }
    >
      <ProfileDetail params={params} />
    </Suspense>
  )
}
