'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertCircle, ArrowLeft, ImagePlus, Loader2, Megaphone, X } from 'lucide-react'
import AppShell from '@/components/AppShell'
import PageHeader from '@/components/PageHeader'
import EmptyState from '@/components/EmptyState'
import { useAuth } from '@/contexts/AuthContext'
import { useCommunity } from '@/contexts/CommunityContext'
import { canPublishFacultyContent } from '@/lib/profile'
import { compressAndTokenize } from '@/lib/imageProcessing'
import { uploadAnnouncementImage } from '@/lib/r2Upload'
import {
  ANNOUNCEMENT_MAX_IMAGES,
  validateAnnouncementImage,
} from '@/lib/logic/announcements'
import toast from 'react-hot-toast'

interface PendingImage {
  id: string
  file: File
  preview: string
}

function CreateAnnouncement() {
  const router = useRouter()
  const { profile: currentUser } = useAuth()
  const { createAnnouncement } = useCommunity()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [images, setImages] = useState<PendingImage[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Object URLs are revoked when an image is removed and on unmount.
  const imagesRef = useRef<PendingImage[]>([])
  useEffect(() => {
    imagesRef.current = images
  }, [images])
  useEffect(
    () => () => {
      imagesRef.current.forEach(image => URL.revokeObjectURL(image.preview))
    },
    []
  )

  const addImages = (files: FileList | null) => {
    if (!files) return
    setError('')

    const next: PendingImage[] = []
    for (const file of Array.from(files)) {
      if (images.length + next.length >= ANNOUNCEMENT_MAX_IMAGES) {
        setError(`You can attach up to ${ANNOUNCEMENT_MAX_IMAGES} images.`)
        break
      }
      const validationError = validateAnnouncementImage(file)
      if (validationError) {
        setError(validationError)
        continue
      }
      next.push({
        id: `${file.name}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        preview: URL.createObjectURL(file),
      })
    }

    if (next.length > 0) setImages(prev => [...prev, ...next])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const removeImage = (id: string) => {
    setImages(prev => {
      const target = prev.find(image => image.id === id)
      if (target) URL.revokeObjectURL(target.preview)
      return prev.filter(image => image.id !== id)
    })
  }

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
    try {
      // Reuse the existing image pipeline: resize/convert to WebP on the
      // client, then upload through the faculty-gated announcement route.
      const imageUrls: string[] = []
      for (const image of images) {
        const { blob } = await compressAndTokenize(image.file)
        imageUrls.push(await uploadAnnouncementImage(blob, `${image.id}.webp`))
      }

      const created = await createAnnouncement({ title, body, image_urls: imageUrls })
      if (!created) {
        setLoading(false)
        return
      }

      router.push('/announcements')
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : 'The images could not be uploaded. Try again.'
      )
      setLoading(false)
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
        description="Announcements are department-wide and visible to everyone in the community, whatever batch they are browsing."
      />

      <form onSubmit={handleSubmit} className="card overflow-hidden">
        <div className="flex items-center gap-2.5 border-b border-line bg-surface px-5 py-4">
          <span className="flex h-8 w-8 items-center justify-center rounded-md border border-line bg-elevated">
            <Megaphone className="h-4 w-4 text-accent-text" />
          </span>
          <div>
            <p className="text-[13px] font-semibold text-ink">Compose</p>
            <p className="text-[10px] text-dim">Published immediately to #announcements</p>
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

          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="label mb-0">Images (optional)</span>
              <span className="text-[10px] text-dim">
                {images.length}/{ANNOUNCEMENT_MAX_IMAGES}
              </span>
            </div>

            <input
              ref={fileInputRef}
              id="announcement-images"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              multiple
              className="sr-only"
              onChange={e => addImages(e.target.files)}
            />

            {images.length > 0 && (
              <ul className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {images.map((image, index) => (
                  <li
                    key={image.id}
                    className="group relative aspect-square overflow-hidden rounded-md border border-line bg-elevated"
                  >
                    <img
                      src={image.preview}
                      alt={`Selected image ${index + 1}`}
                      className="h-full w-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => removeImage(image.id)}
                      aria-label={`Remove image ${index + 1}`}
                      className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full border border-line bg-canvas/90 text-muted transition-colors hover:text-danger"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={images.length >= ANNOUNCEMENT_MAX_IMAGES || loading}
              className="btn btn-outline btn-sm"
            >
              <ImagePlus className="h-3.5 w-3.5" />
              {images.length === 0 ? 'Add images' : 'Add more'}
            </button>
            <p className="mt-1.5 text-[10.5px] leading-relaxed text-dim">
              PNG, JPEG, WebP or GIF · up to 5 MB each · {ANNOUNCEMENT_MAX_IMAGES} images maximum.
            </p>
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
