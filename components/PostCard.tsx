'use client'

import React, { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowBigUp, Check, Edit2, ExternalLink, GitBranch, GraduationCap, Heart,
  Link as LinkIcon, MessageSquare, Pin, PinOff, Save, Send, Share2, Sparkles,
  Trash2, X,
} from 'lucide-react'
import { Post, Comment } from '@/lib/types'
import { useCommunity } from '@/contexts/CommunityContext'
import { formatDate, formatRelativeTime, getYearLabel } from '@/lib/utils'
import { isAdmin, canManageDiscussionPins, firstName, alumniTag, resolveMemberType } from '@/lib/profile'
import {
  MAX_ACTIVE_DISCUSSION_PINS,
  PIN_SLOTS_FULL_MESSAGE,
  formatPinCountdown,
} from '@/lib/logic/discussionPins'
import UserAvatar from '@/components/UserAvatar'
import LinkifiedText from '@/components/LinkifiedText'

interface PostCardProps {
  post: Post
  /**
   * True when this card belongs to the current Popular/Trending showcase
   * ranking (lib/logic/ranking.ts). Renders the achievement indicator on
   * project cards; the caller derives it from the same ranking that builds
   * the section, so the badge can never disagree with section membership.
   */
  isPopular?: boolean
}

export default function PostCard({ post, isPopular = false }: PostCardProps) {
  const router = useRouter()
  const {
    currentUser, likedPostIds, upvotedPostIds, toggleLikePost, toggleUpvotePost,
    comments, addComment, updatePost, deletePost,
    pinnedPostIds, pinPendingIds, pinDiscussion, unpinDiscussion, refreshPins,
  } = useCommunity()

  const [showComments, setShowComments] = useState(false)
  const [commentInput, setCommentInput] = useState('')
  const [copied, setCopied] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [eTitle, setETitle] = useState(post.title)
  const [eBody, setEBody] = useState(post.body)
  const [eTags, setETags] = useState((post.tags || []).join(', '))
  const [eGithubUrl, setEGithubUrl] = useState(post.github_url || '')
  const [eDemoUrl, setEDemoUrl] = useState(post.demo_url || '')
  const [eTechStack, setETechStack] = useState((post.tech_stack || []).join(', '))
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [relativeTime, setRelativeTime] = useState('')
  const [now, setNow] = useState(() => new Date())
  const expiryRefreshedRef = useRef<string | null>(null)

  const isLiked = likedPostIds.has(post.id)
  const isUpvoted = upvotedPostIds.has(post.id)
  // Ownership follows the database author (and admins, matching the RLS
  // delete policy). Comparing USNs is not safe here: profiles without a USN
  // (faculty/admin or accounts created before USN migration) produce null vs
  // '' mismatches, so a real author could lose (or falsely gain) delete
  // access. Authorization stays server-side via RLS; this only controls UI.
  const isAuthor = Boolean(
    currentUser && (currentUser.id === post.author_id || isAdmin(currentUser))
  )
  const isShowcase = post.type === 'showcase'
  // Pinning is a discussion-only admin/approved-faculty affordance. The
  // admin branch is independent of faculty verification; the database is
  // authoritative and re-checks is_admin() OR is_verified_faculty().
  const canPin = !isShowcase && canManageDiscussionPins(currentUser)
  const isPinned = pinnedPostIds.has(post.id)
  const isPinPending = pinPendingIds.has(post.id)
  const postComments = comments.filter(c => c.post_id === post.id)

  const pinExpiresMs = post.pin_expires_at ? Date.parse(post.pin_expires_at) : Number.NaN
  const isPinActive =
    isPinned && Number.isFinite(pinExpiresMs) && pinExpiresMs > now.getTime()
  const pinSlotsFull =
    canPin && !isPinned && pinnedPostIds.size >= MAX_ACTIVE_DISCUSSION_PINS
  const pinCountdown = post.pin_expires_at
    ? formatPinCountdown(post.pin_expires_at, now)
    : 'Expired'

  useEffect(() => {
    queueMicrotask(() => setRelativeTime(formatRelativeTime(post.created_at)))
  }, [post.created_at])

  // Tick only while a live pin is on screen. The interval stops as soon as
  // the expiry instant passes, so an unpinned card costs nothing.
  useEffect(() => {
    if (!isPinActive) return
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [isPinActive])

  // At expiry, drop the banner and ask the context to re-read the authoritative
  // pin rows. The ref keeps this to one refresh per post id.
  useEffect(() => {
    if (!isPinned || !post.pin_expires_at) return
    if (formatPinCountdown(post.pin_expires_at, now) !== 'Expired') return
    if (expiryRefreshedRef.current === post.id) return
    expiryRefreshedRef.current = post.id
    void refreshPins()
  }, [isPinned, post.id, post.pin_expires_at, now, refreshPins])

  useEffect(() => {
    // While the editor is open the local draft is authoritative: the same
    // post can render in multiple feed sections, so an interaction with
    // another copy swaps in a new post identity mid-edit, and resyncing
    // then would silently discard unsaved typing. Cancel and save re-sync
    // the fields explicitly when the editor closes.
    if (isEditing) return
    queueMicrotask(() => {
      setETitle(post.title)
      setEBody(post.body)
      setETags((post.tags || []).join(', '))
      setEGithubUrl(post.github_url || '')
      setEDemoUrl(post.demo_url || '')
      setETechStack((post.tech_stack || []).join(', '))
    })
  }, [post, isEditing])

  const handleCommentSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!commentInput.trim()) return
    addComment(post.id, commentInput.trim())
    setCommentInput('')
    setShowComments(true)
  }

  const handleShare = () => {
    navigator.clipboard?.writeText(window.location.href)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleSaveEdit = async () => {
    if (!eTitle.trim() || !eBody.trim()) return
    setIsSaving(true)
    try {
      const tags = eTags.split(',').map(t => t.trim().replace(/^#/, '')).filter(Boolean)
      const techStack = eTechStack.split(',').map(t => t.trim()).filter(Boolean)
      await updatePost(post.id, {
        title: eTitle.trim(),
        body: eBody.trim(),
        tags: tags.length ? tags : ['General', 'CSE'],
        github_url: eGithubUrl.trim() || null,
        demo_url: eDemoUrl.trim() || null,
        tech_stack: techStack,
      })
      setIsEditing(false)
    } finally {
      setIsSaving(false)
    }
  }

  const handleCancelEdit = () => {
    setETitle(post.title)
    setEBody(post.body)
    setETags((post.tags || []).join(', '))
    setEGithubUrl(post.github_url || '')
    setEDemoUrl(post.demo_url || '')
    setETechStack((post.tech_stack || []).join(', '))
    setIsEditing(false)
  }

  const handleDelete = async () => {
    if (isDeleting) return
    if (!window.confirm(`Delete this ${isShowcase ? 'project showcase' : 'discussion'}? This cannot be undone.`)) {
      return
    }
    setIsDeleting(true)
    try {
      await deletePost(post.id)
    } finally {
      // On success the card unmounts; on failure the buttons re-enable so the
      // user can retry after reading the toast.
      setIsDeleting(false)
    }
  }

  if (isEditing) {
    return (
      <article className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-4 py-3 sm:px-5">
          <div className="flex items-center gap-2">
            {isShowcase ? (
              <Sparkles className="h-4 w-4 text-warn" />
            ) : (
              <MessageSquare className="h-4 w-4 text-muted" />
            )}
            <h3 className="font-display text-[13.5px] font-semibold text-ink">
              Editing {isShowcase ? 'showcase' : 'discussion'}
            </h3>
          </div>
          <button type="button" className="btn-icon h-8 w-8" onClick={handleCancelEdit} aria-label="Close editor">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-col gap-4 p-4 sm:p-5">
          <div>
            <label className="label" htmlFor={`title-${post.id}`}>Title</label>
            <input
              id={`title-${post.id}`}
              type="text"
              value={eTitle}
              onChange={e => setETitle(e.target.value)}
              className="field"
              placeholder="Post title"
            />
          </div>

          <div>
            <label className="label" htmlFor={`body-${post.id}`}>Description</label>
            <textarea
              id={`body-${post.id}`}
              rows={4}
              value={eBody}
              onChange={e => setEBody(e.target.value)}
              className="field-area"
              placeholder="Detailed description…"
            />
          </div>

          {isShowcase && (
            <div className="rounded-lg border border-line bg-canvas p-3.5">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="label flex items-center gap-1.5" htmlFor={`gh-${post.id}`}>
                    <GitBranch className="h-3 w-3" /> GitHub URL
                  </label>
                  <input
                    id={`gh-${post.id}`}
                    type="url"
                    placeholder="https://github.com/…"
                    value={eGithubUrl}
                    onChange={e => setEGithubUrl(e.target.value)}
                    className="field"
                  />
                </div>
                <div>
                  <label className="label flex items-center gap-1.5" htmlFor={`demo-${post.id}`}>
                    <LinkIcon className="h-3 w-3" /> Live demo URL
                  </label>
                  <input
                    id={`demo-${post.id}`}
                    type="url"
                    placeholder="https://project.vercel.app"
                    value={eDemoUrl}
                    onChange={e => setEDemoUrl(e.target.value)}
                    className="field"
                  />
                </div>
              </div>
              <div className="mt-3">
                <label className="label" htmlFor={`stack-${post.id}`}>Tech stack, comma separated</label>
                <input
                  id={`stack-${post.id}`}
                  type="text"
                  placeholder="Next.js, Supabase, TypeScript"
                  value={eTechStack}
                  onChange={e => setETechStack(e.target.value)}
                  className="field"
                />
              </div>
            </div>
          )}

          <div>
            <label className="label" htmlFor={`tags-${post.id}`}>Tags, comma separated</label>
            <input
              id={`tags-${post.id}`}
              type="text"
              placeholder="DSA, Placements, WebDev"
              value={eTags}
              onChange={e => setETags(e.target.value)}
              className="field"
            />
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-line pt-4">
            <button type="button" onClick={handleDelete} disabled={isDeleting} className="btn btn-danger btn-sm">
              <Trash2 className="h-3.5 w-3.5" /> {isDeleting ? 'Deleting…' : 'Delete'}
            </button>
            <div className="flex gap-2">
              <button type="button" onClick={handleCancelEdit} className="btn btn-ghost btn-sm">
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveEdit}
                disabled={!eTitle.trim() || !eBody.trim() || isSaving}
                className="btn btn-accent btn-sm"
              >
                <Save className="h-3.5 w-3.5" /> {isSaving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      </article>
    )
  }

  return (
    <article className="card p-5 transition-colors hover:border-line-strong sm:p-6">
      {/* Author */}
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          onClick={() => router.push(`/people/${post.author_id}`)}
          className="group flex min-w-0 items-start gap-3 text-left"
        >
          <UserAvatar src={post.author_avatar} name={post.author_name || 'Author'} size={40} />
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-[13.5px] font-semibold text-ink group-hover:underline">
                {post.author_name}
              </span>
              {post.author_role === 'faculty' && (
                <span className="chip chip-accent py-0 text-[10px]">Faculty</span>
              )}
              {resolveMemberType(post.author_member_type, post.author_role) === 'alumni' && (
                <span className="chip chip-peach py-0 text-[10px]">
                  <GraduationCap className="h-3 w-3" /> {alumniTag(post.author_graduation_year)}
                </span>
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-dim">
              {post.author_year && <span>{getYearLabel(post.author_year)}</span>}
              {post.author_year && <span aria-hidden>·</span>}
              {post.author_usn && <span className="font-mono text-[10.5px]">{post.author_usn}</span>}
              {post.author_usn && <span aria-hidden>·</span>}
              <span>{relativeTime || formatDate(post.created_at)}</span>
              <span className="whitespace-nowrap sm:hidden">
                · {isShowcase ? 'Showcase' : 'Discussion'}
              </span>
            </div>
          </div>
        </button>

        <div className="flex shrink-0 items-center gap-1">
          {isShowcase && isPopular && (
            <span
              className="chip border border-warning/25 bg-warning/10 text-[11px] text-warning"
              role="img"
              aria-label="Popular project achievement"
              title="🏆 Popular project"
            >
              🏆
            </span>
          )}
          <span
            className={`type-badge hidden border sm:inline-flex ${
              isShowcase
                ? 'border-warning/25 bg-warning/10 text-warning'
                : 'border-line bg-elevated text-muted'
            }`}
          >
            {isShowcase ? <Sparkles className="h-3 w-3" /> : <MessageSquare className="h-3 w-3" />}
            {isShowcase ? 'Showcase' : 'Discussion'}
          </span>
          {canPin && (
            <button
              type="button"
              className={`btn-icon h-8 w-8 border-transparent ${
                isPinned ? 'text-accent-text hover:text-accent-text' : ''
              }`}
              onClick={() => (isPinned ? unpinDiscussion(post.id) : pinDiscussion(post.id))}
              disabled={isPinPending || pinSlotsFull}
              aria-disabled={isPinPending || pinSlotsFull}
              aria-label={
                isPinned
                  ? 'Unpin discussion'
                  : pinSlotsFull
                    ? 'Maximum 3 active pins'
                    : 'Pin discussion'
              }
              title={
                isPinned
                  ? `Pinned by faculty${post.pin_expires_at ? ` · ${pinCountdown}` : ''}`
                  : pinSlotsFull
                    ? PIN_SLOTS_FULL_MESSAGE
                    : 'Pin this discussion for 7 days'
              }
            >
              {isPinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
            </button>
          )}
          {isAuthor && (
            <>
              <button
                type="button"
                className="btn-icon h-8 w-8 border-transparent"
                onClick={() => setIsEditing(true)}
                aria-label="Edit post"
              >
                <Edit2 className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className="btn-icon h-8 w-8 border-transparent hover:text-error"
                onClick={handleDelete}
                disabled={isDeleting}
                aria-label="Delete post"
                aria-disabled={isDeleting}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>
      </div>

      {isPinned && isPinActive && (
        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-accent/25 bg-accent-soft px-3 py-2 text-[11.5px]">
          <Pin className="h-3.5 w-3.5 shrink-0 text-accent-text" aria-hidden />
          <span className="font-medium text-accent-text">Pinned by faculty</span>
          {post.pin_expires_at && <span className="text-muted">· {pinCountdown}</span>}
        </div>
      )}

      {/* Content */}
      <h3 className="mt-4 text-[17px] font-semibold leading-snug text-ink sm:text-[18px]">
        {post.title}
      </h3>
      <p className="mt-2 max-w-[68ch] whitespace-pre-line text-[14px] leading-relaxed text-muted">
        <LinkifiedText text={post.body} />
      </p>

      {isShowcase && (post.demo_url || post.github_url || (post.tech_stack?.length ?? 0) > 0) && (
        <div className="mt-4 flex flex-col gap-3 rounded-md border border-line bg-elevated/50 p-3.5">
          {(post.demo_url || post.github_url) && (
            <div className="flex flex-wrap gap-2">
              {post.demo_url && (
                <a
                  href={post.demo_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-accent btn-sm"
                >
                  <ExternalLink className="h-3.5 w-3.5" /> Live demo
                </a>
              )}
              {post.github_url && (
                <a
                  href={post.github_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-soft btn-sm"
                >
                  <GitBranch className="h-3.5 w-3.5" /> Source code
                </a>
              )}
            </div>
          )}
          {(post.tech_stack?.length ?? 0) > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10.5px] font-medium text-dim">Built with</span>
              {post.tech_stack.map(tech => (
                <span key={tech} className="chip chip-mono">{tech}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {(post.tags?.length ?? 0) > 0 && (
        <div className="mt-3.5 flex flex-wrap gap-1.5">
          {post.tags.map(tag => (
            <span key={tag} className="chip border-transparent bg-elevated text-[11px]">
              #{tag}
            </span>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="mt-4 flex items-center gap-1 border-t border-line pt-3">
        {isShowcase ? (
          <button
            type="button"
            onClick={() => toggleUpvotePost(post.id)}
            aria-pressed={isUpvoted}
            className={`btn btn-ghost btn-sm h-8 px-2.5 ${
              isUpvoted ? 'bg-warning/10 text-warning hover:bg-warning/15 hover:text-warning' : ''
            }`}
          >
            <ArrowBigUp className={`h-4 w-4 ${isUpvoted ? 'fill-current' : ''}`} />
            <span className="text-[11.5px] tabular-nums">{post.upvote_count ?? 0}</span>
            <span className="hidden sm:inline">Upvote</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => toggleLikePost(post.id)}
            aria-pressed={isLiked}
            className={`btn btn-ghost btn-sm h-8 px-2.5 ${
              isLiked ? 'bg-peach-soft text-peach-text hover:bg-peach-soft hover:text-peach-text' : ''
            }`}
          >
            <Heart className={`h-4 w-4 ${isLiked ? 'fill-current' : ''}`} />
            <span className="text-[11.5px] tabular-nums">{post.like_count ?? 0}</span>
            <span className="hidden sm:inline">Like</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => setShowComments(v => !v)}
          aria-expanded={showComments}
          className={`btn btn-ghost btn-sm h-8 px-2.5 ${showComments ? 'bg-elevated text-ink' : ''}`}
        >
          <MessageSquare className="h-4 w-4" />
          <span className="text-[11.5px] tabular-nums">{postComments.length}</span>
          <span className="hidden sm:inline">Reply</span>
        </button>

        <button
          type="button"
          onClick={handleShare}
          className="btn btn-ghost btn-sm ml-auto h-8 px-2.5"
        >
          {copied ? (
            <>
              <Check className="h-4 w-4 text-success" />
              <span className="text-success">Copied</span>
            </>
          ) : (
            <>
              <Share2 className="h-4 w-4" />
              <span className="hidden sm:inline">Share</span>
            </>
          )}
        </button>
      </div>

      {/* Comments */}
      {showComments && (
        <div className="mt-3 border-t border-line pt-3">
          <div className="flex flex-col gap-2">
            {postComments.length === 0 ? (
              <p className="py-2 text-[12.5px] text-dim">
                No replies yet. Start the conversation.
              </p>
            ) : (
              postComments.map(comment => <CommentItem key={comment.id} comment={comment} />)
            )}
          </div>

          <form onSubmit={handleCommentSubmit} className="mt-3 flex items-center gap-2">
            <input
              type="text"
              placeholder={
                currentUser ? `Reply as ${firstName(currentUser.name)}…` : 'Sign in to reply…'
              }
              value={commentInput}
              onChange={e => setCommentInput(e.target.value)}
              aria-label="Write a reply"
              className="field h-9 flex-1 text-[13px]"
            />
            <button
              type="submit"
              disabled={!commentInput.trim()}
              className="btn btn-accent h-9 w-9 shrink-0 p-0"
              aria-label="Send reply"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        </div>
      )}
    </article>
  )
}

function CommentItem({ comment }: { comment: Comment }) {
  const [time, setTime] = useState('')

  useEffect(() => {
    queueMicrotask(() => setTime(formatRelativeTime(comment.created_at)))
  }, [comment.created_at])

  return (
    <div className="flex gap-2.5 rounded-md border border-line bg-elevated/40 px-3 py-2.5">
      <UserAvatar src={comment.author_avatar} name={comment.author_name || 'Member'} size={28} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-[12.5px] font-medium text-ink">{comment.author_name}</span>
          {comment.author_member_type === 'alumni' && (
            <span className="chip chip-peach py-0 text-[9.5px]">
              <GraduationCap className="h-2.5 w-2.5" /> {alumniTag(comment.author_graduation_year)}
            </span>
          )}
          {comment.author_usn && (
            <span className="font-mono text-[10px] text-dim">{comment.author_usn}</span>
          )}
          <span className="ml-auto text-[10.5px] text-dim">
            {time || formatDate(comment.created_at)}
          </span>
        </div>
        <p className="mt-0.5 whitespace-pre-line break-words text-[13px] leading-relaxed text-muted">
          {comment.body}
        </p>
      </div>
    </div>
  )
}
