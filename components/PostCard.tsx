'use client'

import React, { useState, useEffect } from 'react'
import Image from 'next/image'
import {
  Heart, ArrowBigUp, MessageSquare, Share2, ExternalLink, GitBranch,
  Sparkles, Send, Check, Edit2, Trash2, Save, X, Link as LinkIcon,
} from 'lucide-react'
import { Post, Comment } from '@/lib/types'
import { useCommunity } from '@/contexts/CommunityContext'
import { formatDate, formatRelativeTime, getAvatarFallback, getYearLabel } from '@/lib/utils'
import UserAvatar from '@/components/UserAvatar'

interface PostCardProps { post: Post }

export default function PostCard({ post }: PostCardProps) {
  const {
    currentUser, likedPostIds, upvotedPostIds, toggleLikePost, toggleUpvotePost,
    comments, addComment, updatePost, deletePost, setSelectedProfileForView, setIsProfileModalOpen,
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
  const [relativeTime, setRelativeTime] = useState('')

  const isLiked = likedPostIds.has(post.id)
  const isUpvoted = upvotedPostIds.has(post.id)
  const isAuthor = Boolean(currentUser && (currentUser.id === post.author_id || currentUser.usn === post.author_usn))
  const isShowcase = post.type === 'showcase'
  const postComments = comments.filter(c => c.post_id === post.id)

  useEffect(() => { setRelativeTime(formatRelativeTime(post.created_at)) }, [post.created_at])
  useEffect(() => {
    setETitle(post.title); setEBody(post.body); setETags((post.tags || []).join(', '))
    setEGithubUrl(post.github_url || ''); setEDemoUrl(post.demo_url || ''); setETechStack((post.tech_stack || []).join(', '))
  }, [post])

  const handleAuthorClick = () => {
    setSelectedProfileForView({ id: post.author_id, usn: post.author_usn || '', name: post.author_name || 'Author', year: post.author_year || 1, branch: 'CSE', bio: null, avatar_url: post.author_avatar || null, skills: [], created_at: post.created_at })
    setIsProfileModalOpen(true)
  }
  const handleCommentSubmit = (e: React.FormEvent) => { e.preventDefault(); if (!commentInput.trim()) return; addComment(post.id, commentInput.trim()); setCommentInput(''); setShowComments(true) }
  const handleShare = () => { navigator.clipboard?.writeText(window.location.href); setCopied(true); setTimeout(() => setCopied(false), 2000) }
  const handleSaveEdit = async () => {
    if (!eTitle.trim() || !eBody.trim()) return; setIsSaving(true)
    try {
      const tags = eTags.split(',').map(t => t.trim().replace(/^#/, '')).filter(Boolean)
      const techStack = eTechStack.split(',').map(t => t.trim()).filter(Boolean)
      await updatePost(post.id, { title: eTitle.trim(), body: eBody.trim(), tags: tags.length ? tags : ['General', 'CSE'], github_url: eGithubUrl.trim() || null, demo_url: eDemoUrl.trim() || null, tech_stack: techStack })
      setIsEditing(false)
    } finally { setIsSaving(false) }
  }
  const handleCancelEdit = () => { setETitle(post.title); setEBody(post.body); setETags((post.tags || []).join(', ')); setEGithubUrl(post.github_url || ''); setEDemoUrl(post.demo_url || ''); setETechStack((post.tech_stack || []).join(', ')); setIsEditing(false) }
  const handleDelete = async () => { if (window.confirm(`Delete this ${isShowcase ? 'project showcase' : 'discussion'}?`)) { await deletePost(post.id) } }

  // Edit Mode
  if (isEditing) {
    return (
      <article style={{ background: '#0d1426', border: `2px solid ${isShowcase ? '#ffe066' : '#00aaff'}`, padding: '20px', boxShadow: `4px 4px 0px ${isShowcase ? '#665500' : '#003366'}, 0 0 16px ${isShowcase ? 'rgba(255,224,102,0.12)' : 'rgba(0,170,255,0.12)'}` }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 12, marginBottom: 12, borderBottom: '2px solid #1e3560' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {isShowcase ? <Sparkles style={{ width: 14, height: 14, color: '#ffe066' }} /> : <MessageSquare style={{ width: 14, height: 14, color: '#00aaff' }} />}
            <span style={{ fontSize: '0.75rem', color: '#e8f4fd', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
              EDITING {isShowcase ? 'SHOWCASE' : 'DISCUSSION'}
            </span>
          </div>
          <button type="button" onClick={handleCancelEdit} style={{ background: 'transparent', border: '2px solid #1e3560', padding: 4, cursor: 'pointer', color: '#6bafd4' }}>
            <X style={{ width: 14, height: 14 }} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label className="label">TITLE</label>
            <input type="text" required value={eTitle} onChange={e => setETitle(e.target.value)} className="input" placeholder="Post title" />
          </div>
          <div>
            <label className="label">DESCRIPTION</label>
            <textarea required rows={4} value={eBody} onChange={e => setEBody(e.target.value)} className="textarea" placeholder="Detailed description..." />
          </div>
          {isShowcase && (
            <div style={{ padding: 12, background: '#0c1220', border: `2px solid rgba(255,224,102,0.3)`, boxShadow: 'inset 2px 2px 0px rgba(0,0,0,0.4)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div>
                  <label className="label" style={{ display: 'flex', alignItems: 'center', gap: 4 }}><GitBranch style={{ width: 12, height: 12 }} /> GITHUB URL</label>
                  <input type="url" placeholder="https://github.com/..." value={eGithubUrl} onChange={e => setEGithubUrl(e.target.value)} className="input" />
                </div>
                <div>
                  <label className="label" style={{ display: 'flex', alignItems: 'center', gap: 4 }}><LinkIcon style={{ width: 12, height: 12 }} /> DEMO URL</label>
                  <input type="url" placeholder="https://myproject.vercel.app" value={eDemoUrl} onChange={e => setEDemoUrl(e.target.value)} className="input" />
                </div>
              </div>
              <label className="label">TECH STACK (COMMA-SEPARATED)</label>
              <input type="text" placeholder="e.g. Next.js, Supabase, TypeScript" value={eTechStack} onChange={e => setETechStack(e.target.value)} className="input" />
            </div>
          )}
          <div>
            <label className="label">TAGS (COMMA-SEPARATED)</label>
            <input type="text" placeholder="e.g. WebDev, DSA, Placements" value={eTags} onChange={e => setETags(e.target.value)} className="input" />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 12, borderTop: '2px solid #1e3560' }}>
            <button type="button" onClick={handleDelete} style={{ fontSize: '0.72rem', fontWeight: 700, color: '#ff4466', background: 'transparent', border: '2px solid #ff4466', padding: '6px 12px', cursor: 'pointer', boxShadow: '2px 2px 0px #661133', display: 'flex', alignItems: 'center', gap: 5, textTransform: 'uppercase' }}>
              <Trash2 style={{ width: 13, height: 13 }} /> DELETE
            </button>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={handleCancelEdit} style={{ fontSize: '0.72rem', fontWeight: 700, color: '#a8d4f0', background: 'transparent', border: '2px solid #1e3560', padding: '6px 12px', cursor: 'pointer', boxShadow: '2px 2px 0px #000', textTransform: 'uppercase' }}>CANCEL</button>
              <button type="button" onClick={handleSaveEdit} disabled={!eTitle.trim() || !eBody.trim() || isSaving}
                style={{ fontSize: '0.72rem', fontWeight: 700, color: '#060a14', background: '#00aaff', border: '2px solid #0088cc', padding: '6px 14px', cursor: 'pointer', boxShadow: '3px 3px 0px #003366', display: 'flex', alignItems: 'center', gap: 5, textTransform: 'uppercase', opacity: isSaving ? 0.6 : 1 }}>
                <Save style={{ width: 13, height: 13 }} /> {isSaving ? 'SAVING...' : 'SAVE'}
              </button>
            </div>
          </div>
        </div>
      </article>
    )
  }

  // Normal View
  return (
    <article style={{ background: '#0d1426', border: `2px solid ${isShowcase ? '#665500' : '#1e3560'}`, padding: '20px', boxShadow: '4px 4px 0px #000', position: 'relative' }}>
      {/* Showcase indicator bar */}
      {isShowcase && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: 'linear-gradient(90deg, #ffe066, #00ffcc)' }} />}

      {/* Author Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
        <button type="button" onClick={handleAuthorClick} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
          <UserAvatar src={post.author_avatar} name={post.author_name || 'Author'} size={38} borderColor="#1e3560" />
          <div style={{ textAlign: 'left' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: '0.825rem', color: '#e8f4fd', fontWeight: 700 }}>{post.author_name}</span>
              {post.author_year && (
                <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#00ffcc', background: 'rgba(0,255,204,0.1)', border: '1px solid rgba(0,255,204,0.3)', padding: '1px 6px' }}>{getYearLabel(post.author_year)}</span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: '0.72rem', color: '#00aaff', fontWeight: 500 }}>{post.author_usn}</span>
              <span style={{ fontSize: '0.72rem', color: '#3d6b8a' }}>•</span>
              <span style={{ fontSize: '0.72rem', color: '#6bafd4' }}>{relativeTime || formatDate(post.created_at)}</span>
            </div>
          </div>
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {isShowcase ? (
            <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#ffe066', background: 'rgba(255,224,102,0.12)', border: '2px solid rgba(255,224,102,0.4)', padding: '2px 8px', display: 'flex', alignItems: 'center', gap: 4, boxShadow: '2px 2px 0px #665500', textTransform: 'uppercase' }}>
              <Sparkles style={{ width: 11, height: 11, color: '#ffe066' }} /> SHOWCASE
            </span>
          ) : (
            <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#00aaff', background: 'rgba(0,170,255,0.1)', border: '2px solid rgba(0,170,255,0.3)', padding: '2px 8px', display: 'flex', alignItems: 'center', gap: 4, boxShadow: '2px 2px 0px #003366', textTransform: 'uppercase' }}>
              <MessageSquare style={{ width: 11, height: 11 }} /> DISCUSS
            </span>
          )}
          {isAuthor && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, paddingLeft: 8, borderLeft: '2px solid #1e3560' }}>
              <button type="button" onClick={() => setIsEditing(true)} style={{ background: 'transparent', border: '2px solid transparent', padding: 4, cursor: 'pointer', color: '#6bafd4' }} title="Edit">
                <Edit2 style={{ width: 13, height: 13 }} />
              </button>
              <button type="button" onClick={handleDelete} style={{ background: 'transparent', border: '2px solid transparent', padding: 4, cursor: 'pointer', color: '#6bafd4' }} title="Delete">
                <Trash2 style={{ width: 13, height: 13 }} />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Title */}
      <h3 style={{ fontSize: '1rem', color: '#e8f4fd', fontWeight: 700, lineHeight: 1.4, marginBottom: 8 }}>{post.title}</h3>

      {/* Body */}
      <p style={{ fontSize: '0.875rem', color: '#cbd5e1', lineHeight: 1.6, marginBottom: 16, whiteSpace: 'pre-line' }}>{post.body}</p>

      {/* Showcase Extras */}
      {isShowcase && (
        <div style={{ marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {post.demo_url && (
              <a href={post.demo_url} target="_blank" rel="noopener noreferrer"
                style={{ fontSize: '0.75rem', fontWeight: 700, color: '#060a14', background: '#00ffcc', border: '2px solid #00ccaa', padding: '6px 14px', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6, boxShadow: '3px 3px 0px #006655', textTransform: 'uppercase' }}>
                LIVE DEMO <ExternalLink style={{ width: 12, height: 12 }} />
              </a>
            )}
            {post.github_url && (
              <a href={post.github_url} target="_blank" rel="noopener noreferrer"
                style={{ fontSize: '0.75rem', fontWeight: 700, color: '#a8d4f0', background: 'transparent', border: '2px solid #1e3560', padding: '6px 14px', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6, boxShadow: '3px 3px 0px #000', textTransform: 'uppercase' }}>
                <GitBranch style={{ width: 12, height: 12, color: '#00aaff' }} /> SOURCE CODE
              </a>
            )}
          </div>
          {post.tech_stack && post.tech_stack.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: '0.7rem', color: '#6bafd4', textTransform: 'uppercase', marginRight: 4, fontWeight: 700 }}>STACK:</span>
              {post.tech_stack.map(tech => (
                <span key={tech} style={{ fontSize: '0.72rem', color: '#a8d4f0', background: '#0c1220', border: '1px solid #1e3560', padding: '2px 7px' }}>{tech}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tags */}
      {post.tags && post.tags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
          {post.tags.map(t => (
            <span key={t} style={{ fontSize: '0.72rem', color: '#44ccff', background: 'rgba(0,170,255,0.1)', border: '1px solid rgba(0,170,255,0.3)', padding: '2px 8px', fontWeight: 600 }}>#{t}</span>
          ))}
        </div>
      )}

      {/* Reaction Bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 14, borderTop: '2px solid #1e3560' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {isShowcase ? (
            <button type="button" onClick={() => toggleUpvotePost(post.id)}
              style={{ fontSize: '0.75rem', fontWeight: 700, padding: '6px 12px', border: '2px solid', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, transition: 'all 0.05s steps(1)', textTransform: 'uppercase',
                background: isUpvoted ? '#ffe066' : 'transparent', color: isUpvoted ? '#060a14' : '#a8d4f0',
                borderColor: isUpvoted ? '#ccb000' : '#1e3560', boxShadow: isUpvoted ? '3px 3px 0px #665500' : '2px 2px 0px #000',
                transform: isUpvoted ? 'translate(-1px,-1px)' : 'none' }}>
              <ArrowBigUp style={{ width: 15, height: 15, fill: isUpvoted ? '#060a14' : 'none', color: isUpvoted ? '#060a14' : '#ffe066' }} />
              {post.upvote_count ?? 0} UPVOTE
            </button>
          ) : (
            <button type="button" onClick={() => toggleLikePost(post.id)}
              style={{ fontSize: '0.75rem', fontWeight: 700, padding: '6px 12px', border: '2px solid', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, transition: 'all 0.05s steps(1)', textTransform: 'uppercase',
                background: isLiked ? 'rgba(255,68,102,0.15)' : 'transparent', color: isLiked ? '#ff4466' : '#a8d4f0',
                borderColor: isLiked ? '#ff4466' : '#1e3560', boxShadow: isLiked ? '2px 2px 0px #661133' : '2px 2px 0px #000',
                transform: isLiked ? 'translate(-1px,-1px)' : 'none' }}>
              <Heart style={{ width: 14, height: 14, fill: isLiked ? '#ff4466' : 'none', color: isLiked ? '#ff4466' : '#6bafd4' }} />
              {post.like_count ?? 0} LIKE
            </button>
          )}
          <button type="button" onClick={() => setShowComments(!showComments)}
            style={{ fontSize: '0.75rem', fontWeight: 700, padding: '6px 12px', border: '2px solid', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, textTransform: 'uppercase',
              background: showComments ? 'rgba(0,170,255,0.12)' : 'transparent', color: showComments ? '#00aaff' : '#a8d4f0',
              borderColor: showComments ? '#00aaff' : '#1e3560', boxShadow: '2px 2px 0px #000' }}>
            <MessageSquare style={{ width: 14, height: 14, color: '#00aaff' }} />
            {postComments.length} REPLY
          </button>
        </div>

        <button type="button" onClick={handleShare}
          style={{ fontSize: '0.72rem', fontWeight: 600, padding: '6px 12px', border: '2px solid', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, textTransform: 'uppercase',
            background: 'transparent', color: '#6bafd4', borderColor: '#1e3560', boxShadow: '2px 2px 0px #000' }}>
          {copied ? (<><Check style={{ width: 13, height: 13, color: '#00ffcc' }} /><span style={{ color: '#00ffcc' }}>COPIED!</span></>) : (<><Share2 style={{ width: 13, height: 13 }} />SHARE</>)}
        </button>
      </div>

      {/* Comments */}
      {showComments && (
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: '2px solid #1e3560', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {postComments.length === 0 ? (
              <p style={{ fontSize: '0.78rem', color: '#3d6b8a', fontStyle: 'italic', padding: '6px 0' }}>NO COMMENTS YET. START THE CONVERSATION!</p>
            ) : (
              postComments.map(c => <CommentItem key={c.id} comment={c} />)
            )}
          </div>
          <form onSubmit={handleCommentSubmit} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="text"
              placeholder={currentUser ? `Reply as ${currentUser.name.split(' ')[0]}...` : 'Sign in to reply...'}
              value={commentInput}
              onChange={e => setCommentInput(e.target.value)}
              style={{ flex: 1, padding: '8px 12px', background: '#0c1220', border: '2px solid #1e3560', color: '#e8f4fd', fontSize: '0.825rem', outline: 'none', boxShadow: 'inset 2px 2px 0px rgba(0,0,0,0.4)' }}
            />
            <button type="submit" disabled={!commentInput.trim()}
              style={{ background: '#00aaff', color: '#060a14', border: '2px solid #0088cc', padding: '8px 14px', cursor: 'pointer', boxShadow: '3px 3px 0px #003366', opacity: !commentInput.trim() ? 0.4 : 1 }}>
              <Send style={{ width: 14, height: 14 }} />
            </button>
          </form>
        </div>
      )}
    </article>
  )
}

function CommentItem({ comment }: { comment: Comment }) {
  const [time, setTime] = useState('')
  useEffect(() => { setTime(formatRelativeTime(comment.created_at)) }, [comment.created_at])
  return (
    <div style={{ padding: '10px 12px', background: '#090e1c', border: '2px solid #1e3560', boxShadow: 'inset 2px 2px 0px rgba(0,0,0,0.3)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: '0.8rem', color: '#e8f4fd', fontWeight: 700 }}>
          {comment.author_name}
          <span style={{ fontSize: '0.72rem', color: '#00aaff', fontWeight: 500, marginLeft: 6 }}>({comment.author_usn})</span>
        </span>
        <span style={{ fontSize: '0.7rem', color: '#3d6b8a' }}>{time || formatDate(comment.created_at)}</span>
      </div>
      <p style={{ fontSize: '0.825rem', color: '#cbd5e1', lineHeight: 1.5 }}>{comment.body}</p>
    </div>
  )
}
