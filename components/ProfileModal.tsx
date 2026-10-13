'use client'

import React, { useState, useEffect, useRef } from 'react'
import Image from 'next/image'
import { X, Edit2, Save, Plus, GraduationCap, Code, Camera, Loader2 } from 'lucide-react'
import { useCommunity } from '@/contexts/CommunityContext'
import { getAvatarFallback, getYearLabel } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { compressAndTokenize, thumbHashToDataURL } from '@/lib/imageProcessing'
import { uploadToR2 } from '@/lib/r2Upload'

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
  const [avatarThumbhash, setAvatarThumbhash] = useState(profile?.thumbhash || '')
  const [skills, setSkills] = useState<string[]>(profile?.skills || [])
  const [newSkillInput, setNewSkillInput] = useState('')
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [uploadMessage, setUploadMessage] = useState<string | null>(null)

  useEffect(() => {
    if (profile) {
      setName(profile.name || 'Member')
      setBio(profile.bio || '')
      setAvatarUrl(profile.avatar_url || '')
      setAvatarThumbhash(profile.thumbhash || '')
      setSkills(profile.skills || [])
      setIsEditMode(false)
    }
  }, [profile])

  if (!isProfileModalOpen || !profile) return null

  const handleAvatarUpload = async (file: File) => {
    if (!currentUser) return
    setUploadingAvatar(true)
    setUploadMessage(null)
    try {
      // 1. Client-side WebP compression + ThumbHash generation
      const { blob, thumbHash } = await compressAndTokenize(file)
      const path = `avatars/${currentUser.id}.webp`

      // 2. Direct upload to Cloudflare R2
      let publicUrl: string | null = null
      try {
        publicUrl = await uploadToR2(blob, path)
      } catch (uploadErr) {
        console.warn('R2 upload failed, converting to local base64 Data URL:', uploadErr)
      }

      // If R2 upload was not successful, generate a base64 Data URL so avatar always works
      if (!publicUrl) {
        publicUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result as string)
          reader.onerror = reject
          reader.readAsDataURL(blob)
        })
      }

      // 3. Try to update Supabase user_profiles table (safely catch if offline or RLS blocks)
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
      setAvatarThumbhash(thumbHash)
      await updateProfile({ avatar_url: publicUrl, thumbhash: thumbHash })
      setUploadMessage('Avatar updated successfully!')
      setTimeout(() => setUploadMessage(null), 3000)
    } catch (e) {
      console.error('Avatar upload failed', e)
      try {
        const reader = new FileReader()
        reader.onload = async () => {
          const dataUrl = reader.result as string
          setAvatarUrl(dataUrl)
          await updateProfile({ avatar_url: dataUrl })
          setUploadMessage('Avatar saved!')
          setTimeout(() => setUploadMessage(null), 3000)
        }
        reader.readAsDataURL(file)
      } catch {
        setUploadMessage('Failed to update avatar.')
        setTimeout(() => setUploadMessage(null), 3000)
      }
    } finally {
      setUploadingAvatar(false)
    }
  }

  const handleAddSkill = (e: React.FormEvent) => {
    e.preventDefault()
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
    <div className="modal-overlay">
      <div
        className="modal-content overflow-hidden text-white"
        style={{
          background: '#0b1220',
          border: '2px solid #00aaff',
          boxShadow: '6px 6px 0px #000',
          borderRadius: '0px',
        }}
      >
        {/* Banner */}
        <div
          className="h-20 border-b relative flex items-start justify-between p-4 text-white"
          style={{ background: '#060a14', borderColor: '#00aaff' }}
        >
          <div
            className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-sans font-bold text-[#00ffcc]"
            style={{
              background: '#0b1220',
              border: '1px solid #00aaff',
              boxShadow: '2px 2px 0px #000',
            }}
          >
            <GraduationCap className="w-3.5 h-3.5 text-[#00ffcc]" />
            <span>UCC • Computer Science &amp; Engineering</span>
          </div>
          <button
            type="button"
            onClick={() => setIsProfileModalOpen(false)}
            className="p-1 text-slate-300 hover:text-white transition-colors"
            style={{
              background: '#0b1220',
              border: '1px solid #00aaff',
              boxShadow: '2px 2px 0px #000',
            }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Profile Header */}
        <div className="p-5 pt-0">
          <div className="-mt-10 flex items-end justify-between mb-4">
            {/* Avatar + upload */}
            <div className="relative group/avatar">
              <div
                className="w-20 h-20 overflow-hidden p-1"
                style={{
                  background: '#060a14',
                  border: '2px solid #00aaff',
                  boxShadow: '3px 3px 0px #000',
                }}
              >
                <div className="w-full h-full overflow-hidden bg-[#0b1220] text-[#00ffcc] flex items-center justify-center font-bold text-lg">
                  {avatarUrl ? (
                    <img
                      src={avatarUrl}
                      alt={name}
                      onError={() => setAvatarUrl('')}
                      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                    />
                  ) : (
                    getAvatarFallback(name)
                  )}
                </div>
              </div>
              {isEditMode && (
                <>
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    disabled={uploadingAvatar}
                    className="absolute inset-0 bg-black/70 flex items-center justify-center opacity-0 group-hover/avatar:opacity-100 transition-opacity cursor-pointer"
                  >
                    {uploadingAvatar ? (
                      <Loader2 className="w-5 h-5 text-[#00ffcc] animate-spin" />
                    ) : (
                      <Camera className="w-5 h-5 text-[#00ffcc]" />
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
                onClick={() => (isEditMode ? handleSave() : setIsEditMode(true))}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold transition-all"
                style={{
                  background: isEditMode ? '#00ffcc' : '#0b1220',
                  color: isEditMode ? '#060a14' : '#00ffcc',
                  border: `2px solid ${isEditMode ? '#00ffcc' : '#00aaff'}`,
                  boxShadow: '3px 3px 0px #000',
                }}
              >
                {isEditMode ? (
                  <>
                    <Save className="w-3.5 h-3.5 stroke-[2.5]" />
                    <span>SAVE</span>
                  </>
                ) : (
                  <>
                    <Edit2 className="w-3.5 h-3.5" />
                    <span>EDIT PROFILE</span>
                  </>
                )}
              </button>
            )}
          </div>

          {isEditMode ? (
            <div className="space-y-3.5 text-xs">
              <div>
                <label className="label">Full Name</label>
                <input type="text" value={name} onChange={e => setName(e.target.value)} className="input text-xs" />
              </div>
              <div>
                <label className="label">Bio &amp; Interests</label>
                <textarea rows={3} value={bio} onChange={e => setBio(e.target.value)} className="textarea text-xs" />
              </div>
              {/* Skills Editor */}
              <div>
                <label className="label">Skills &amp; Technologies</label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {skills.map(s => (
                    <span
                      key={s}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5"
                      style={{
                        background: '#0e182a',
                        color: '#e2f1fc',
                        border: '1px solid #1f375c',
                        boxShadow: '2px 2px 0px #000',
                      }}
                    >
                      {s}
                      <button type="button" onClick={() => handleRemoveSkill(s)} className="text-slate-400 hover:text-rose-400">×</button>
                    </span>
                  ))}
                </div>
                <form onSubmit={handleAddSkill} className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Add skill (e.g. React, C++, ML)…"
                    value={newSkillInput}
                    onChange={e => setNewSkillInput(e.target.value)}
                    className="flex-1 input text-xs"
                  />
                  <button
                    type="submit"
                    className="px-3.5 py-1 text-xs font-bold"
                    style={{
                      background: '#00ffcc',
                      color: '#060a14',
                      border: '2px solid #00ffcc',
                      boxShadow: '2px 2px 0px #000',
                    }}
                  >
                    Add
                  </button>
                </form>
              </div>
              <div className="pt-3 flex justify-end gap-2 border-t border-[#1f375c]">
                <button
                  type="button"
                  onClick={() => setIsEditMode(false)}
                  className="px-3.5 py-1.5 text-xs font-semibold"
                  style={{
                    background: '#0e182a',
                    color: '#a8d4f0',
                    border: '1px solid #1f375c',
                    boxShadow: '2px 2px 0px #000',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  className="px-4 py-1.5 text-xs font-bold"
                  style={{
                    background: '#00ffcc',
                    color: '#060a14',
                    border: '2px solid #00ffcc',
                    boxShadow: '3px 3px 0px #000',
                  }}
                >
                  Save Changes
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <h3 className="text-base font-extrabold text-white leading-snug">{name || 'Member'}</h3>
                <div className="flex flex-wrap items-center gap-2 mt-1.5">
                  {profile.usn && (
                  <span
                    className="font-sans text-xs font-bold px-2 py-0.5"
                    style={{
                      background: '#060a14',
                      border: '1px solid #00aaff',
                      color: '#00ffcc',
                      boxShadow: '2px 2px 0px #000',
                    }}
                  >
                    {profile.usn}
                  </span>
                  )}
                  <span
                    className="text-xs font-bold px-2 py-0.5"
                    style={{
                      background: '#060a14',
                      border: '1px solid #00aaff',
                      color: '#a8d4f0',
                      boxShadow: '2px 2px 0px #000',
                    }}
                  >
                    {getYearLabel(profile.year)} • CSE
                  </span>
                </div>
              </div>
              {bio && (
                <p
                  className="text-xs sm:text-sm text-slate-200 leading-relaxed p-3"
                  style={{
                    background: '#060a14',
                    border: '1px solid #1f375c',
                    boxShadow: '3px 3px 0px #000',
                  }}
                >
                  {bio}
                </p>
              )}
              {skills && skills.length > 0 && (
                <div>
                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1">
                    <Code className="w-3.5 h-3.5 text-[#00aaff]" /> Skills &amp; Competencies
                  </h4>
                  <div className="flex flex-wrap gap-1.5">
                    {skills.map(s => (
                      <span
                        key={s}
                        className="text-xs font-semibold px-2.5 py-1"
                        style={{
                          background: '#0e182a',
                          border: '1px solid #1f375c',
                          color: '#e2f1fc',
                          boxShadow: '2px 2px 0px #000',
                        }}
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
