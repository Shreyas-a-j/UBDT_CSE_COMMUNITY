'use client'

import React, { useState, useRef } from 'react'
import { X, MessageSquare, Sparkles, Link as LinkIcon, GitBranch, Image as ImageIcon, Upload, Loader2, X as RemoveIcon } from 'lucide-react'
import { useCommunity } from '@/contexts/CommunityContext'
import { createClient } from '@/lib/supabase/client'

export default function CreatePostModal() {
  const { isCreatePostOpen, setIsCreatePostOpen, createPost, currentUser } = useCommunity()
  const supabase = createClient()
  const fileRef = useRef<HTMLInputElement>(null)

  const [type, setType] = useState<'discussion' | 'showcase'>('discussion')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [tagsStr, setTagsStr] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [imagePreview, setImagePreview] = useState('')
  const [githubUrl, setGithubUrl] = useState('')
  const [demoUrl, setDemoUrl] = useState('')
  const [techStackStr, setTechStackStr] = useState('')
  const [uploading, setUploading] = useState(false)

  if (!isCreatePostOpen) return null

  const handleImageUpload = async (file: File) => {
    setUploading(true)
    try {
      const ext = file.name.split('.').pop()
      const path = `posts/${Date.now()}.${ext}`
      const { error } = await supabase.storage
        .from('community-uploads')
        .upload(path, file, { upsert: true })

      if (!error) {
        const { data } = supabase.storage.from('community-uploads').getPublicUrl(path)
        setImageUrl(data.publicUrl)
        setImagePreview(data.publicUrl)
      } else {
        const localUrl = URL.createObjectURL(file)
        setImageUrl(localUrl)
        setImagePreview(localUrl)
      }
    } catch {
      const localUrl = URL.createObjectURL(file)
      setImageUrl(localUrl)
      setImagePreview(localUrl)
    } finally {
      setUploading(false)
    }
  }

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
      image_url: imageUrl || null,
      github_url: githubUrl.trim() || null,
      demo_url: demoUrl.trim() || null,
      tech_stack: techStack,
      target_years: [1, 2, 3, 4],
      author_id: '',
    })

    setTitle(''); setBody(''); setTagsStr(''); setImageUrl('')
    setImagePreview(''); setGithubUrl(''); setDemoUrl(''); setTechStackStr('')
    setIsCreatePostOpen(false)
  }

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-100 dark:border-slate-700">
          <div className="flex items-center gap-2">
            {type === 'showcase' ? (
              <Sparkles className="w-5 h-5 text-amber-600" />
            ) : (
              <MessageSquare className="w-5 h-5 text-indigo-600" />
            )}
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
              {type === 'showcase' ? 'Share Project Showcase' : 'Start Discussion Thread'}
            </h2>
          </div>
          <button
            type="button"
            onClick={() => setIsCreatePostOpen(false)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Type Toggle */}
        <div className="p-4 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-700">
          <div className="flex rounded-xl bg-slate-200/70 dark:bg-slate-700/60 p-1">
            <button
              type="button"
              onClick={() => setType('discussion')}
              className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                type === 'discussion'
                  ? 'bg-white dark:bg-slate-900 text-[#1e3a5f] dark:text-indigo-400 shadow-xs'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700'
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5" /> Discussion
            </button>
            <button
              type="button"
              onClick={() => setType('showcase')}
              className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                type === 'showcase'
                  ? 'bg-amber-500 text-slate-950 shadow-xs'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" /> Project Showcase
            </button>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-4 space-y-3.5 text-xs">
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
                  ? 'Describe the problem it solves, architecture, and key features…'
                  : 'Explain your question, insights, or advice in detail…'
              }
              value={body}
              onChange={e => setBody(e.target.value)}
              className="textarea text-xs"
            />
          </div>

          {/* Image Upload (available for both types) */}
          <div>
            <label className="label flex items-center gap-1">
              <ImageIcon className="w-3.5 h-3.5" /> Cover Image / Screenshot
            </label>

            {imagePreview ? (
              <div className="relative rounded-xl overflow-hidden border border-slate-200 dark:border-slate-600">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imagePreview} alt="Preview" className="w-full max-h-48 object-cover" />
                <button
                  type="button"
                  onClick={() => { setImageUrl(''); setImagePreview('') }}
                  className="absolute top-2 right-2 p-1 rounded-full bg-black/60 text-white hover:bg-black/80"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="w-full border-2 border-dashed border-slate-200 dark:border-slate-600 rounded-xl py-5 flex flex-col items-center gap-2 text-slate-400 hover:border-[#1e3a5f] hover:text-[#1e3a5f] dark:hover:border-amber-400 dark:hover:text-amber-400 transition-colors"
              >
                {uploading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <Upload className="w-5 h-5" />
                )}
                <span className="text-[11px] font-medium">
                  {uploading ? 'Uploading…' : 'Click to upload image'}
                </span>
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={e => e.target.files?.[0] && handleImageUpload(e.target.files[0])}
            />
          </div>

          {/* Showcase-specific fields */}
          {type === 'showcase' && (
            <div className="space-y-3 p-3 bg-amber-50/40 dark:bg-amber-950/20 rounded-xl border border-amber-200/60 dark:border-amber-800/40">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="label flex items-center gap-1">
                    <GitBranch className="w-3 h-3" /> GitHub Repo URL
                  </label>
                  <input type="url" placeholder="https://github.com/…" value={githubUrl} onChange={e => setGithubUrl(e.target.value)} className="input text-xs" />
                </div>
                <div>
                  <label className="label flex items-center gap-1">
                    <LinkIcon className="w-3 h-3 text-amber-700" /> Live Demo URL
                  </label>
                  <input type="url" placeholder="https://myproject.vercel.app" value={demoUrl} onChange={e => setDemoUrl(e.target.value)} className="input text-xs" />
                </div>
              </div>
              <div>
                <label className="label">Tech Stack (comma-separated)</label>
                <input type="text" placeholder="e.g. Next.js, Supabase, TypeScript" value={techStackStr} onChange={e => setTechStackStr(e.target.value)} className="input text-xs" />
              </div>
            </div>
          )}

          <div>
            <label className="label">Tags (comma-separated)</label>
            <input type="text" placeholder="e.g. DSA, Placements, WebDev" value={tagsStr} onChange={e => setTagsStr(e.target.value)} className="input text-xs" />
          </div>

          {/* Footer */}
          <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100 dark:border-slate-700">
            <button type="button" onClick={() => setIsCreatePostOpen(false)} className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 font-medium text-xs">
              Cancel
            </button>
            <button
              type="submit"
              disabled={!title.trim() || !body.trim() || uploading}
              className="px-4 py-1.5 rounded-lg bg-[#1e3a5f] hover:bg-[#152e4d] text-white font-bold text-xs transition-all disabled:opacity-50"
            >
              Publish {type === 'showcase' ? 'Showcase' : 'Post'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
