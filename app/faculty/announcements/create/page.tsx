'use client'

import { Suspense, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertCircle, ArrowLeft, Loader2, Megaphone } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import AppShell from '@/components/AppShell'
import PageHeader from '@/components/PageHeader'
import EmptyState from '@/components/EmptyState'
import { useAuth } from '@/contexts/AuthContext'
import { canPublishFacultyContent } from '@/lib/profile'
import { sanitizeText } from '@/lib/validation'
import toast from 'react-hot-toast'

function CreateAnnouncement() {
  const router = useRouter()
  const supabase = createClient()
  const { profile: currentUser } = useAuth()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!currentUser || !canPublishFacultyContent(currentUser)) {
      toast.error('You do not have permission to create announcements')
      return
    }

    setError('')
    if (!title.trim()) {
      setError('Please enter a title')
      return
    }
    if (!body.trim()) {
      setError('Please enter announcement content')
      return
    }

    setLoading(true)
    const { error: insertError } = await supabase.from('announcements').insert({
      author_id: currentUser.id,
      title: sanitizeText(title, 200),
      body: sanitizeText(body, 5000),
    })

    if (insertError) {
      setError(insertError.message)
      setLoading(false)
    } else {
      toast.success('Announcement published')
      router.push('/faculty/dashboard')
    }
  }

  if (!currentUser || !canPublishFacultyContent(currentUser)) {
    return (
      <div className="mx-auto w-full max-w-2xl">
        <EmptyState
          icon={<AlertCircle className="h-6 w-6 text-danger" />}
          title="Access denied"
          body="Faculty verification is required to publish announcements. Contact an administrator if you believe this is a mistake."
          action={
            <button type="button" onClick={() => router.back()} className="btn btn-outline">
              <ArrowLeft className="h-4 w-4" /> Go back
            </button>
          }
        />
      </div>
    )
  }

  const canSubmit = Boolean(title.trim() && body.trim()) && !loading

  return (
    <div className="mx-auto w-full max-w-2xl">
      <button
        type="button"
        onClick={() => router.back()}
        className="mb-5 inline-flex items-center gap-1.5 text-[12px] font-medium text-muted transition-colors hover:text-ink"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to dashboard
      </button>

      <PageHeader
        eyebrow="Faculty workspace"
        title="New announcement"
        description="Announcements are visible to every student in the community feed."
      />

      <form onSubmit={handleSubmit} className="card overflow-hidden">
        <div className="flex items-center gap-2.5 border-b border-line bg-surface px-5 py-4">
          <span className="flex h-8 w-8 items-center justify-center rounded-md border border-line bg-elevated">
            <Megaphone className="h-4 w-4 text-accent" />
          </span>
          <div>
            <p className="text-[13px] font-semibold text-ink">Compose</p>
            <p className="text-[10px] text-dim">Published immediately</p>
          </div>
        </div>

        <div className="space-y-5 p-5">
          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/[0.06] px-3 py-2.5 text-[12.5px] text-danger"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="break-words">{error}</span>
            </div>
          )}

          <div>
            <label htmlFor="announcement-title" className="label">
              Title
            </label>
            <input
              id="announcement-title"
              type="text"
              required
              placeholder="e.g. Project submission deadline extended"
              value={title}
              onChange={e => {
                setTitle(e.target.value)
                setError('')
              }}
              maxLength={200}
              className="field"
            />
            <div className="mt-1.5 flex justify-end text-[10px] text-dim">
              {title.length}/200
            </div>
          </div>

          <div>
            <label htmlFor="announcement-body" className="label">
              Content
            </label>
            <textarea
              id="announcement-body"
              required
              placeholder="Write the announcement. Include dates, venues and any action students need to take."
              value={body}
              onChange={e => {
                setBody(e.target.value)
                setError('')
              }}
              maxLength={5000}
              rows={10}
              className="field-area"
            />
            <div className="mt-1.5 flex justify-end text-[10px] text-dim">
              {body.length}/5000
            </div>
          </div>
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-line bg-surface px-5 py-4 sm:flex-row sm:items-center sm:justify-end">
          <button
            type="button"
            onClick={() => router.back()}
            className="btn btn-ghost"
            disabled={loading}
          >
            Cancel
          </button>
          <button type="submit" disabled={!canSubmit} className="btn btn-accent">
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Publishing…
              </>
            ) : (
              <>
                <Megaphone className="h-4 w-4" /> Publish announcement
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  )
}

export default function CreateAnnouncementPage() {
  return (
    <AppShell>
      <Suspense
        fallback={
          <div className="mx-auto flex w-full max-w-2xl justify-center py-24">
            <Loader2 className="h-6 w-6 animate-spin text-dim" />
          </div>
        }
      >
        <CreateAnnouncement />
      </Suspense>
    </AppShell>
  )
}
