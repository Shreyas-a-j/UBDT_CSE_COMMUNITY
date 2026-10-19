'use client'

import React, { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Camera, Check, Edit2, ExternalLink, Loader2, Plus, Save, X } from 'lucide-react'
import { useCommunity } from '@/contexts/CommunityContext'
import { getAvatarFallback, getYearLabel } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { compressAndTokenize } from '@/lib/imageProcessing'
import { uploadToR2 } from '@/lib/r2Upload'
import Modal, { ModalCloseButton } from '@/components/Modal'

export default function ProfileModal() {
  const {
    isProfileModalOpen,
    setIsProfileModalOpen,
    selectedProfileForView,
    currentUser,
    updateProfile,
  } = useCommunity()

  const supabase = createClient()
  const fileRef = useRef<HTMLInputElement>(null)

  const profile = selectedProfileForView || currentUser
  const isEditingSelf = Boolean(profile && currentUser && profile.id === currentUser.id)

  const [isEditMode, setIsEditMode] = useState(false)
  const [name, setName] = useState(profile?.name || 'Member')
  const [bio, setBio] = useState(profile?.bio || '')
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatar_url || '')
  const [skills, setSkills] = useState<string[]>(profile?.skills || [])
  const [newSkillInput, setNewSkillInput] = useState('')
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [uploadMessage, setUploadMessage] = useState<string | null>(null)

  useEffect(() => {
    if (profile) {
      queueMicrotask(() => {
        setName(profile.name || 'Member')
        setBio(profile.bio || '')
        setAvatarUrl(profile.avatar_url || '')
        setSkills(profile.skills || [])
        setIsEditMode(false)
      })
    }
  }, [profile])

  const close = () => setIsProfileModalOpen(false)

  if (!isProfileModalOpen || !profile) return null

  const handleAvatarUpload = async (file: File) => {
    if (!currentUser) return
    setUploadingAvatar(true)
    setUploadMessage(null)
    try {
      const { blob, thumbHash } = await compressAndTokenize(file)
      const path = `avatars/${currentUser.id}.webp`

      let publicUrl: string | null = null
      try {
        publicUrl = await uploadToR2(blob, path)
      } catch (uploadErr) {
        console.warn('R2 upload failed, converting to local base64 Data URL:', uploadErr)
      }

      if (!publicUrl) {
        publicUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result as string)
          reader.onerror = reject
          reader.readAsDataURL(blob)
        })
      }

      try {
        await supabase
          .from('profiles')
          .update({
            avatar_url: publicUrl,
            thumbhash: thumbHash,
            updated_at: new Date().toISOString(),
          })
          .eq('id', currentUser.id)
      } catch (supaErr) {
        console.warn('Supabase profile update warning:', supaErr)
      }

      setAvatarUrl(publicUrl)
      await updateProfile({ avatar_url: publicUrl, thumbhash: thumbHash })
      setUploadMessage('Avatar updated')
      setTimeout(() => setUploadMessage(null), 3000)
    } catch (e) {
      console.error('Avatar upload failed', e)
      try {
        const reader = new FileReader()
        reader.onload = async () => {
          const dataUrl = reader.result as string
          setAvatarUrl(dataUrl)
          await updateProfile({ avatar_url: dataUrl })
          setUploadMessage('Avatar saved')
          setTimeout(() => setUploadMessage(null), 3000)
        }
        reader.readAsDataURL(file)
      } catch {
        setUploadMessage('Could not update avatar')
        setTimeout(() => setUploadMessage(null), 3000)
      }
    } finally {
      setUploadingAvatar(false)
    }
  }

  const handleAddSkill = (event: React.FormEvent) => {
    event.preventDefault()
    if (!newSkillInput.trim()) return
    if (!skills.includes(newSkillInput.trim())) {
      setSkills([...skills, newSkillInput.trim()])
    }
    setNewSkillInput('')
  }

  const handleRemoveSkill = (skillToRemove: string) => {
    setSkills(skills.filter(s => s !== skillToRemove))
  }

  const handleSave = () => {
    updateProfile({ name: name.trim(), bio: bio.trim(), avatar_url: avatarUrl || null, skills })
    setIsEditMode(false)
  }

  return (
    <Modal open={isProfileModalOpen} onClose={close} labelledBy="profile-modal-title">
      <div className="relative h-20 border-b border-line bg-[#191a2b]">
        <div className="absolute inset-0 dot-grid opacity-25" aria-hidden />
        <div
          className="pointer-events-none absolute -right-2 top-1/2 -translate-y-1/2 select-none font-mono text-[56px] font-bold leading-none text-white/[0.04]"
          aria-hidden
        >
          &lt;/&gt;
        </div>
        <span className="absolute left-4 top-4 inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.06] px-2 py-1 text-[10px] font-medium text-header-muted backdrop-blur">
          UBDT CSE
        </span>
        <div className="absolute right-3 top-3">
          <ModalCloseButton onClick={close} label="Close profile" />
        </div>
      </div>

      <div className="modal-body">
        <div className="-mt-10 mb-4 flex items-end justify-between gap-3">
          <div className="group relative">
            <span className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-full border-2 border-surface bg-elevated font-mono text-xl font-semibold text-muted ring-1 ring-line">
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt={name}
                  onError={() => setAvatarUrl('')}
                  className="h-full w-full object-cover"
                />
              ) : (
                getAvatarFallback(name)
              )}
            </span>

            {isEditMode && (
              <>
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploadingAvatar}
                  aria-label="Change avatar"
                  className="absolute inset-0 flex items-center justify-center rounded-full bg-black/65 text-ink opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                >
                  {uploadingAvatar ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <Camera className="h-5 w-5" />
                  )}
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={e => e.target.files?.[0] && handleAvatarUpload(e.target.files[0])}
                />
              </>
            )}
          </div>

          {isEditingSelf && (
            <button
              type="button"
              className={`btn ${isEditMode ? 'btn-accent' : 'btn-outline'} btn-sm`}
              onClick={() => (isEditMode ? handleSave() : setIsEditMode(true))}
            >
              {isEditMode ? (
                <>
                  <Save className="h-3.5 w-3.5" /> Save
                </>
              ) : (
                <>
                  <Edit2 className="h-3.5 w-3.5" /> Edit profile
                </>
              )}
            </button>
          )}
        </div>

        {uploadMessage && (
          <p className="mb-3 flex items-center gap-1.5 rounded-md border border-accent/30 bg-accent/10 px-2.5 py-1.5 text-[11.5px] text-accent">
            <Check className="h-3 w-3" /> {uploadMessage}
          </p>
        )}

        {isEditMode ? (
          <div className="space-y-3.5">
            <div>
              <label className="label" htmlFor="profile-name">Full name</label>
              <input
                id="profile-name"
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                className="field"
              />
            </div>

            <div>
              <label className="label" htmlFor="profile-bio">Bio and interests</label>
              <textarea
                id="profile-bio"
                rows={3}
                value={bio}
                onChange={e => setBio(e.target.value)}
                className="field-area"
                placeholder="What are you working on?"
              />
            </div>

            <div>
              <span className="label">Skills and technologies</span>
              <div className="mb-2 flex flex-wrap gap-1.5">
                {skills.length === 0 && (
                  <span className="text-[11.5px] text-dim">No skills added yet.</span>
                )}
                {skills.map(skill => (
                  <span key={skill} className="chip py-1">
                    {skill}
                    <button
                      type="button"
                      onClick={() => handleRemoveSkill(skill)}
                      aria-label={`Remove ${skill}`}
                      className="text-dim transition-colors hover:text-danger"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
              <form onSubmit={handleAddSkill} className="flex gap-2">
                <input
                  type="text"
                  placeholder="Add a skill, e.g. React or C++"
                  value={newSkillInput}
                  onChange={e => setNewSkillInput(e.target.value)}
                  className="field flex-1"
                  aria-label="Add a skill"
                />
                <button type="submit" className="btn btn-soft shrink-0" disabled={!newSkillInput.trim()}>
                  <Plus className="h-4 w-4" /> Add
                </button>
              </form>
            </div>

            <div className="flex justify-end gap-2 border-t border-line pt-4">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setIsEditMode(false)}>
                Cancel
              </button>
              <button type="button" className="btn btn-accent btn-sm" onClick={handleSave}>
                Save changes
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <h2 id="profile-modal-title" className="text-[18px] font-semibold text-ink">
                {name || 'Member'}
              </h2>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {profile.usn && <span className="chip chip-mono">{profile.usn}</span>}
                <span className="chip">{getYearLabel(profile.year)}</span>
                <span className="chip">CSE</span>
                {profile.role === 'faculty' && <span className="chip chip-warn">Faculty</span>}
              </div>
            </div>

            {bio ? (
              <p className="rounded-lg border border-line bg-canvas p-3 text-[12.5px] leading-relaxed text-muted">
                {bio}
              </p>
            ) : (
              <p className="text-[12.5px] text-dim">
                {isEditingSelf ? 'Add a short bio so classmates know what you work on.' : 'No bio yet.'}
              </p>
            )}

            {skills.length > 0 && (
              <div>
                <h3 className="mb-2 text-[12px] font-semibold text-ink">Skills</h3>
                <div className="flex flex-wrap gap-1.5">
                  {skills.map(skill => (
                    <span key={skill} className="chip py-1">{skill}</span>
                  ))}
                </div>
              </div>
            )}

            <div className="border-t border-line pt-4">
              <Link
                href={`/people/${profile.id}`}
                onClick={close}
                className="inline-flex items-center gap-1.5 text-[12px] font-medium text-accent hover:underline"
              >
                Open full profile <ExternalLink className="h-3 w-3" />
              </Link>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
