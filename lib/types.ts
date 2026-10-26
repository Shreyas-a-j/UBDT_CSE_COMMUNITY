export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type UserRole = 'student' | 'faculty' | 'admin'
export type MemberType = 'student' | 'alumni' | 'faculty'
// 'verified' and 'approved' are the same approval state. The repo's original
// migration wrote 'verified'; the live UCC database and Phase 6.1 brief use
// 'approved'. Both are accepted so existing rows keep working either way.
export type FacultyStatus = 'none' | 'pending' | 'approved' | 'verified' | 'rejected'
export type ContactVisibility = 'private' | 'members' | 'public'
export type FacultyApplicationStatus = 'pending' | 'approved' | 'rejected'
export type EventType = 'Workshop' | 'Meeting' | 'Showcase' | 'Seminar' | 'Project Session'

export interface Profile {
  id: string
  email?: string | null
  usn: string | null
  name: string
  year: number | null
  branch: string
  section: string | null
  bio: string | null
  avatar_url: string | null
  thumbhash?: string | null
  skills: string[]
  interests: string[]
  role: UserRole
  faculty_status: FacultyStatus
  designation: string | null
  employee_id: string | null
  expertise: string[]
  // UCC 2.0: community identity is separate from authorisation. Optional on
  // the client type so older fixtures/queries remain valid; normalizeProfile
  // always supplies a value.
  member_type?: MemberType
  graduation_year?: number | null
  portfolio_url?: string | null
  github_url?: string | null
  linkedin_url?: string | null
  created_at: string
  updated_at?: string | null
}

/**
 * Private contact details live in public.profile_contacts, not on Profile:
 * profiles has a public SELECT policy, so a "private" column there would
 * still be readable. RLS on profile_contacts decides who sees each row.
 */
export interface ProfileContact {
  profile_id: string
  contact_email: string | null
  phone: string | null
  contact_visibility: ContactVisibility
  created_at: string
  updated_at?: string | null
}

export interface Event {
  id: string
  host_id: string
  title: string
  description: string
  type: EventType
  event_date: string
  event_time: string
  duration: number
  link: string | null
  target_years: number[]
  created_at: string
  host_name?: string
  host_usn?: string
  host_avatar?: string | null
  host_role?: UserRole
  /** The host's batch (`profiles.year`), or null when the host has none. */
  host_year?: number | null
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
  author_name?: string
  author_usn?: string
  author_avatar?: string | null
  author_year?: number | null
  author_role?: UserRole
  like_count?: number
  upvote_count?: number
  comment_count?: number
  /**
   * Active faculty pin, merged from public.discussion_pins. Absent/null when
   * the discussion is not pinned. A pin is active only while
   * `pin_expires_at` is in the future; the database applies the same rule.
   */
  pinned_by?: string | null
  pinned_at?: string | null
  pin_expires_at?: string | null
}

/** One row from public.discussion_pins. Expired/unpinned rows are history. */
export interface DiscussionPin {
  id: string
  discussion_id: string
  pinned_by: string
  pinned_at: string
  pin_expires_at: string
  unpinned_at: string | null
  unpinned_by?: string | null
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

export type NotificationType =
  | 'comment'
  | 'rsvp'
  | 'event_reminder'
  | 'like'
  | 'upvote'
  // The database trigger still emits 'message' rows (written by the mobile
  // client); the website has no messaging surface, so CommunityContext
  // filters these out of the rendered notification list.
  | 'message'
  | 'announcement'
  | 'faculty_decision'
  | 'event_published'

export interface Notification {
  id: string
  user_id: string
  type: NotificationType
  title: string
  body: string | null
  link: string | null
  read: boolean
  created_at: string
}

export interface Announcement {
  id: string
  author_id: string
  title: string
  body: string
  /** Public R2 URLs for the announcement's optional images (max 4). */
  image_urls: string[]
  created_at: string
  updated_at: string
  author_name?: string
  author_avatar?: string | null
  author_designation?: string | null
  /**
   * Raw reaction rows joined from public.announcement_reactions. Kept raw so
   * counts and the viewer's own reactions come from one source of truth
   * (see summarizeReactions in lib/logic/announcements.ts).
   */
  reactions: AnnouncementReactionRow[]
}

/** The small, fixed reaction set supported on announcements. */
export type AnnouncementReaction = 'thumbs_up' | 'heart' | 'party' | 'clap'

export interface AnnouncementReactionRow {
  user_id: string
  reaction: AnnouncementReaction
  created_at?: string | null
}

export interface FacultyApplication {
  id: string
  user_id: string
  full_name: string
  official_email: string
  department: string
  designation: string
  employee_id: string | null
  status: FacultyApplicationStatus
  reviewed_by: string | null
  reviewed_at: string | null
  review_notes: string | null
  created_at: string
  updated_at: string | null
}

export type FeedFilter = 'all' | 'events' | 'discussions' | 'showcases' | 'announcements'
export type YearFilter = 0 | 1 | 2 | 3 | 4
