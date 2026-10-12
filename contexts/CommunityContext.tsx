'use client'

import React, { createContext, useContext, useEffect, useState } from 'react'
import { Profile, Event, Post, Comment, Notification, FeedFilter, YearFilter } from '@/lib/types'
import {
  MOCK_PROFILES,
  MOCK_EVENTS,
  MOCK_POSTS,
  MOCK_COMMENTS,
  MOCK_NOTIFICATIONS,
} from '@/lib/mock-data'

interface CommunityContextType {
  currentUser: Profile
  allProfiles: Profile[]
  setCurrentUser: (profile: Profile) => void
  switchUserByYear: (year: number) => void
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
  createPost: (post: Omit<Post, 'id' | 'created_at' | 'like_count' | 'upvote_count' | 'comment_count'>) => void
  createEvent: (event: Omit<Event, 'id' | 'created_at' | 'rsvp_count'>) => void
  toggleLikePost: (postId: string) => void
  toggleUpvotePost: (postId: string) => void
  toggleRsvpEvent: (eventId: string) => void
  addComment: (postId: string, body: string) => void
  updateProfile: (updated: Partial<Profile>) => void
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
  resetToDefaultData: () => void
}

const CommunityContext = createContext<CommunityContextType | undefined>(undefined)

const STORAGE_KEYS = {
  CURRENT_USER: 'ubdt_community_current_user_v1',
  PROFILES: 'ubdt_community_profiles_v1',
  POSTS: 'ubdt_community_posts_v1',
  EVENTS: 'ubdt_community_events_v1',
  COMMENTS: 'ubdt_community_comments_v1',
  LIKED: 'ubdt_community_liked_v1',
  UPVOTED: 'ubdt_community_upvoted_v1',
  RSVPED: 'ubdt_community_rsvped_v1',
  NOTIFICATIONS: 'ubdt_community_notifications_v1',
}

export function CommunityProvider({ children }: { children: React.ReactNode }) {
  // Initialize with 3rd year student Priyanka by default (active leader)
  const [currentUser, setCurrentUser] = useState<Profile>(MOCK_PROFILES[1])
  const [allProfiles, setAllProfiles] = useState<Profile[]>(MOCK_PROFILES)
  const [posts, setPosts] = useState<Post[]>(MOCK_POSTS)
  const [events, setEvents] = useState<Event[]>(MOCK_EVENTS)
  const [comments, setComments] = useState<Comment[]>(MOCK_COMMENTS)
  const [notifications, setNotifications] = useState<Notification[]>(MOCK_NOTIFICATIONS)

  const [likedPostIds, setLikedPostIds] = useState<Set<string>>(new Set(['post-disc-1', 'post-showcase-1']))
  const [upvotedPostIds, setUpvotedPostIds] = useState<Set<string>>(new Set(['post-showcase-1', 'post-showcase-5']))
  const [rsvpedEventIds, setRsvpedEventIds] = useState<Set<string>>(new Set(['event-1', 'event-2']))

  const [feedFilter, setFeedFilter] = useState<FeedFilter>('all')
  const [yearFilter, setYearFilter] = useState<YearFilter>(0)
  const [searchQuery, setSearchQuery] = useState<string>('')

  // Modals state
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false)
  const [isCreatePostOpen, setIsCreatePostOpen] = useState(false)
  const [isCreateEventOpen, setIsCreateEventOpen] = useState(false)
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false)
  const [selectedProfileForView, setSelectedProfileForView] = useState<Profile | null>(null)

  // Hydrate from localStorage once on client
  useEffect(() => {
    try {
      const storedPosts = localStorage.getItem(STORAGE_KEYS.POSTS)
      if (storedPosts) setPosts(JSON.parse(storedPosts))

      const storedEvents = localStorage.getItem(STORAGE_KEYS.EVENTS)
      if (storedEvents) setEvents(JSON.parse(storedEvents))

      const storedComments = localStorage.getItem(STORAGE_KEYS.COMMENTS)
      if (storedComments) setComments(JSON.parse(storedComments))

      const storedProfiles = localStorage.getItem(STORAGE_KEYS.PROFILES)
      if (storedProfiles) setAllProfiles(JSON.parse(storedProfiles))

      const storedUser = localStorage.getItem(STORAGE_KEYS.CURRENT_USER)
      if (storedUser) setCurrentUser(JSON.parse(storedUser))

      const storedLiked = localStorage.getItem(STORAGE_KEYS.LIKED)
      if (storedLiked) setLikedPostIds(new Set(JSON.parse(storedLiked)))

      const storedUpvoted = localStorage.getItem(STORAGE_KEYS.UPVOTED)
      if (storedUpvoted) setUpvotedPostIds(new Set(JSON.parse(storedUpvoted)))

      const storedRsvped = localStorage.getItem(STORAGE_KEYS.RSVPED)
      if (storedRsvped) setRsvpedEventIds(new Set(JSON.parse(storedRsvped)))

      const storedNotifs = localStorage.getItem(STORAGE_KEYS.NOTIFICATIONS)
      if (storedNotifs) setNotifications(JSON.parse(storedNotifs))
    } catch {
      // LocalStorage access fails in private modes or during SSR
    }
  }, [])

  // Sync back to localStorage helpers
  const savePosts = (newPosts: Post[]) => {
    setPosts(newPosts)
    try { localStorage.setItem(STORAGE_KEYS.POSTS, JSON.stringify(newPosts)) } catch {}
  }

  const saveEvents = (newEvents: Event[]) => {
    setEvents(newEvents)
    try { localStorage.setItem(STORAGE_KEYS.EVENTS, JSON.stringify(newEvents)) } catch {}
  }

  const saveComments = (newComments: Comment[]) => {
    setComments(newComments)
    try { localStorage.setItem(STORAGE_KEYS.COMMENTS, JSON.stringify(newComments)) } catch {}
  }

  const saveUser = (user: Profile) => {
    setCurrentUser(user)
    try { localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(user)) } catch {}
  }

  const switchUserByYear = (year: number) => {
    const found = allProfiles.find(p => p.year === year)
    if (found) {
      saveUser(found)
    }
  }

  const toggleLikePost = (postId: string) => {
    const isLiked = likedPostIds.has(postId)
    const nextLiked = new Set(likedPostIds)

    if (isLiked) {
      nextLiked.delete(postId)
    } else {
      nextLiked.add(postId)
    }
    setLikedPostIds(nextLiked)
    try { localStorage.setItem(STORAGE_KEYS.LIKED, JSON.stringify(Array.from(nextLiked))) } catch {}

    const updated = posts.map(p => {
      if (p.id === postId) {
        const count = p.like_count ?? 0
        return { ...p, like_count: isLiked ? Math.max(0, count - 1) : count + 1 }
      }
      return p
    })
    savePosts(updated)
  }

  const toggleUpvotePost = (postId: string) => {
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
    savePosts(updated)
  }

  const toggleRsvpEvent = (eventId: string) => {
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
    saveEvents(updated)
  }

  const createPost = (postData: Omit<Post, 'id' | 'created_at' | 'like_count' | 'upvote_count' | 'comment_count'>) => {
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
    savePosts([newPost, ...posts])
  }

  const createEvent = (eventData: Omit<Event, 'id' | 'created_at' | 'rsvp_count'>) => {
    const newEvent: Event = {
      ...eventData,
      id: `event-${Date.now()}`,
      created_at: new Date().toISOString(),
      host_id: currentUser.id,
      host_name: currentUser.name,
      host_usn: currentUser.usn,
      host_avatar: currentUser.avatar_url,
      rsvp_count: 1, // Auto RSVP creator
    }
    saveEvents([newEvent, ...events])

    // Auto add to RSVPs
    const nextRsvped = new Set(rsvpedEventIds)
    nextRsvped.add(newEvent.id)
    setRsvpedEventIds(nextRsvped)
    try { localStorage.setItem(STORAGE_KEYS.RSVPED, JSON.stringify(Array.from(nextRsvped))) } catch {}
  }

  const addComment = (postId: string, body: string) => {
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
    saveComments([newComment, ...comments])

    // Increase post comment count
    const updated = posts.map(p => {
      if (p.id === postId) {
        return { ...p, comment_count: (p.comment_count ?? 0) + 1 }
      }
      return p
    })
    savePosts(updated)
  }

  const updateProfile = (updated: Partial<Profile>) => {
    const newUser = { ...currentUser, ...updated }
    saveUser(newUser)

    const updatedProfiles = allProfiles.map(p => (p.id === newUser.id ? newUser : p))
    setAllProfiles(updatedProfiles)
    try { localStorage.setItem(STORAGE_KEYS.PROFILES, JSON.stringify(updatedProfiles)) } catch {}
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

  const resetToDefaultData = () => {
    localStorage.clear()
    setPosts(MOCK_POSTS)
    setEvents(MOCK_EVENTS)
    setComments(MOCK_COMMENTS)
    setAllProfiles(MOCK_PROFILES)
    setCurrentUser(MOCK_PROFILES[1])
    setLikedPostIds(new Set(['post-disc-1', 'post-showcase-1']))
    setUpvotedPostIds(new Set(['post-showcase-1', 'post-showcase-5']))
    setRsvpedEventIds(new Set(['event-1', 'event-2']))
    setNotifications(MOCK_NOTIFICATIONS)
  }

  return (
    <CommunityContext.Provider
      value={{
        currentUser,
        allProfiles,
        setCurrentUser: saveUser,
        switchUserByYear,
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
        resetToDefaultData,
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
