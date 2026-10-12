'use client'

import React, { useState } from 'react'
import { X, MessageSquare, Sparkles, Layers, Link as LinkIcon, GitBranch, Image as ImageIcon } from 'lucide-react'
import { useCommunity } from '@/contexts/CommunityContext'

export default function CreatePostModal() {
  const { isCreatePostOpen, setIsCreatePostOpen, createPost } = useCommunity()

  const [type, setType] = useState<'discussion' | 'showcase'>('discussion')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [tagsStr, setTagsStr] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [githubUrl, setGithubUrl] = useState('')
  const [demoUrl, setDemoUrl] = useState('')
  const [techStackStr, setTechStackStr] = useState('')

  if (!isCreatePostOpen) return null

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() || !body.trim()) return

    const tags = tagsStr
      .split(',')
      .map(t => t.trim().replace(/^#/, ''))
      .filter(Boolean)

    const techStack = techStackStr
      .split(',')
      .map(t => t.trim())
      .filter(Boolean)

    createPost({
      type,
      title: title.trim(),
      body: body.trim(),
      tags: tags.length ? tags : ['General', 'CSE'],
      image_url: imageUrl.trim() || null,
      github_url: githubUrl.trim() || null,
      demo_url: demoUrl.trim() || null,
      tech_stack: techStack,
      target_years: [1, 2, 3, 4],
      author_id: '',
    })

    // Reset & close
    setTitle('')
    setBody('')
    setTagsStr('')
    setImageUrl('')
    setGithubUrl('')
    setDemoUrl('')
    setTechStackStr('')
    setIsCreatePostOpen(false)
  }

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            {type === 'showcase' ? (
              <Sparkles className="w-5 h-5 text-amber-600" />
            ) : (
              <MessageSquare className="w-5 h-5 text-indigo-600" />
            )}
            <h2 className="text-base font-bold text-slate-900">
              {type === 'showcase' ? 'Share Project Showcase' : 'Start Discussion Thread'}
            </h2>
          </div>
          <button
            type="button"
            onClick={() => setIsCreatePostOpen(false)}
            className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Type Selector Tabs */}
        <div className="p-4 bg-slate-50 border-b border-slate-100">
          <div className="flex rounded-lg bg-slate-200/70 p-1">
            <button
              type="button"
              onClick={() => setType('discussion')}
              className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all flex items-center justify-center gap-1.5 ${
                type === 'discussion'
                  ? 'bg-white text-[#1e3a5f] shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5" />
              Discussion
            </button>
            <button
              type="button"
              onClick={() => setType('showcase')}
              className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all flex items-center justify-center gap-1.5 ${
                type === 'showcase'
                  ? 'bg-amber-500 text-slate-950 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              Project Showcase
            </button>
          </div>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-4 space-y-3.5 text-xs">
          <div>
            <label className="label">Title</label>
            <input
              type="text"
              required
              placeholder={
                type === 'showcase'
                  ? 'e.g. SmartAtt — Dynamic QR Attendance System for CSE Labs'
                  : 'e.g. Tips for mastering Dynamic Programming for Tier-1 placements'
              }
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="input text-xs"
            />
          </div>

          <div>
            <label className="label">Content / Description</label>
            <textarea
              required
              rows={4}
              placeholder={
                type === 'showcase'
                  ? 'Describe the problem it solves, architecture, and key features...'
                  : 'Explain your question, insights, or advice in detail...'
              }
              value={body}
              onChange={e => setBody(e.target.value)}
              className="textarea text-xs"
            />
          </div>

          {/* Showcase Specific Fields */}
          {type === 'showcase' && (
            <div className="space-y-3 p-3 bg-amber-50/40 rounded-xl border border-amber-200/60">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="label flex items-center gap-1">
                    <GitBranch className="w-3 h-3 text-slate-700" />
                    GitHub Repo URL
                  </label>
                  <input
                    type="url"
                    placeholder="https://github.com/..."
                    value={githubUrl}
                    onChange={e => setGithubUrl(e.target.value)}
                    className="input text-xs"
                  />
                </div>
                <div>
                  <label className="label flex items-center gap-1">
                    <LinkIcon className="w-3 h-3 text-amber-700" />
                    Live Demo URL
                  </label>
                  <input
                    type="url"
                    placeholder="https://myproject.vercel.app"
                    value={demoUrl}
                    onChange={e => setDemoUrl(e.target.value)}
                    className="input text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="label flex items-center gap-1">
                  <ImageIcon className="w-3 h-3 text-slate-700" />
                  Image / Screenshot URL
                </label>
                <input
                  type="url"
                  placeholder="https://images.unsplash.com/... or hosted screenshot"
                  value={imageUrl}
                  onChange={e => setImageUrl(e.target.value)}
                  className="input text-xs"
                />
              </div>

              <div>
                <label className="label">Tech Stack (comma-separated)</label>
                <input
                  type="text"
                  placeholder="e.g. Next.js, Supabase, TailwindCSS, TypeScript"
                  value={techStackStr}
                  onChange={e => setTechStackStr(e.target.value)}
                  className="input text-xs"
                />
              </div>
            </div>
          )}

          <div>
            <label className="label">Tags (comma-separated)</label>
            <input
              type="text"
              placeholder="e.g. DSA, Placements, VTUSyllabus, WebDev"
              value={tagsStr}
              onChange={e => setTagsStr(e.target.value)}
              className="input text-xs"
            />
          </div>

          {/* Submit footer */}
          <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setIsCreatePostOpen(false)}
              className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!title.trim() || !body.trim()}
              className="px-4 py-1.5 rounded-lg bg-[#1e3a5f] hover:bg-[#152e4d] text-white font-bold transition-all disabled:opacity-50"
            >
              Publish {type === 'showcase' ? 'Showcase' : 'Post'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
