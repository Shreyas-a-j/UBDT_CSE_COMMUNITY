'use client'

import React, { useState } from 'react'
import { GitBranch, Link as LinkIcon, MessageSquare, Sparkles } from 'lucide-react'
import { useCommunity } from '@/contexts/CommunityContext'
import Modal, { ModalCloseButton } from '@/components/Modal'

export default function CreatePostModal() {
  const { isCreatePostOpen, setIsCreatePostOpen, createPost } = useCommunity()

  const [type, setType] = useState<'discussion' | 'showcase'>('discussion')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [tagsStr, setTagsStr] = useState('')
  const [githubUrl, setGithubUrl] = useState('')
  const [demoUrl, setDemoUrl] = useState('')
  const [techStackStr, setTechStackStr] = useState('')

  // Every close path (Cancel, close button, Escape, overlay click, submit)
  // funnels through `close`, so the draft returns to its initial state and
  // reopening the modal starts a clean composition.
  const resetForm = () => {
    setType('discussion')
    setTitle('')
    setBody('')
    setTagsStr('')
    setGithubUrl('')
    setDemoUrl('')
    setTechStackStr('')
  }

  const close = () => {
    resetForm()
    setIsCreatePostOpen(false)
  }

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
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
    close()
  }

  return (
    <Modal open={isCreatePostOpen} onClose={close} labelledBy="create-post-title">
      <div className="modal-head">
        <div className="flex items-start gap-3">
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${
              type === 'showcase'
                ? 'border-warn/30 bg-warn/10 text-warn'
                : 'border-line bg-elevated text-muted'
            }`}
          >
            {type === 'showcase' ? <Sparkles className="h-4 w-4" /> : <MessageSquare className="h-4 w-4" />}
          </span>
          <div>
            <h2 id="create-post-title" className="text-[16px] font-semibold text-ink">
              New post
            </h2>
            <p className="mt-0.5 text-[12px] text-muted">
              Share a question, an insight or a project with the department.
            </p>
          </div>
        </div>
        <ModalCloseButton onClick={close} />
      </div>

      <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
        <div className="modal-body space-y-4">
          <div
            className="inline-flex w-full rounded-md border border-line bg-elevated p-1"
            role="tablist"
            aria-label="Post type"
          >
            {[
              { id: 'discussion' as const, label: 'Discussion', icon: MessageSquare },
              { id: 'showcase' as const, label: 'Project showcase', icon: Sparkles },
            ].map(option => {
              const active = type === option.id
              const Icon = option.icon
              return (
                <button
                  key={option.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setType(option.id)}
                  className={`flex h-8 flex-1 items-center justify-center gap-1.5 rounded text-[12.5px] font-medium transition-colors ${
                    active ? 'bg-peach-soft text-peach-text' : 'text-muted hover:bg-surface hover:text-ink'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {option.label}
                </button>
              )
            })}
          </div>

          <div>
            <label className="label" htmlFor="post-title">Title</label>
            <input
              id="post-title"
              type="text"
              required
              placeholder={
                type === 'showcase'
                  ? 'e.g. SmartAtt — QR attendance for CSE labs'
                  : 'e.g. How should we prepare for placement DSA rounds?'
              }
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="field"
            />
          </div>

          <div>
            <label className="label" htmlFor="post-body">
              {type === 'showcase' ? 'What did you build?' : 'Details'}
            </label>
            <textarea
              id="post-body"
              required
              rows={4}
              placeholder={
                type === 'showcase'
                  ? 'Describe the problem, the architecture and what you learned…'
                  : 'Add context so people can give you a useful answer…'
              }
              value={body}
              onChange={e => setBody(e.target.value)}
              className="field-area"
            />
          </div>

          {type === 'showcase' && (
            <div className="space-y-3 rounded-md border border-line bg-elevated/50 p-3.5">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="label flex items-center gap-1.5" htmlFor="post-github">
                    <GitBranch className="h-3 w-3" /> GitHub repository
                  </label>
                  <input
                    id="post-github"
                    type="url"
                    placeholder="https://github.com/…"
                    value={githubUrl}
                    onChange={e => setGithubUrl(e.target.value)}
                    className="field"
                  />
                </div>
                <div>
                  <label className="label flex items-center gap-1.5" htmlFor="post-demo">
                    <LinkIcon className="h-3 w-3" /> Live demo
                  </label>
                  <input
                    id="post-demo"
                    type="url"
                    placeholder="https://project.vercel.app"
                    value={demoUrl}
                    onChange={e => setDemoUrl(e.target.value)}
                    className="field"
                  />
                </div>
              </div>
              <div>
                <label className="label" htmlFor="post-stack">Tech stack, comma separated</label>
                <input
                  id="post-stack"
                  type="text"
                  placeholder="Next.js, Supabase, TypeScript"
                  value={techStackStr}
                  onChange={e => setTechStackStr(e.target.value)}
                  className="field"
                />
              </div>
            </div>
          )}

          <div>
            <label className="label" htmlFor="post-tags">Tags, comma separated</label>
            <input
              id="post-tags"
              type="text"
              placeholder="DSA, Placements, WebDev"
              value={tagsStr}
              onChange={e => setTagsStr(e.target.value)}
              className="field"
            />
            <p className="mt-1.5 text-[11px] text-dim">
              Tags help classmates find this post later.
            </p>
          </div>
        </div>

        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={close}>
            Cancel
          </button>
          <button
            type="submit"
            disabled={!title.trim() || !body.trim()}
            className="btn btn-accent"
          >
            Publish {type === 'showcase' ? 'showcase' : 'post'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
