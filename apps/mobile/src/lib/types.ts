/**
 * UCC domain types — ported from the web app's `lib/types.ts`, which is
 * framework-free TypeScript and safe for React Native. Kept in sync manually;
 * the web app remains the source of truth for column meanings.
 */

export type UserRole = 'student' | 'faculty' | 'admin';
export type FacultyStatus = 'none' | 'pending' | 'approved' | 'verified' | 'rejected';
export type MemberType = 'student' | 'faculty' | 'alumni';
export type EventType = 'Workshop' | 'Meeting' | 'Showcase' | 'Seminar' | 'Project Session';
export type PostType = 'discussion' | 'showcase';
export type FeedFilter = 'all' | 'discussions' | 'showcases' | 'events' | 'announcements';
export type AnnouncementReaction = 'thumbs_up' | 'heart' | 'party' | 'clap';

export interface Profile {
  id: string;
  email?: string | null;
  usn: string | null;
  name: string;
  year: number | null;
  branch: string;
  section: string | null;
  bio: string | null;
  avatar_url: string | null;
  thumbhash?: string | null;
  skills: string[];
  interests: string[];
  role: UserRole;
  faculty_status: FacultyStatus;
  designation: string | null;
  employee_id: string | null;
  expertise: string[];
  /** UCC 2.0 community identity. `role` remains the authorisation field. */
  member_type: MemberType;
  graduation_year: number | null;
  portfolio_url: string | null;
  github_url: string | null;
  linkedin_url: string | null;
  created_at: string;
  updated_at?: string | null;
}

export interface Event {
  id: string;
  host_id: string;
  title: string;
  description: string;
  type: EventType;
  event_date: string;
  event_time: string;
  duration: number;
  link: string | null;
  target_years: number[];
  created_at: string;
  host_name?: string;
  host_usn?: string;
  host_avatar?: string | null;
  host_role?: UserRole;
  host_year?: number | null;
  /** Persisted community identity from the host's profile row. */
  host_member_type?: MemberType;
  host_graduation_year?: number | null;
  rsvp_count?: number;
}

export interface Post {
  id: string;
  author_id: string;
  type: PostType;
  title: string;
  body: string;
  image_url: string | null;
  github_url: string | null;
  demo_url: string | null;
  tech_stack: string[];
  tags: string[];
  target_years: number[];
  created_at: string;
  author_name?: string;
  author_usn?: string;
  author_avatar?: string | null;
  author_year?: number | null;
  author_role?: UserRole;
  /** Persisted community identity from the author's profile row. */
  author_member_type?: MemberType;
  author_graduation_year?: number | null;
  like_count?: number;
  upvote_count?: number;
  comment_count?: number;
  /** Active pin metadata, when this post is currently pinned. */
  pinned_at?: string | null;
  pin_expires_at?: string | null;
  pinned_by?: string | null;
}

export interface Comment {
  id: string;
  post_id: string;
  author_id: string;
  body: string;
  parent_id: string | null;
  created_at: string;
  author_name?: string;
  author_avatar?: string | null;
  author_usn?: string;
  /** Persisted community identity from the author's profile row. */
  author_member_type?: MemberType;
  author_graduation_year?: number | null;
}

export interface AnnouncementReactionRow {
  user_id: string;
  reaction: AnnouncementReaction;
  created_at?: string;
}

export interface Announcement {
  id: string;
  author_id: string;
  title: string;
  body: string;
  image_urls: string[];
  created_at: string;
  updated_at: string;
  author_name?: string;
  author_avatar?: string | null;
  author_designation?: string | null;
  reactions: AnnouncementReactionRow[];
}

export interface DiscussionPin {
  id: string;
  post_id: string;
  pinned_by: string;
  pinned_at: string;
  pin_expires_at: string;
  unpinned_at: string | null;
  unpinned_by: string | null;
}

export type NotificationType =
  | 'comment'
  | 'rsvp'
  | 'event_reminder'
  | 'like'
  | 'upvote'
  | 'announcement'
  | 'faculty_decision'
  | 'event_published'
  | 'showcase_top2';

export interface Notification {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  created_at: string;
  content_type?: string | null;
  content_id?: string | null;
}
