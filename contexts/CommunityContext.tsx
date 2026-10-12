'use client'

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { Profile, Event, Post, Comment, Notification, FeedFilter, YearFilter } from '@/lib/types'
import { createClient } from '@/lib/supabase/client'

interface CommunityContextType {
  currentUser: Profile | null
  setCurrentUser: (profile: Profile | null) => void
  posts: Post[]
  events: Event[]
  comments: Comment[]
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
  // Actions
  createPost: (post: Omit<Post, 'id' | 'created_at' | 'like_count' | 'upvote_count' | 'comment_count'>) => Promise<void>
  createEvent: (event: Omit<Event, 'id' | 'created_at' | 'rsvp_count'>) => Promise<void>
  toggleLikePost: (postId: string) => Promise<void>
  toggleUpvotePost: (postId: string) => Promise<void>
  toggleRsvpEvent: (eventId: string) => Promise<void>
  addComment: (postId: string, body: string) => Promise<void>
  updateProfile: (updated: Partial<Profile>) => Promise<void>
  updatePost: (postId: string, updated: Partial<Post>) => Promise<void>
  deletePost: (postId: string) => Promise<void>
  updateEvent: (eventId: string, updated: Partial<Event>) => Promise<void>
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

const STORAGE_KEYS = {
  CURRENT_USER: 'ubdt_community_user',
  POSTS: 'ubdt_community_posts',
  EVENTS: 'ubdt_community_events',
  COMMENTS: 'ubdt_community_comments',
  LIKED: 'ubdt_community_liked',
  UPVOTED: 'ubdt_community_upvoted',
  RSVPED: 'ubdt_community_rsvped',
  NOTIFICATIONS: 'ubdt_community_notifications',
}

export function CommunityProvider({ children }: { children: React.ReactNode }) {
  const supabase = createClient()

  // Clean empty state — No dummy data
  const [currentUser, setCurrentUser] = useState<Profile | null>(null)
  const [posts, setPosts] = useState<Post[]>([])
  const [events, setEvents] = useState<Event[]>([])
  const [comments, setComments] = useState<Comment[]>([])
  const [notifications, setNotifications] = useState<Notification[]>([])

  const [likedPostIds, setLikedPostIds] = useState<Set<string>>(new Set())
  const [upvotedPostIds, setUpvotedPostIds] = useState<Set<string>>(new Set())
  const [rsvpedEventIds, setRsvpedEventIds] = useState<Set<string>>(new Set())

  const [feedFilter, setFeedFilter] = useState<FeedFilter>('all')
  const [yearFilter, setYearFilter] = useState<YearFilter>(0)
  const [searchQuery, setSearchQuery] = useState<string>('')

  // Modals state
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false)
  const [isCreatePostOpen, setIsCreatePostOpen] = useState(false)
  const [isCreateEventOpen, setIsCreateEventOpen] = useState(false)
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false)
  const [selectedProfileForView, setSelectedProfileForView] = useState<Profile | null>(null)

  // Fetch real data from Supabase or fallback to local cache
  const fetchData = useCallback(async () => {
    try {
      // Fetch posts
      const { data: postsData, error: postsError } = await supabase
        .from('posts')
        .select(`
          *,
          profiles:author_id (name, usn, avatar_url, year)
        `)
        .order('created_at', { ascending: false })

      if (!postsError && postsData) {
        const mappedPosts: Post[] = postsData.map((p: any) => ({
          ...p,
          author_name: p.profiles?.name || 'CSE Student',
          author_usn: p.profiles?.usn || '',
          author_year: p.profiles?.year || 1,
          author_avatar: p.profiles?.avatar_url || null,
        }))
        setPosts(mappedPosts)
      } else {
        // Fallback to locally saved posts if any
        const cached = localStorage.getItem(STORAGE_KEYS.POSTS)
        if (cached) setPosts(JSON.parse(cached))
      }

      // Fetch events
      const { data: eventsData, error: eventsError } = await supabase
        .from('events')
        .select(`
          *,
          profiles:host_id (name, usn, avatar_url)
        `)
        .order('event_date', { ascending: true })

      if (!eventsError && eventsData) {
        const mappedEvents: Event[] = eventsData.map((e: any) => ({
          ...e,
          host_name: e.profiles?.name || 'CSE Host',
          host_usn: e.profiles?.usn || '',
          host_avatar: e.profiles?.avatar_url || null,
        }))
        setEvents(mappedEvents)
      } else {
        const cached = localStorage.getItem(STORAGE_KEYS.EVENTS)
        if (cached) setEvents(JSON.parse(cached))
      }

      // Fetch comments
      const { data: commentsData, error: commentsError } = await supabase
        .from('comments')
        .select(`
          *,
          profiles:author_id (name, usn, avatar_url)
        `)
        .order('created_at', { ascending: true })

      if (!commentsError && commentsData) {
        const mappedComments: Comment[] = commentsData.map((c: any) => ({
          ...c,
          author_name: c.profiles?.name || 'CSE Student',
          author_usn: c.profiles?.usn || '',
          author_avatar: c.profiles?.avatar_url || null,
        }))
        setComments(mappedComments)
      } else {
        const cached = localStorage.getItem(STORAGE_KEYS.COMMENTS)
        if (cached) setComments(JSON.parse(cached))
      }
    } catch {
      // In case Supabase network fails or tables are not created yet
      const cachedPosts = localStorage.getItem(STORAGE_KEYS.POSTS)
      if (cachedPosts) setPosts(JSON.parse(cachedPosts))
      const cachedEvents = localStorage.getItem(STORAGE_KEYS.EVENTS)
      if (cachedEvents) setEvents(JSON.parse(cachedEvents))
      const cachedComments = localStorage.getItem(STORAGE_KEYS.COMMENTS)
      if (cachedComments) setComments(JSON.parse(cachedComments))
    }
  }, [supabase])

  // Hydrate user and data on mount
  useEffect(() => {
    // Check Supabase session first
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        supabase
          .from('user_profiles')
          .select('*')
          .eq('id', session.user.id)
          .single()
          .then(({ data, error }) => {
            if (!error && data) {
              setCurrentUser(data)
              localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(data))
            } else {
              // Try local user cache
              const cachedUser = localStorage.getItem(STORAGE_KEYS.CURRENT_USER)
              if (cachedUser) setCurrentUser(JSON.parse(cachedUser))
            }
          })
      } else {
        const cachedUser = localStorage.getItem(STORAGE_KEYS.CURRENT_USER)
        if (cachedUser) setCurrentUser(JSON.parse(cachedUser))
      }
    })

    // Hydrate local interaction sets
    try {
      const cachedLiked = localStorage.getItem(STORAGE_KEYS.LIKED)
      if (cachedLiked) setLikedPostIds(new Set(JSON.parse(cachedLiked)))

      const cachedUpvoted = localStorage.getItem(STORAGE_KEYS.UPVOTED)
      if (cachedUpvoted) setUpvotedPostIds(new Set(JSON.parse(cachedUpvoted)))

      const cachedRsvped = localStorage.getItem(STORAGE_KEYS.RSVPED)
      if (cachedRsvped) setRsvpedEventIds(new Set(JSON.parse(cachedRsvped)))

      const cachedNotifs = localStorage.getItem(STORAGE_KEYS.NOTIFICATIONS)
      if (cachedNotifs) setNotifications(JSON.parse(cachedNotifs))
    } catch {}

    fetchData()
  }, [fetchData, supabase])

  const saveUser = (user: Profile | null) => {
    setCurrentUser(user)
    if (user) {
      try { localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(user)) } catch {}
    } else {
      try { localStorage.removeItem(STORAGE_KEYS.CURRENT_USER) } catch {}
    }
  }

  const signOut = async () => {
    await supabase.auth.signOut().catch(() => {})
    saveUser(null)
  }

  const toggleLikePost = async (postId: string) => {
    if (!currentUser) {
      setIsAuthModalOpen(true)
      return
    }

    const isLiked = likedPostIds.has(postId)
    const nextLiked = new Set(likedPostIds)

    if (isLiked) {
      nextLiked.delete(postId)
    } else {
      nextLiked.add(postId)
    }
    setLikedPostIds(nextLiked)
    try { localStorage.setItem(STORAGE_KEYS.LIKED, JSON.stringify(Array.from(nextLiked))) } catch {}

    // Update local state
    const updated = posts.map(p => {
      if (p.id === postId) {
        const count = p.like_count ?? 0
        return { ...p, like_count: isLiked ? Math.max(0, count - 1) : count + 1 }
      }
      return p
    })
    setPosts(updated)
    try { localStorage.setItem(STORAGE_KEYS.POSTS, JSON.stringify(updated)) } catch {}

    // Sync with Supabase
    try {
      if (isLiked) {
        await supabase.from('likes').delete().eq('post_id', postId).eq('user_id', currentUser.id)
      } else {
        await supabase.from('likes').insert({ post_id: postId, user_id: currentUser.id })
      }
    } catch {}
  }

  const toggleUpvotePost = async (postId: string) => {
    if (!currentUser) {
      setIsAuthModalOpen(true)
      return
    }

    const isUpvoted = upvotedPostIds.has(postId)
    const nextUpvoted = new Set(upvotedPostIds)

    if (isUpvoted) {
      nextUpvoted.delete(postId)
    } else {
      nextUpvoted.add(postId)
    }
    setUpvotedPostIds(nextUpvoted)
    try { localStorage.setItem(STORAGE_KEYS.UPVOTED, JSON.stringify(Array.from(nextUpvoted))) } catch {}

    const updated = posts.map(p => {
      if (p.id === postId) {
        const count = p.upvote_count ?? 0
        return { ...p, upvote_count: isUpvoted ? Math.max(0, count - 1) : count + 1 }
      }
      return p
    })
    setPosts(updated)
    try { localStorage.setItem(STORAGE_KEYS.POSTS, JSON.stringify(updated)) } catch {}

    try {
      if (isUpvoted) {
        await supabase.from('upvotes').delete().eq('post_id', postId).eq('user_id', currentUser.id)
      } else {
        await supabase.from('upvotes').insert({ post_id: postId, user_id: currentUser.id })
      }
    } catch {}
  }

  const toggleRsvpEvent = async (eventId: string) => {
    if (!currentUser) {
      setIsAuthModalOpen(true)
      return
    }

    const isRsvped = rsvpedEventIds.has(eventId)
    const nextRsvped = new Set(rsvpedEventIds)

    if (isRsvped) {
      nextRsvped.delete(eventId)
    } else {
      nextRsvped.add(eventId)
    }
    setRsvpedEventIds(nextRsvped)
    try { localStorage.setItem(STORAGE_KEYS.RSVPED, JSON.stringify(Array.from(nextRsvped))) } catch {}

    const updated = events.map(e => {
      if (e.id === eventId) {
        const count = e.rsvp_count ?? 0
        return { ...e, rsvp_count: isRsvped ? Math.max(0, count - 1) : count + 1 }
      }
      return e
    })
    setEvents(updated)
    try { localStorage.setItem(STORAGE_KEYS.EVENTS, JSON.stringify(updated)) } catch {}

    try {
      if (isRsvped) {
        await supabase.from('event_rsvps').delete().eq('event_id', eventId).eq('user_id', currentUser.id)
      } else {
        await supabase.from('event_rsvps').insert({ event_id: eventId, user_id: currentUser.id })
      }
    } catch {}
  }

  const createPost = async (postData: Omit<Post, 'id' | 'created_at' | 'like_count' | 'upvote_count' | 'comment_count'>) => {
    if (!currentUser) {
      setIsAuthModalOpen(true)
      return
    }

    const newPost: Post = {
      ...postData,
      id: `post-${Date.now()}`,
      created_at: new Date().toISOString(),
      author_id: currentUser.id,
      author_name: currentUser.name,
      author_usn: currentUser.usn,
      author_year: currentUser.year,
      author_avatar: currentUser.avatar_url,
      like_count: 0,
      upvote_count: 0,
      comment_count: 0,
    }

    const nextPosts = [newPost, ...posts]
    setPosts(nextPosts)
    try { localStorage.setItem(STORAGE_KEYS.POSTS, JSON.stringify(nextPosts)) } catch {}

    // Insert to Supabase if available
    try {
      await supabase.from('posts').insert({
        author_id: currentUser.id,
        type: postData.type,
        title: postData.title,
        body: postData.body,
        image_url: postData.image_url,
        github_url: postData.github_url,
        demo_url: postData.demo_url,
        tech_stack: postData.tech_stack,
        tags: postData.tags,
        target_years: postData.target_years,
      })
    } catch {}
  }

  const createEvent = async (eventData: Omit<Event, 'id' | 'created_at' | 'rsvp_count'>) => {
    if (!currentUser) {
      setIsAuthModalOpen(true)
      return
    }

    const newEvent: Event = {
      ...eventData,
      id: `event-${Date.now()}`,
      created_at: new Date().toISOString(),
      host_id: currentUser.id,
      host_name: currentUser.name,
      host_usn: currentUser.usn,
      host_avatar: currentUser.avatar_url,
      rsvp_count: 1,
    }

    const nextEvents = [newEvent, ...events]
    setEvents(nextEvents)
    try { localStorage.setItem(STORAGE_KEYS.EVENTS, JSON.stringify(nextEvents)) } catch {}

    const nextRsvped = new Set(rsvpedEventIds)
    nextRsvped.add(newEvent.id)
    setRsvpedEventIds(nextRsvped)
    try { localStorage.setItem(STORAGE_KEYS.RSVPED, JSON.stringify(Array.from(nextRsvped))) } catch {}

    try {
      await supabase.from('events').insert({
        host_id: currentUser.id,
        title: eventData.title,
        description: eventData.description,
        type: eventData.type,
        event_date: eventData.event_date,
        event_time: eventData.event_time,
        duration: eventData.duration,
        link: eventData.link,
        target_years: eventData.target_years,
      })
    } catch {}
  }

  const addComment = async (postId: string, body: string) => {
    if (!currentUser) {
      setIsAuthModalOpen(true)
      return
    }

    const newComment: Comment = {
      id: `comment-${Date.now()}`,
      post_id: postId,
      author_id: currentUser.id,
      author_name: currentUser.name,
      author_usn: currentUser.usn,
      author_avatar: currentUser.avatar_url,
      body,
      parent_id: null,
      created_at: new Date().toISOString(),
    }

    const nextComments = [...comments, newComment]
    setComments(nextComments)
    try { localStorage.setItem(STORAGE_KEYS.COMMENTS, JSON.stringify(nextComments)) } catch {}

    const updated = posts.map(p => {
      if (p.id === postId) {
        return { ...p, comment_count: (p.comment_count ?? 0) + 1 }
      }
      return p
    })
    setPosts(updated)
    try { localStorage.setItem(STORAGE_KEYS.POSTS, JSON.stringify(updated)) } catch {}

    try {
      await supabase.from('comments').insert({
        post_id: postId,
        author_id: currentUser.id,
        body,
      })
    } catch {}
  }

  const updateProfile = async (updated: Partial<Profile>) => {
    if (!currentUser) return
    const newUser = { ...currentUser, ...updated }
    saveUser(newUser)
    try {
      await supabase.from('user_profiles').update({
        name: newUser.name, bio: newUser.bio, avatar_url: newUser.avatar_url, skills: newUser.skills,
      }).eq('id', currentUser.id)
    } catch {}
  }

  const updatePost = async (postId: string, updated: Partial<Post>) => {
    const next = posts.map(p => (p.id === postId ? { ...p, ...updated } : p))
    setPosts(next)
    try { localStorage.setItem(STORAGE_KEYS.POSTS, JSON.stringify(next)) } catch {}
    try {
      await supabase.from('posts').update({
        title: updated.title,
        body: updated.body,
        tags: updated.tags,
        github_url: updated.github_url,
        demo_url: updated.demo_url,
        tech_stack: updated.tech_stack,
        target_years: updated.target_years,
      }).eq('id', postId)
    } catch {}
  }

  const deletePost = async (postId: string) => {
    const next = posts.filter(p => p.id !== postId)
    setPosts(next)
    try { localStorage.setItem(STORAGE_KEYS.POSTS, JSON.stringify(next)) } catch {}
    try {
      await supabase.from('posts').delete().eq('id', postId)
    } catch {}
  }

  const updateEvent = async (eventId: string, updated: Partial<Event>) => {
    const next = events.map(e => e.id === eventId ? { ...e, ...updated } : e)
    setEvents(next)
    try { localStorage.setItem(STORAGE_KEYS.EVENTS, JSON.stringify(next)) } catch {}
    try {
      await supabase.from('events').update({
        title: updated.title,
        description: updated.description,
        type: updated.type,
        event_date: updated.event_date,
        event_time: updated.event_time,
        duration: updated.duration,
        link: updated.link,
        target_years: updated.target_years,
      }).eq('id', eventId)
    } catch {}
  }

  const markNotificationAsRead = (id: string) => {
    const updated = notifications.map(n => (n.id === id ? { ...n, read: true } : n))
    setNotifications(updated)
    try { localStorage.setItem(STORAGE_KEYS.NOTIFICATIONS, JSON.stringify(updated)) } catch {}
  }

  const markAllNotificationsAsRead = () => {
    const updated = notifications.map(n => ({ ...n, read: true }))
    setNotifications(updated)
    try { localStorage.setItem(STORAGE_KEYS.NOTIFICATIONS, JSON.stringify(updated)) } catch {}
  }

  return (
    <CommunityContext.Provider
      value={{
        currentUser,
        setCurrentUser: saveUser,
        posts,
        events,
        comments,
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
