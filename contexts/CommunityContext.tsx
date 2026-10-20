'use client'

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import {
  Profile, Event, Post, Comment, Notification, FeedFilter, YearFilter, Announcement, EventType,
} from '@/lib/types'
import { isEventUpcoming } from '@/lib/logic/events'
import { createClient } from '@/lib/supabase/client'
import { logSupabaseError } from '@/lib/supabase/errors'
import { useAuth } from '@/contexts/AuthContext'
import { normalizeProfile, profileWritableFields } from '@/lib/profile'
import { sanitizeText } from '@/lib/validation'

interface CommunityContextType {
  currentUser: Profile | null
  authLoading: boolean
  feedLoading: boolean
  feedError: string | null
  setCurrentUser: (profile: Profile | null) => void
  posts: Post[]
  events: Event[]
  comments: Comment[]
  announcements: Announcement[]
  notifications: Notification[]
  likedPostIds: Set<string>
  upvotedPostIds: Set<string>
  rsvpedEventIds: Set<string>
  feedFilter: FeedFilter
  setFeedFilter: (filter: FeedFilter) => void
  yearFilter: YearFilter
  setYearFilter: (year: YearFilter) => void
  searchQuery: string
  setSearchQuery: (query: string) => void
  createPost: (post: Omit<Post, 'id' | 'created_at' | 'like_count' | 'upvote_count' | 'comment_count'>) => Promise<void>
  createEvent: (event: Omit<Event, 'id' | 'created_at' | 'rsvp_count'>) => Promise<void>
  toggleLikePost: (postId: string) => Promise<void>
  toggleUpvotePost: (postId: string) => Promise<void>
  toggleRsvpEvent: (eventId: string) => Promise<void>
  addComment: (postId: string, body: string) => Promise<void>
  updateProfile: (updated: Partial<Profile>) => Promise<void>
  updatePost: (postId: string, updated: Partial<Post>) => Promise<void>
  /**
   * Deletes a post. Resolves `true` only when the database actually removed
   * the row — an RLS denial or other filter (and any network error) resolves
   * `false` with an error toast so the UI never optimistically removes a
   * record that still exists.
   */
  deletePost: (postId: string) => Promise<boolean>
  updateEvent: (eventId: string, updated: Partial<Event>) => Promise<void>
  /**
   * See deletePost — resolves `true` only when the event row was deleted.
   */
  deleteEvent: (eventId: string) => Promise<boolean>
  signOut: () => Promise<void>
  markNotificationAsRead: (id: string) => void
  markAllNotificationsAsRead: () => void
  isAuthModalOpen: boolean
  setIsAuthModalOpen: (open: boolean) => void
  isCreatePostOpen: boolean
  setIsCreatePostOpen: (open: boolean) => void
  isCreateEventOpen: boolean
  setIsCreateEventOpen: (open: boolean) => void
  isProfileModalOpen: boolean
  setIsProfileModalOpen: (open: boolean) => void
  selectedProfileForView: Profile | null
  setSelectedProfileForView: (profile: Profile | null) => void
  fetchData: () => Promise<void>
}

const CommunityContext = createContext<CommunityContextType | undefined>(undefined)

type EmbeddedProfile = {
  name?: string | null
  usn?: string | null
  avatar_url?: string | null
  year?: number | null
  role?: string | null
}

function countFromEmbed(value: unknown): number {
  if (Array.isArray(value) && value[0] && typeof value[0] === 'object' && 'count' in value[0]) {
    return Number((value[0] as { count: number }).count) || 0
  }
  return 0
}

function mapPost(row: Record<string, unknown>): Post {
  const author = (row.author ?? row.profiles) as EmbeddedProfile | null
  return {
    id: String(row.id),
    author_id: String(row.author_id),
    type: row.type === 'showcase' ? 'showcase' : 'discussion',
    title: String(row.title ?? ''),
    body: String(row.body ?? ''),
    image_url: (row.image_url as string | null) ?? null,
    github_url: (row.github_url as string | null) ?? null,
    demo_url: (row.demo_url as string | null) ?? null,
    tech_stack: Array.isArray(row.tech_stack) ? (row.tech_stack as string[]) : [],
    tags: Array.isArray(row.tags) ? (row.tags as string[]) : [],
    target_years: Array.isArray(row.target_years) ? (row.target_years as number[]) : [1, 2, 3, 4],
    created_at: String(row.created_at ?? new Date().toISOString()),
    author_name: author?.name || 'CSE Student',
    author_usn: author?.usn || '',
    author_year: author?.year ?? null,
    author_avatar: author?.avatar_url || null,
    author_role: author?.role === 'faculty' || author?.role === 'admin' ? author.role : 'student',
    like_count: countFromEmbed(row.likes) || Number(row.like_count) || 0,
    upvote_count: countFromEmbed(row.upvotes) || Number(row.upvote_count) || 0,
    comment_count: countFromEmbed(row.comments) || Number(row.comment_count) || 0,
  }
}

function mapEvent(row: Record<string, unknown>): Event {
  const host = (row.host ?? row.profiles) as EmbeddedProfile | null
  const allowed: EventType[] = ['Workshop', 'Meeting', 'Showcase', 'Seminar', 'Project Session']
  const type = allowed.includes(row.type as EventType) ? (row.type as EventType) : 'Workshop'
  return {
    id: String(row.id),
    host_id: String(row.host_id),
    title: String(row.title ?? ''),
    description: String(row.description ?? ''),
    type,
    event_date: String(row.event_date ?? ''),
    event_time: String(row.event_time ?? ''),
    duration: Number(row.duration) || 60,
    link: (row.link as string | null) ?? null,
    target_years: Array.isArray(row.target_years) ? (row.target_years as number[]) : [1, 2, 3, 4],
    created_at: String(row.created_at ?? new Date().toISOString()),
    host_name: host?.name || 'CSE Host',
    host_usn: host?.usn || '',
    host_avatar: host?.avatar_url || null,
    rsvp_count: countFromEmbed(row.event_rsvps) || Number(row.rsvp_count) || 0,
  }
}

export function CommunityProvider({ children }: { children: React.ReactNode }) {
  const supabase = useMemo(() => createClient(), [])
  const { profile, loading: authLoading, signOut: authSignOut, refreshProfile } = useAuth()

  const currentUser = profile
  const [posts, setPosts] = useState<Post[]>([])
  // Every event fetched from the database. "Upcoming" views render a
  // phase-filtered derivation of this state (see `events` below) so the
  // completed/live/upcoming rule is applied from a single shared definition.
  const [rawEvents, setRawEvents] = useState<Event[]>([])
  // A shared "now" clock, ticked every 30 s on the client, so events drop out
  // of upcoming lists at their own end instants — including events that were
  // still upcoming when the page loaded. It starts as null so the prerender
  // snapshot contains no unstable timestamp; it is set on mount before any
  // event data arrives (fetching is client-side only).
  const [now, setNow] = useState<Date | null>(null)
  const [comments, setComments] = useState<Comment[]>([])
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [feedLoading, setFeedLoading] = useState(true)
  const [feedError, setFeedError] = useState<string | null>(null)

  const [likedPostIds, setLikedPostIds] = useState<Set<string>>(new Set())
  const [upvotedPostIds, setUpvotedPostIds] = useState<Set<string>>(new Set())
  const [rsvpedEventIds, setRsvpedEventIds] = useState<Set<string>>(new Set())

  const [feedFilter, setFeedFilter] = useState<FeedFilter>('all')
  const [yearFilter, setYearFilter] = useState<YearFilter>(0)
  const [searchQuery, setSearchQuery] = useState('')

  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false)
  const [isCreatePostOpen, setIsCreatePostOpen] = useState(false)
  const [isCreateEventOpen, setIsCreateEventOpen] = useState(false)
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false)
  const [selectedProfileForView, setSelectedProfileForView] = useState<Profile | null>(null)

  const requireAuth = useCallback(() => {
    if (!currentUser) {
      setIsAuthModalOpen(true)
      return false
    }
    return true
  }, [currentUser])

  useEffect(() => {
    // Async initial set (the lint-safe pattern used across this codebase),
    // then a 30 s tick so phase transitions re-evaluate without refetching.
    queueMicrotask(() => setNow(new Date()))
    const timer = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(timer)
  }, [])

  // Single shared rule for upcoming-event visibility: every view feeding
  // off `events` (feed Events tab, SidebarRight widget, event cards) sees
  // only events whose end time is still ahead, while completed events stay
  // in the database and in management surfaces (e.g. the faculty dashboard).
  // Before the clock starts (prerender/first paint) nothing is hidden.
  const events = useMemo(
    () => (now === null ? rawEvents : rawEvents.filter(event => isEventUpcoming(event, now))),
    [rawEvents, now]
  )

  const fetchData = useCallback(async () => {
    setFeedLoading(true)
    const errors: string[] = []

    const postsQuery = supabase
      .from('posts')
      .select(`
        *,
        author:profiles!author_id (name, usn, avatar_url, year, role),
        likes (count),
        comments (count),
        upvotes (count)
      `)
      .order('created_at', { ascending: false })
      .limit(40)

    // Coarse, DB-side prune: restrict the fetch to events from the last two
    // days onward. The exact rules live in `lib/logic/events.ts`; this filter
    // only trims year-old completed events from the 40-row window so old rows
    // do not crowd out genuinely upcoming ones (results are ordered by date).
    const minEventDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10)

    const eventsQuery = supabase
      .from('events')
      .select(`
        *,
        host:profiles!host_id (name, usn, avatar_url, role),
        event_rsvps (count)
      `)
      .gte('event_date', minEventDate)
      .order('event_date', { ascending: true })
      .limit(40)

    const commentsQuery = supabase
      .from('comments')
      .select(`
        *,
        author:profiles!author_id (name, usn, avatar_url)
      `)
      .order('created_at', { ascending: true })
      .limit(200)

    const announcementsQuery = supabase
      .from('announcements')
      .select(`
        *,
        author:profiles!author_id (name, avatar_url, designation)
      `)
      .order('created_at', { ascending: false })
      .limit(30)

    let postsRes = await postsQuery
    if (postsRes.error) {
      postsRes = await supabase.from('posts').select('*').order('created_at', { ascending: false }).limit(40)
      if (postsRes.error) errors.push(`posts: ${postsRes.error.message}`)
    }
    if (postsRes.data) setPosts((postsRes.data as Record<string, unknown>[]).map(mapPost))

    let eventsRes = await eventsQuery
    if (eventsRes.error) {
      eventsRes = await supabase
        .from('events')
        .select('*')
        .gte('event_date', minEventDate)
        .order('event_date', { ascending: true })
        .limit(40)
      if (eventsRes.error) errors.push(`events: ${eventsRes.error.message}`)
    }
    if (eventsRes.data) setRawEvents((eventsRes.data as Record<string, unknown>[]).map(mapEvent))

    let commentsRes = await commentsQuery
    if (commentsRes.error) {
      commentsRes = await supabase.from('comments').select('*').order('created_at', { ascending: true }).limit(200)
      if (commentsRes.error) errors.push(`comments: ${commentsRes.error.message}`)
    }
    if (commentsRes.data) {
      setComments(
        (commentsRes.data as Record<string, unknown>[]).map(row => {
          const author = (row.author ?? row.profiles) as EmbeddedProfile | null
          return {
            id: String(row.id),
            post_id: String(row.post_id),
            author_id: String(row.author_id),
            body: String(row.body ?? ''),
            parent_id: (row.parent_id as string | null) ?? null,
            created_at: String(row.created_at ?? ''),
            author_name: author?.name || 'CSE Student',
            author_usn: author?.usn || '',
            author_avatar: author?.avatar_url || null,
          }
        })
      )
    }

    const announcementsRes = await announcementsQuery
    if (announcementsRes.error) {
      if (!announcementsRes.error.message.toLowerCase().includes('does not exist')) {
        errors.push(`announcements: ${announcementsRes.error.message}`)
      }
      setAnnouncements([])
    } else if (announcementsRes.data) {
      setAnnouncements(
        (announcementsRes.data as Record<string, unknown>[]).map(row => {
          const author = row.author as { name?: string; avatar_url?: string; designation?: string } | null
          return {
            id: String(row.id),
            author_id: String(row.author_id),
            title: String(row.title ?? ''),
            body: String(row.body ?? ''),
            created_at: String(row.created_at ?? ''),
            updated_at: String(row.updated_at ?? ''),
            author_name: author?.name,
            author_avatar: author?.avatar_url ?? null,
            author_designation: author?.designation ?? null,
          }
        })
      )
    }

    setFeedError(errors.length ? errors.join(' · ') : null)
    setFeedLoading(false)
  }, [supabase])

  const fetchUserState = useCallback(async (userId: string) => {
    const [likes, upvotes, rsvps, notifs] = await Promise.all([
      supabase.from('likes').select('post_id').eq('user_id', userId),
      supabase.from('upvotes').select('post_id').eq('user_id', userId),
      supabase.from('event_rsvps').select('event_id').eq('user_id', userId),
      supabase.from('notifications').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(40),
    ])
    if (likes.data) setLikedPostIds(new Set(likes.data.map(row => row.post_id as string)))
    if (upvotes.data) setUpvotedPostIds(new Set(upvotes.data.map(row => row.post_id as string)))
    if (rsvps.data) setRsvpedEventIds(new Set(rsvps.data.map(row => row.event_id as string)))
    if (notifs.data) setNotifications(notifs.data as Notification[])
  }, [supabase])

  useEffect(() => {
    queueMicrotask(() => fetchData())
  }, [fetchData])

  useEffect(() => {
    queueMicrotask(() => {
      if (currentUser?.id) {
        fetchUserState(currentUser.id)
      } else {
        setLikedPostIds(new Set())
        setUpvotedPostIds(new Set())
        setRsvpedEventIds(new Set())
        setNotifications([])
      }
    })
  }, [currentUser?.id, fetchUserState])

  useEffect(() => {
    if (!currentUser?.id) return
    const channel = supabase
      .channel(`notifications:${currentUser.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${currentUser.id}` },
        payload => {
          setNotifications(prev => [payload.new as Notification, ...prev].slice(0, 40))
        }
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [currentUser?.id, supabase])

  const signOut = async () => {
    await authSignOut()
  }

  const toggleLikePost = async (postId: string) => {
    if (!requireAuth() || !currentUser) return
    const isLiked = likedPostIds.has(postId)
    const nextLiked = new Set(likedPostIds)
    if (isLiked) nextLiked.delete(postId)
    else nextLiked.add(postId)
    setLikedPostIds(nextLiked)
    setPosts(prev => prev.map(p => p.id === postId
      ? { ...p, like_count: Math.max(0, (p.like_count ?? 0) + (isLiked ? -1 : 1)) }
      : p))

    const { error } = isLiked
      ? await supabase.from('likes').delete().eq('post_id', postId).eq('user_id', currentUser.id)
      : await supabase.from('likes').insert({ post_id: postId, user_id: currentUser.id })
    if (error) {
      toast.error(error.message)
      await fetchData()
      await fetchUserState(currentUser.id)
    }
  }

  const toggleUpvotePost = async (postId: string) => {
    if (!requireAuth() || !currentUser) return
    const isUpvoted = upvotedPostIds.has(postId)
    const next = new Set(upvotedPostIds)
    if (isUpvoted) next.delete(postId)
    else next.add(postId)
    setUpvotedPostIds(next)
    setPosts(prev => prev.map(p => p.id === postId
      ? { ...p, upvote_count: Math.max(0, (p.upvote_count ?? 0) + (isUpvoted ? -1 : 1)) }
      : p))
    const { error } = isUpvoted
      ? await supabase.from('upvotes').delete().eq('post_id', postId).eq('user_id', currentUser.id)
      : await supabase.from('upvotes').insert({ post_id: postId, user_id: currentUser.id })
    if (error) {
      toast.error(error.message)
      await fetchData()
      await fetchUserState(currentUser.id)
    }
  }

  const toggleRsvpEvent = async (eventId: string) => {
    if (!requireAuth() || !currentUser) return
    const isRsvped = rsvpedEventIds.has(eventId)
    const next = new Set(rsvpedEventIds)
    if (isRsvped) next.delete(eventId)
    else next.add(eventId)
    setRsvpedEventIds(next)
    setRawEvents(prev => prev.map(e => e.id === eventId
      ? { ...e, rsvp_count: Math.max(0, (e.rsvp_count ?? 0) + (isRsvped ? -1 : 1)) }
      : e))
    const { error } = isRsvped
      ? await supabase.from('event_rsvps').delete().eq('event_id', eventId).eq('user_id', currentUser.id)
      : await supabase.from('event_rsvps').insert({ event_id: eventId, user_id: currentUser.id })
    if (error) {
      toast.error(error.message)
      await fetchData()
      await fetchUserState(currentUser.id)
    }
  }

  const createPost = async (postData: Omit<Post, 'id' | 'created_at' | 'like_count' | 'upvote_count' | 'comment_count'>) => {
    if (!requireAuth() || !currentUser) return
    const { data, error } = await supabase.from('posts').insert({
      author_id: currentUser.id,
      type: postData.type,
      title: sanitizeText(postData.title, 200),
      body: sanitizeText(postData.body, 8000),
      image_url: postData.image_url,
      github_url: postData.github_url,
      demo_url: postData.demo_url,
      tech_stack: postData.tech_stack,
      tags: postData.tags,
      target_years: postData.target_years,
    }).select().single()
    if (error) {
      toast.error(error.message)
      return
    }
    toast.success('Post published')
    if (data) {
      setPosts(prev => [mapPost(data as Record<string, unknown>), ...prev])
    } else {
      await fetchData()
    }
  }

  const createEvent = async (eventData: Omit<Event, 'id' | 'created_at' | 'rsvp_count'>) => {
    if (!requireAuth() || !currentUser) return
    const { data, error } = await supabase.from('events').insert({
      host_id: currentUser.id,
      title: sanitizeText(eventData.title, 200),
      description: sanitizeText(eventData.description, 4000),
      type: eventData.type,
      event_date: eventData.event_date,
      event_time: eventData.event_time,
      duration: eventData.duration,
      link: eventData.link,
      target_years: eventData.target_years,
    }).select().single()
    if (error) {
      toast.error(error.message)
      return
    }
    toast.success('Event created')
    if (data) {
      const mapped = mapEvent(data as Record<string, unknown>)
      setRawEvents(prev => [mapped, ...prev])
      setRsvpedEventIds(prev => new Set(prev).add(mapped.id))
      await supabase.from('event_rsvps').insert({ event_id: mapped.id, user_id: currentUser.id })
    } else {
      await fetchData()
    }
  }

  const addComment = async (postId: string, body: string) => {
    if (!requireAuth() || !currentUser) return
    const text = sanitizeText(body, 2000)
    if (!text) return
    const { data, error } = await supabase.from('comments').insert({
      post_id: postId,
      author_id: currentUser.id,
      body: text,
    }).select().single()
    if (error) {
      toast.error(error.message)
      return
    }
    const newComment: Comment = {
      id: data?.id ?? `temp-${Date.now()}`,
      post_id: postId,
      author_id: currentUser.id,
      author_name: currentUser.name,
      author_usn: currentUser.usn || '',
      author_avatar: currentUser.avatar_url,
      body: text,
      parent_id: null,
      created_at: data?.created_at ?? new Date().toISOString(),
    }
    setComments(prev => [...prev, newComment])
    setPosts(prev => prev.map(p => p.id === postId ? { ...p, comment_count: (p.comment_count ?? 0) + 1 } : p))
  }

  const updateProfile = async (updated: Partial<Profile>) => {
    if (!currentUser) return
    const payload = profileWritableFields({ ...currentUser, ...updated })
    const { error } = await supabase.from('profiles').update(payload).eq('id', currentUser.id)
    if (error) {
      toast.error(error.message)
      return
    }
    toast.success('Profile updated')
    await refreshProfile()
    if (updated.avatar_url !== undefined || updated.name !== undefined) {
      setPosts(prev => prev.map(p => p.author_id === currentUser.id
        ? {
            ...p,
            ...(updated.avatar_url !== undefined ? { author_avatar: updated.avatar_url } : {}),
            ...(updated.name ? { author_name: updated.name } : {}),
          }
        : p))
    }
  }

  const updatePost = async (postId: string, updated: Partial<Post>) => {
    const { error } = await supabase.from('posts').update({
      title: updated.title,
      body: updated.body,
      tags: updated.tags,
      github_url: updated.github_url,
      demo_url: updated.demo_url,
      tech_stack: updated.tech_stack,
      target_years: updated.target_years,
    }).eq('id', postId)
    if (error) {
      toast.error(error.message)
      return
    }
    setPosts(prev => prev.map(p => (p.id === postId ? { ...p, ...updated } : p)))
  }

  const deletePost = async (postId: string): Promise<boolean> => {
    if (!currentUser) {
      setIsAuthModalOpen(true)
      return false
    }
    if (!postId) {
      console.error('[deletePost] aborted: no discussion id was supplied')
      return false
    }
    // `select()` asks PostgREST to return the deleted rows. A delete that is
    // filtered out — by RLS or anything else — resolves with no error and an
    // empty array, so "zero rows removed" must be treated as a failure and
    // trigger a feed resync instead of an optimistic (stale) UI update.
    const { data, error } = await supabase
      .from('posts')
      .delete()
      .eq('id', postId)
      .select('id')
    if (error) {
      logSupabaseError('[deletePost] delete error', error)
      toast.error(error.message)
      return false
    }
    if (!data || data.length === 0) {
      // Zero rows changed but the request "succeeded" — this happens when RLS
      // filters the delete (no policy match / no permission) or when the row
      // is already gone. Re-read the row as the current user to tell the two
      // states apart; neither must be reported to the user as a success.
      const { data: existing, error: checkError } = await supabase
        .from('posts')
        .select('id')
        .eq('id', postId)
        .maybeSingle()
      if (checkError) {
        logSupabaseError('[deletePost] existence check error', checkError)
      }
      // Supabase single() yields object|null; the test stub yields [row]|[].
      const rowExists = Array.isArray(existing) ? existing.length > 0 : Boolean(existing)
      if (!rowExists) {
        console.warn('[deletePost] zero rows deleted; row no longer exists — already gone', postId)
        toast('The discussion is already gone. The feed has been refreshed.')
        setPosts(prev => prev.filter(p => p.id !== postId))
        return true
      }
      console.warn(
        '[deletePost] zero rows deleted while the row is still readable — delete was denied by the database (RLS)',
        postId
      )
      toast.error(
        'The discussion could not be deleted. It may already be gone, or you may not have permission to delete it.'
      )
      await fetchData()
      return false
    }
    console.debug('[deletePost] deleted', postId)
    setPosts(prev => prev.filter(p => p.id !== postId))
    return true
  }

  const updateEvent = async (eventId: string, updated: Partial<Event>) => {
    const { error } = await supabase.from('events').update({
      title: updated.title,
      description: updated.description,
      type: updated.type,
      event_date: updated.event_date,
      event_time: updated.event_time,
      duration: updated.duration,
      link: updated.link,
      target_years: updated.target_years,
    }).eq('id', eventId)
    if (error) {
      toast.error(error.message)
      return
    }
    setRawEvents(prev => prev.map(e => e.id === eventId ? { ...e, ...updated } : e))
  }

  const deleteEvent = async (eventId: string): Promise<boolean> => {
    if (!currentUser) {
      setIsAuthModalOpen(true)
      return false
    }
    if (!eventId) {
      console.error('[deleteEvent] aborted: no event id was supplied')
      return false
    }
    // Same zero-row detection as deletePost: RLS ("Hosts can delete their
    // events") filters non-owned events out silently, so confirm the mutation
    // via the returned rows before touching local state.
    const { data, error } = await supabase
      .from('events')
      .delete()
      .eq('id', eventId)
      .select('id')
    if (error) {
      logSupabaseError('[deleteEvent] delete error', error)
      toast.error(error.message)
      return false
    }
    if (!data || data.length === 0) {
      const { data: existing, error: checkError } = await supabase
        .from('events')
        .select('id')
        .eq('id', eventId)
        .maybeSingle()
      if (checkError) {
        logSupabaseError('[deleteEvent] existence check error', checkError)
      }
      const rowExists = Array.isArray(existing) ? existing.length > 0 : Boolean(existing)
      if (!rowExists) {
        console.warn('[deleteEvent] zero rows deleted; row no longer exists — already gone', eventId)
        toast('The event is already gone. The feed has been refreshed.')
        setRawEvents(prev => prev.filter(e => e.id !== eventId))
        return true
      }
      console.warn(
        '[deleteEvent] zero rows deleted while the row is still readable — delete was denied by the database (RLS)',
        eventId
      )
      toast.error(
        'The event could not be deleted. It may already be gone, or you may not have permission to delete it.'
      )
      await fetchData()
      return false
    }
    console.debug('[deleteEvent] deleted', eventId)
    setRawEvents(prev => prev.filter(e => e.id !== eventId))
    return true
  }

  const markNotificationAsRead = (id: string) => {
    setNotifications(prev => prev.map(n => (n.id === id ? { ...n, read: true } : n)))
    void supabase.from('notifications').update({ read: true }).eq('id', id)
  }

  const markAllNotificationsAsRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })))
    if (currentUser) {
      void supabase.from('notifications').update({ read: true }).eq('user_id', currentUser.id).eq('read', false)
    }
  }

  return (
    <CommunityContext.Provider
      value={{
        currentUser,
        authLoading,
        feedLoading,
        feedError,
        setCurrentUser: () => {},
        posts,
        events,
        comments,
        announcements,
        notifications,
        likedPostIds,
        upvotedPostIds,
        rsvpedEventIds,
        feedFilter,
        setFeedFilter,
        yearFilter,
        setYearFilter,
        searchQuery,
        setSearchQuery,
        createPost,
        createEvent,
        toggleLikePost,
        toggleUpvotePost,
        toggleRsvpEvent,
        addComment,
        updateProfile,
        updatePost,
        deletePost,
        updateEvent,
        deleteEvent,
        signOut,
        markNotificationAsRead,
        markAllNotificationsAsRead,
        isAuthModalOpen,
        setIsAuthModalOpen,
        isCreatePostOpen,
        setIsCreatePostOpen,
        isCreateEventOpen,
        setIsCreateEventOpen,
        isProfileModalOpen,
        setIsProfileModalOpen,
        selectedProfileForView,
        setSelectedProfileForView,
        fetchData,
      }}
    >
      {children}
    </CommunityContext.Provider>
  )
}

export function useCommunity() {
  const context = useContext(CommunityContext)
  if (!context) {
    throw new Error('useCommunity must be used within a CommunityProvider')
  }
  return context
}

export function peekNormalizeProfile(row: Record<string, unknown>) {
  return normalizeProfile(row)
}
