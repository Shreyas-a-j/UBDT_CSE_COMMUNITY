'use client'

import { Suspense, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Megaphone, Loader2, AlertCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import AppShell from '@/components/AppShell'
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
      <AppShell>
        <div style={{ maxWidth: 800, margin: '0 auto', padding: 60, textAlign: 'center' }}>
          <AlertCircle style={{ width: 48, height: 48, color: '#ff6688', margin: '0 auto 16px' }} />
          <p style={{ color: '#e8f4fd', fontSize: '1rem' }}>Access denied: Faculty verification required</p>
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell>
      <div style={{ maxWidth: 800, margin: '0 auto', padding: 20 }}>
        {/* Back button */}
        <button
          onClick={() => router.back()}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 20,
            padding: '8px 12px',
            background: 'transparent',
            border: '2px solid #1e3560',
            color: '#00aaff',
            fontSize: '0.875rem',
            fontWeight: 600,
            cursor: 'pointer',
            boxShadow: '2px 2px 0px #000',
          }}
        >
          <ArrowLeft style={{ width: 16, height: 16 }} />
          BACK
        </button>

        {/* Form */}
        <div
          style={{
            background: '#0d1426',
            border: '2px solid #1e3560',
            padding: 24,
            boxShadow: '4px 4px 0px #000',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
            <Megaphone style={{ width: 28, height: 28, color: '#ffe066' }} />
            <h1 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#e8f4fd', margin: 0 }}>
              CREATE ANNOUNCEMENT
            </h1>
          </div>

          {error && (
            <div
              style={{
                padding: '10px 14px',
                background: 'rgba(255,68,102,0.1)',
                border: '2px solid rgba(255,68,102,0.4)',
                color: '#ff6688',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: 20,
                boxShadow: '2px 2px 0px #661133',
              }}
            >
              <AlertCircle style={{ width: 16, height: 16, flexShrink: 0 }} />
              <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* Title */}
            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '0.875rem',
                  fontWeight: 700,
                  color: '#e8f4fd',
                  marginBottom: 8,
                  textTransform: 'uppercase',
                }}
              >
                Announcement Title
              </label>
              <input
                type="text"
                required
                placeholder="e.g. Project Submission Deadline Extended"
                value={title}
                onChange={e => {
                  setTitle(e.target.value)
                  setError('')
                }}
                maxLength={200}
                style={{
                  width: '100%',
                  padding: '12px 14px',
                  background: '#060a14',
                  border: '2px solid #1e3560',
                  color: '#e8f4fd',
                  fontSize: '0.9rem',
                  outline: 'none',
                }}
              />
              <div style={{ fontSize: '0.75rem', color: '#6bafd4', marginTop: 6 }}>
                {title.length}/200 characters
              </div>
            </div>

            {/* Body */}
            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '0.875rem',
                  fontWeight: 700,
                  color: '#e8f4fd',
                  marginBottom: 8,
                  textTransform: 'uppercase',
                }}
              >
                Announcement Content
              </label>
              <textarea
                required
                placeholder="Write your announcement here. This will be visible to all students in the community feed."
                value={body}
                onChange={e => {
                  setBody(e.target.value)
                  setError('')
                }}
                maxLength={5000}
                rows={10}
                style={{
                  width: '100%',
                  padding: '12px 14px',
                  background: '#060a14',
                  border: '2px solid #1e3560',
                  color: '#e8f4fd',
                  fontSize: '0.9rem',
                  outline: 'none',
                  resize: 'vertical',
                  fontFamily: 'inherit',
                  lineHeight: 1.6,
                }}
              />
              <div style={{ fontSize: '0.75rem', color: '#6bafd4', marginTop: 6 }}>
                {body.length}/5000 characters
              </div>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={loading || !title.trim() || !body.trim()}
              style={{
                padding: '12px 20px',
                background: loading || !title.trim() || !body.trim() ? '#1e3560' : '#ffe066',
                color: loading || !title.trim() || !body.trim() ? '#6bafd4' : '#060a14',
                border: '2px solid',
                borderColor: loading || !title.trim() || !body.trim() ? '#1e3560' : '#ccb300',
                fontSize: '0.9rem',
                fontWeight: 700,
                cursor: loading || !title.trim() || !body.trim() ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                boxShadow: loading || !title.trim() || !body.trim() ? 'none' : '4px 4px 0px #665500',
                textTransform: 'uppercase',
              }}
            >
              {loading ? (
                <>
                  <Loader2 style={{ width: 18, height: 18 }} className="animate-spin" />
                  PUBLISHING...
                </>
              ) : (
                <>
                  <Megaphone style={{ width: 18, height: 18 }} />
                  PUBLISH ANNOUNCEMENT
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    </AppShell>
  )
}

export default function CreateAnnouncementPage() {
  return (
    <Suspense
      fallback={
        <AppShell>
          <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
            <Loader2 style={{ width: 48, height: 48, color: '#ffe066' }} className="animate-spin" />
          </div>
        </AppShell>
      }
    >
      <CreateAnnouncement />
    </Suspense>
  )
}
