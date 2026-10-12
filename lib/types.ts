export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

/**
 * Maps to the Supabase PostgreSQL user_profiles table.
 */
export interface Profile {
  id: string
  usn: string
  name: string
  year: number
  branch?: string
  bio: string | null
  avatar_url: string | null
  thumbhash?: string | null
  skills: string[]
  created_at: string
  updated_at?: string
}

export interface Event {
  id: string
  host_id: string
  title: string
  description: string
  type: 'Workshop' | 'Meeting' | 'Showcase'
  event_date: string
  event_time: string
  duration: number
  link: string | null
  target_years: number[]
  created_at: string
  // Joined fields
  host_name?: string
  host_usn?: string
  host_avatar?: string | null
  rsvp_count?: number
}

export interface EventRsvp {
  id: string
  event_id: string
  user_id: string
  created_at: string
}

export interface Post {
  id: string
  author_id: string
  type: 'discussion' | 'showcase'
  title: string
  body: string
  image_url: string | null
  github_url: string | null
  demo_url: string | null
  tech_stack: string[]
  tags: string[]
  target_years: number[]
  created_at: string
  // Joined fields
  author_name?: string
  author_usn?: string
  author_avatar?: string | null
  author_year?: number
  like_count?: number
  upvote_count?: number
  comment_count?: number
}

export interface Comment {
  id: string
  post_id: string
  author_id: string
  body: string
  parent_id: string | null
  created_at: string
  author_name?: string
  author_avatar?: string | null
  author_usn?: string
}

export interface Notification {
  id: string
  user_id: string
  type: 'comment' | 'rsvp' | 'event_reminder' | 'like' | 'upvote'
  title: string
  body: string | null
  link: string | null
  read: boolean
  created_at: string
}

export type FeedFilter = 'all' | 'events' | 'discussions' | 'showcases'
export type YearFilter = 0 | 1 | 2 | 3 | 4  // 0 = all years
