'use client'

import React, { useState, useEffect } from 'react'
import Image from 'next/image'
import {
  Heart,
  ArrowBigUp,
  MessageSquare,
  Share2,
  ExternalLink,
  GitBranch,
  Sparkles,
  Send,
  Calendar,
  Layers,
  Check,
} from 'lucide-react'
import { Post, Comment } from '@/lib/types'
import { useCommunity } from '@/contexts/CommunityContext'
import {
  formatDate,
  formatRelativeTime,
  getAvatarFallback,
  getYearLabel,
} from '@/lib/utils'

interface PostCardProps {
  post: Post
}

export default function PostCard({ post }: PostCardProps) {
  const {
    currentUser,
    likedPostIds,
    upvotedPostIds,
    toggleLikePost,
    toggleUpvotePost,
    comments,
    addComment,
    setSelectedProfileForView,
    allProfiles,
    setIsProfileModalOpen,
  } = useCommunity()

  const [showComments, setShowComments] = useState(false)
  const [commentInput, setCommentInput] = useState('')
  const [copied, setCopied] = useState(false)

  const isLiked = likedPostIds.has(post.id)
  const isUpvoted = upvotedPostIds.has(post.id)

  const [relativeTime, setRelativeTime] = useState('')

  useEffect(() => {
    setRelativeTime(formatRelativeTime(post.created_at))
  }, [post.created_at])

  const postComments = comments.filter(c => c.post_id === post.id)

  const handleAuthorClick = () => {
    const authorProfile = allProfiles.find(
      p => p.id === post.author_id || p.usn === post.author_usn
    )
    if (authorProfile) {
      setSelectedProfileForView(authorProfile)
      setIsProfileModalOpen(true)
    }
  }

  const handleCommentSubmit = (e: React.FormEvent) => {
    e.preventDefault()
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

  const isShowcase = post.type === 'showcase'

  return (
    <article
      className={`card p-5 transition-all hover:border-slate-300 bg-white ${
        isShowcase ? 'border-amber-200/60 shadow-xs' : ''
      }`}
    >
      {/* Author Header */}
      <div className="flex items-center justify-between gap-3 mb-3">
        <button
          type="button"
          onClick={handleAuthorClick}
          className="flex items-center gap-2.5 text-left group/author hover:opacity-90 transition-opacity"
        >
          <div className="w-9 h-9 rounded-full overflow-hidden bg-[#1e3a5f] text-white flex items-center justify-center font-bold text-xs">
            {post.author_avatar ? (
              <Image
                src={post.author_avatar}
                alt={post.author_name || 'Author'}
                width={36}
                height={36}
                className="w-full h-full object-cover"
              />
            ) : (
              getAvatarFallback(post.author_name || 'Author')
            )}
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="text-xs sm:text-sm font-bold text-slate-900 group-hover/author:text-[#1e3a5f] transition-colors">
                {post.author_name}
              </span>
              {post.author_year && (
                <span className="text-[10px] font-semibold bg-slate-100 text-slate-700 px-1.5 py-0.2 rounded border border-slate-200">
                  {getYearLabel(post.author_year)}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-slate-400 font-mono">
              <span>{post.author_usn}</span>
              <span>•</span>
              <span className="font-sans">{relativeTime || formatDate(post.created_at)}</span>
            </div>
          </div>
        </button>

        {/* Post Type Badge */}
        {isShowcase ? (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-50 text-amber-800 border border-amber-300/60">
            <Sparkles className="w-3 h-3 text-amber-600" />
            Showcase
          </span>
        ) : (
          <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-600">
            Discussion
          </span>
        )}
      </div>

      {/* Title */}
      <h3 className="text-base sm:text-lg font-bold text-slate-900 leading-snug mb-2">
        {post.title}
      </h3>

      {/* Body */}
      <p className="text-xs sm:text-sm text-slate-700 leading-relaxed whitespace-pre-line mb-4">
        {post.body}
      </p>

      {/* Showcase Specific Media & Links */}
      {isShowcase && (
        <div className="space-y-3 mb-4">
          {/* Showcase Image Preview if available */}
          {post.image_url && (
            <div className="relative w-full h-48 sm:h-64 rounded-xl overflow-hidden border border-slate-200 bg-slate-100">
              <Image
                src={post.image_url}
                alt={post.title}
                fill
                sizes="(max-width: 768px) 100vw, 600px"
                className="object-cover hover:scale-[1.02] transition-transform duration-300"
              />
            </div>
          )}

          {/* Action links: Live Demo & GitHub repo */}
          <div className="flex flex-wrap items-center gap-2">
            {post.demo_url && (
              <a
                href={post.demo_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs rounded-lg transition-colors shadow-xs"
              >
                <span>Live Demo</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
            {post.github_url && (
              <a
                href={post.github_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white font-medium text-xs rounded-lg transition-colors shadow-xs"
              >
                <GitBranch className="w-3.5 h-3.5" />
                <span>Source Code</span>
              </a>
            )}
          </div>

          {/* Tech Stack Chips */}
          {post.tech_stack && post.tech_stack.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <span className="text-[11px] font-bold text-slate-500 mr-1">Stack:</span>
              {post.tech_stack.map(tech => (
                <span
                  key={tech}
                  className="text-[10px] font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200"
                >
                  {tech}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tags Chips */}
      {post.tags && post.tags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mb-4">
          {post.tags.map(t => (
            <span
              key={t}
              className="text-[11px] font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-2 py-0.5 rounded cursor-pointer transition-colors"
            >
              #{t}
            </span>
          ))}
        </div>
      )}

      {/* Reaction and Interaction Bar */}
      <div className="flex items-center justify-between pt-3 border-t border-slate-100">
        <div className="flex items-center gap-1 sm:gap-2">
          {/* Showcase Upvote or Discussion Like */}
          {isShowcase ? (
            <button
              type="button"
              onClick={() => toggleUpvotePost(post.id)}
              className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                isUpvoted
                  ? 'bg-amber-100 text-amber-800 border border-amber-300'
                  : 'text-slate-600 hover:bg-amber-50 hover:text-amber-800'
              }`}
            >
              <ArrowBigUp className={`w-4 h-4 ${isUpvoted ? 'fill-amber-600 text-amber-600' : ''}`} />
              <span>{post.upvote_count ?? 0}</span>
              <span className="hidden sm:inline">Upvotes</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => toggleLikePost(post.id)}
              className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                isLiked
                  ? 'bg-rose-50 text-rose-600 font-bold'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-rose-600'
              }`}
            >
              <Heart className={`w-4 h-4 ${isLiked ? 'fill-rose-600 text-rose-600' : ''}`} />
              <span>{post.like_count ?? 0}</span>
              <span className="hidden sm:inline">Likes</span>
            </button>
          )}

          {/* Comment Button */}
          <button
            type="button"
            onClick={() => setShowComments(!showComments)}
            className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              showComments
                ? 'bg-indigo-50 text-indigo-700'
                : 'text-slate-600 hover:bg-slate-100 hover:text-indigo-700'
            }`}
          >
            <MessageSquare className="w-4 h-4" />
            <span>{postComments.length}</span>
            <span className="hidden sm:inline">Comments</span>
          </button>
        </div>

        {/* Share Button */}
        <button
          type="button"
          onClick={handleShare}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors"
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-600" />
              <span className="text-emerald-600 text-[11px] font-bold">Link Copied!</span>
            </>
          ) : (
            <>
              <Share2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Share</span>
            </>
          )}
        </button>
      </div>

      {/* Expandable Comments Section */}
      {showComments && (
        <div className="mt-4 pt-4 border-t border-slate-100 space-y-3 animate-fade-in-up">
          {/* Existing Comments */}
          <div className="space-y-2.5">
            {postComments.length === 0 ? (
              <p className="text-xs text-slate-400 italic">No comments yet. Start the conversation!</p>
            ) : (
              postComments.map(c => <CommentItem key={c.id} comment={c} />)
            )}
          </div>

          {/* Add Comment Input Form */}
          <form onSubmit={handleCommentSubmit} className="flex items-center gap-2 pt-1">
            <input
              type="text"
              placeholder={`Reply as ${currentUser.name.split(' ')[0]}...`}
              value={commentInput}
              onChange={e => setCommentInput(e.target.value)}
              className="flex-1 px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-[#1e3a5f] focus:bg-white text-slate-800"
            />
            <button
              type="submit"
              disabled={!commentInput.trim()}
              className="p-2 bg-[#1e3a5f] text-white rounded-lg hover:bg-[#152e4d] disabled:opacity-40 transition-colors"
              aria-label="Post comment"
            >
              <Send className="w-3.5 h-3.5" />
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
    setTime(formatRelativeTime(comment.created_at))
  }, [comment.created_at])

  return (
    <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100 text-xs">
      <div className="flex items-center justify-between mb-1">
        <span className="font-bold text-slate-800">
          {comment.author_name}
          <span className="font-mono text-slate-400 font-normal ml-1.5">
            ({comment.author_usn})
          </span>
        </span>
        <span className="text-[10px] text-slate-400">
          {time || formatDate(comment.created_at)}
        </span>
      </div>
      <p className="text-slate-700 leading-relaxed">{comment.body}</p>
    </div>
  )
}
