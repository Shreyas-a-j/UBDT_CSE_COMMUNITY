'use client'

import { Suspense, use, useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, BadgeCheck, Briefcase, Calendar, GraduationCap, Loader2,
} from 'lucide-react'
import { Post, Profile } from '@/lib/types'
import { createClient } from '@/lib/supabase/client'
import AppShell from '@/components/AppShell'
import UserAvatar from '@/components/UserAvatar'
import LoadingSkeleton from '@/components/LoadingSkeleton'
import PostCard from '@/components/PostCard'
import ProfileLinks from '@/components/ProfileLinks'
import EmailVerificationBadge from '@/components/EmailVerificationBadge'
import { useEmailVerification } from '@/hooks/useEmailVerification'
import { useAuth } from '@/contexts/AuthContext'
import { mapPost, useCommunity } from '@/contexts/CommunityContext'
import { alumniTag, displayName, normalizeProfile } from '@/lib/profile'
import { getYearLabel, formatDate } from '@/lib/utils'
import toast from 'react-hot-toast'

function ProfileDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const supabase = createClient()
  const { profile: currentUser } = useAuth()
  const { posts: feedPosts, postsRevision } = useCommunity()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [projects, setProjects] = useState<Post[]>([])
  const [projectsLoading, setProjectsLoading] = useState(true)
  const [projectsError, setProjectsError] = useState<string | null>(null)
  // Distinguishes the current profile's in-flight fetch from a response for
  // a previous id: Next.js re-runs our effects on param navigation without
  // remounting the component, so a slow response must not clobber the list.
  const projectsRequestRef = useRef(0)
  const [loading, setLoading] = useState(true)

  // Self and approved faculty are authorised targets. For anyone else the RPC
  // omits the id, so `emailVerified` stays undefined and no badge renders.
  const { status: emailVerification } = useEmailVerification(profile ? [profile.id] : [])
  const emailVerified = profile ? emailVerification[profile.id] : undefined

  const fetchProfile = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase.from('profiles').select('*').eq('id', id).maybeSingle()
    const normalized = normalizeProfile(data as Record<string, unknown> | null)
    if (error || !normalized) {
      toast.error('Profile not found')
      router.push('/people')
      return
    }
    setProfile(normalized)
    setLoading(false)
  }, [id, router, supabase])

  // The same join shape as the feed (author embed + reaction counts) so the
  // existing PostCard renders profile showcases unchanged. `silent` keeps the
  // section's skeleton off-screen for revision refetches (delete/edit/like)
  // so interactive counts do not flash the whole list.
  const fetchProjects = useCallback(async (options?: { silent?: boolean }) => {
    const requestId = ++projectsRequestRef.current
    if (!options?.silent) {
      setProjectsLoading(true)
      setProjectsError(null)
    }
    let result = await supabase
      .from('posts')
      .select(`
        *,
        author:profiles!author_id (name, usn, avatar_url, year, role, member_type, graduation_year),
        likes (count),
        comments (count),
        upvotes (count)
      `)
      .eq('author_id', id)
      .eq('type', 'showcase')
      .order('created_at', { ascending: false })
      .limit(40)
    if (result.error) {
      result = await supabase
        .from('posts')
        .select('*')
        .eq('author_id', id)
        .eq('type', 'showcase')
        .order('created_at', { ascending: false })
        .limit(40)
    }
    if (requestId !== projectsRequestRef.current) return
    if (result.error) {
      setProjectsError(result.error.message)
      setProjects([])
    } else if (result.data) {
      setProjects((result.data as Record<string, unknown>[]).map(mapPost))
    }
    setProjectsLoading(false)
  }, [id, supabase])

  useEffect(() => {
    queueMicrotask(() => fetchProfile())
  }, [fetchProfile])

  // Initial load and profile-to-profile navigation (id changed).
  useEffect(() => {
    queueMicrotask(() => fetchProjects())
  }, [fetchProjects])

  // Keep the section in sync after post mutations (create, edit, delete,
  // like, upvote). postsRevision starts at 0 and only grows, so the mount
  // pass skips this and avoids a duplicate fetch next to the one above.
  useEffect(() => {
    if (postsRevision === 0) return
    queueMicrotask(() => fetchProjects({ silent: true }))
  }, [fetchProjects, postsRevision])

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
                {profile.member_type === 'alumni' ? (
                  profile.graduation_year ? (
                    <span className="chip chip-peach">
                      <GraduationCap className="h-3.5 w-3.5" /> Class of {profile.graduation_year}
                    </span>
                  ) : null
                ) : (
                  <span className="chip">{getYearLabel(profile.year)}</span>
                )}
                {profile.section && <span className="chip">Section {profile.section}</span>}
                {profile.role === 'faculty' && <span className="chip chip-warn">Faculty</span>}
                {profile.role === 'admin' && <span className="chip chip-peach">Admin</span>}
                <EmailVerificationBadge verified={emailVerified} />
                {profile.member_type === 'alumni' && (
                  <span className="chip chip-peach">
                    <BadgeCheck className="h-3 w-3" /> {alumniTag(profile.graduation_year)}
                  </span>
                )}
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
              <ProfileLinks profile={profile} className="mt-3" />
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

            <div>
              <h2 className="text-[14px] font-semibold text-ink">Projects</h2>
              {projectsLoading ? (
                <div className="mt-3">
                  <LoadingSkeleton rows={2} />
                </div>
              ) : projectsError ? (
                <p className="mt-2.5 text-[13px] text-danger">
                  Projects could not be loaded. Check your connection and refresh.
                </p>
              ) : projects.length > 0 ? (
                <div className="mt-3 space-y-4">
                  {projects.map(project => {
                    // Prefer the feed's live copy when present so upvote and
                    // reply counts stay in sync with optimistic updates.
                    const live = feedPosts.find(post => post.id === project.id)
                    return <PostCard key={project.id} post={live ?? project} />
                  })}
                </div>
              ) : (
                <p className="mt-2.5 text-[13px] text-dim">
                  No project showcases yet. Students can share projects from the feed.
                </p>
              )}
            </div>
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
          <Loader2 className="h-8 w-8 animate-spin text-accent-text" />
        </div>
      }
    >
      <ProfileDetail params={params} />
    </Suspense>
  )
}
