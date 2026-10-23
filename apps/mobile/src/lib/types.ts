/**
 * UCC domain types — ported (subset) from the web app's `lib/types.ts`, which
 * is framework-free TypeScript and safe for React Native. Kept in sync
 * manually; the web app remains the source of truth for column meanings.
 */

export type UserRole = 'student' | 'faculty' | 'admin';
export type FacultyStatus = 'none' | 'pending' | 'approved' | 'verified' | 'rejected';
export type ConnectionStatus = 'pending' | 'accepted' | 'rejected' | 'cancelled';
export type EventType = 'Workshop' | 'Meeting' | 'Showcase' | 'Seminar' | 'Project Session';
export type PostType = 'discussion' | 'showcase';

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
  created_at: string;
  updated_at?: string | null;
  connection_count?: number;
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
  like_count?: number;
  upvote_count?: number;
  comment_count?: number;
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
}

export type NotificationType =
  | 'comment'
  | 'rsvp'
  | 'event_reminder'
  | 'like'
  | 'upvote'
  | 'connection_request'
  | 'connection_accepted'
  | 'message'
  | 'announcement'
  | 'faculty_decision';

export interface Notification {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  created_at: string;
}

export interface ConnectionRequest {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: ConnectionStatus;
  created_at: string;
  responded_at: string | null;
  requester?: Profile | null;
  addressee?: Profile | null;
}

export interface Conversation {
  id: string;
  is_group: boolean;
  title: string | null;
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
  last_message_preview: string | null;
  other?: Profile | null;
  unread_count?: number;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  sender_name?: string;
  sender_avatar?: string | null;
}

export type ConnectionAction =
  | 'connect'
  | 'pending_outgoing'
  | 'pending_incoming'
  | 'connected'
  | 'self'
  | 'none';
