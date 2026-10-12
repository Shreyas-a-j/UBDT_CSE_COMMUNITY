'use client'

import React, { useState } from 'react'
import { X, MessageSquare, Sparkles, Link as LinkIcon, GitBranch } from 'lucide-react'
import { useCommunity } from '@/contexts/CommunityContext'

export default function CreatePostModal() {
  const { isCreatePostOpen, setIsCreatePostOpen, createPost } = useCommunity()

  const [type, setType] = useState<'discussion' | 'showcase'>('discussion')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [tagsStr, setTagsStr] = useState('')
  const [githubUrl, setGithubUrl] = useState('')
  const [demoUrl, setDemoUrl] = useState('')
  const [techStackStr, setTechStackStr] = useState('')

  if (!isCreatePostOpen) return null

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() || !body.trim()) return

    const tags = tagsStr.split(',').map(t => t.trim().replace(/^#/, '')).filter(Boolean)
    const techStack = techStackStr.split(',').map(t => t.trim()).filter(Boolean)

    createPost({
      type,
      title: title.trim(),
      body: body.trim(),
      tags: tags.length ? tags : ['General', 'CSE'],
      image_url: null,
      github_url: githubUrl.trim() || null,
      demo_url: demoUrl.trim() || null,
      tech_stack: techStack,
      target_years: [1, 2, 3, 4],
      author_id: '',
    })

    setTitle('')
    setBody('')
    setTagsStr('')
    setGithubUrl('')
    setDemoUrl('')
    setTechStackStr('')
    setIsCreatePostOpen(false)
  }

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ background: '#0b1220', border: '2px solid #00aaff', boxShadow: '6px 6px 0px #000, 0 0 24px rgba(0,170,255,0.18)', borderRadius: 0, outline: 'none' }}>
        {/* Header */}
        <div style={{ background: '#090e1c', borderBottom: '2px solid #1e3560', padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 34, height: 34, background: type === 'showcase' ? '#ffe066' : '#00aaff', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '2px 2px 0px #000' }}>
              {type === 'showcase' ? (
                <Sparkles style={{ width: 18, height: 18, color: '#060a14' }} />
              ) : (
                <MessageSquare style={{ width: 18, height: 18, color: '#060a14' }} />
              )}
            </div>
            <div>
              <h2 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#e8f4fd', letterSpacing: '0.02em', margin: 0 }}>
                {type === 'showcase' ? 'Share Project Showcase' : 'Start Discussion Thread'}
              </h2>
              <p style={{ fontSize: '0.72rem', color: '#6bafd4', margin: 0 }}>
                {type === 'showcase' ? 'Present your code and demo to UCC peers' : 'Ask questions or share insights with the community'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setIsCreatePostOpen(false)}
            style={{ background: 'transparent', border: '2px solid #1e3560', padding: '5px', cursor: 'pointer', color: '#6bafd4', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = '#00aaff'; (e.currentTarget as HTMLElement).style.color = '#e8f4fd' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = '#1e3560'; (e.currentTarget as HTMLElement).style.color = '#6bafd4' }}
          >
            <X style={{ width: 16, height: 16 }} />
          </button>
        </div>

        {/* Type Toggle */}
        <div style={{ padding: '12px 18px', background: '#080d18', borderBottom: '2px solid #1e3560' }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={() => setType('discussion')}
              style={{
                flex: 1, padding: '8px 12px', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer',
                border: '2px solid', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                textTransform: 'uppercase', transition: 'all 0.05s steps(1)', letterSpacing: '0.03em',
                background: type === 'discussion' ? '#00aaff' : 'transparent',
                color: type === 'discussion' ? '#060a14' : '#6bafd4',
                borderColor: type === 'discussion' ? '#0088cc' : '#1e3560',
                boxShadow: type === 'discussion' ? '3px 3px 0px #003366' : 'none',
              }}
            >
              <MessageSquare style={{ width: 14, height: 14 }} /> Discussion
            </button>
            <button
              type="button"
              onClick={() => setType('showcase')}
              style={{
                flex: 1, padding: '8px 12px', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer',
                border: '2px solid', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                textTransform: 'uppercase', transition: 'all 0.05s steps(1)', letterSpacing: '0.03em',
                background: type === 'showcase' ? '#ffe066' : 'transparent',
                color: type === 'showcase' ? '#060a14' : '#6bafd4',
                borderColor: type === 'showcase' ? '#ccb000' : '#1e3560',
                boxShadow: type === 'showcase' ? '3px 3px 0px #665500' : 'none',
              }}
            >
              <Sparkles style={{ width: 14, height: 14 }} /> Project Showcase
            </button>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ padding: '18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label className="label">Title</label>
            <input
              type="text"
              required
              placeholder={
                type === 'showcase'
                  ? 'e.g. SmartAtt — QR Attendance for CSE Labs'
                  : 'e.g. Tips for Dynamic Programming in placements'
              }
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="input"
            />
          </div>

          <div>
            <label className="label">Content / Description</label>
            <textarea
              required
              rows={4}
              placeholder={
                type === 'showcase'
                  ? 'Describe the problem it solves, architecture, and key features…'
                  : 'Explain your question, insights, or advice in detail…'
              }
              value={body}
              onChange={e => setBody(e.target.value)}
              className="textarea"
            />
          </div>

          {/* Showcase-specific fields */}
          {type === 'showcase' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '12px', background: '#080d18', border: '2px solid rgba(255,224,102,0.3)', boxShadow: 'inset 2px 2px 0px rgba(0,0,0,0.5)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label className="label" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <GitBranch style={{ width: 12, height: 12, color: '#00aaff' }} /> GitHub Repo URL
                  </label>
                  <input
                    type="url"
                    placeholder="https://github.com/…"
                    value={githubUrl}
                    onChange={e => setGithubUrl(e.target.value)}
                    className="input"
                  />
                </div>
                <div>
                  <label className="label" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <LinkIcon style={{ width: 12, height: 12, color: '#ffe066' }} /> Live Demo URL
                  </label>
                  <input
                    type="url"
                    placeholder="https://myproject.vercel.app"
                    value={demoUrl}
                    onChange={e => setDemoUrl(e.target.value)}
                    className="input"
                  />
                </div>
              </div>
              <div>
                <label className="label">Tech Stack (comma-separated)</label>
                <input
                  type="text"
                  placeholder="e.g. Next.js, Supabase, TypeScript"
                  value={techStackStr}
                  onChange={e => setTechStackStr(e.target.value)}
                  className="input"
                />
              </div>
            </div>
          )}

          <div>
            <label className="label">Tags (comma-separated)</label>
            <input
              type="text"
              placeholder="e.g. DSA, Placements, WebDev"
              value={tagsStr}
              onChange={e => setTagsStr(e.target.value)}
              className="input"
            />
          </div>

          {/* Footer */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, paddingTop: 14, borderTop: '2px solid #1e3560' }}>
            <button
              type="button"
              onClick={() => setIsCreatePostOpen(false)}
              style={{ padding: '8px 14px', background: 'transparent', border: '2px solid #1e3560', color: '#a8d4f0', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer', textTransform: 'uppercase', boxShadow: '2px 2px 0px #000' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!title.trim() || !body.trim()}
              style={{
                padding: '8px 18px', background: '#00f5c4', color: '#060a14', border: '2px solid #00cca0',
                fontSize: '0.78rem', fontWeight: 800, cursor: 'pointer', textTransform: 'uppercase',
                boxShadow: '3px 3px 0px #006650', opacity: (!title.trim() || !body.trim()) ? 0.5 : 1,
                letterSpacing: '0.03em',
              }}
            >
              Publish {type === 'showcase' ? 'Showcase' : 'Post'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
