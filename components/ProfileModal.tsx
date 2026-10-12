'use client'

import React, { useState, useEffect, useRef } from 'react'
import Image from 'next/image'
import { X, Edit2, Save, Plus, GraduationCap, Code, Camera, Loader2 } from 'lucide-react'
import { useCommunity } from '@/contexts/CommunityContext'
import { getAvatarFallback, getYearLabel } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'

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
  const [name, setName] = useState(profile?.name || '')
  const [bio, setBio] = useState(profile?.bio || '')
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatar_url || '')
  const [skills, setSkills] = useState<string[]>(profile?.skills || [])
  const [newSkillInput, setNewSkillInput] = useState('')
  const [uploadingAvatar, setUploadingAvatar] = useState(false)

  useEffect(() => {
    if (profile) {
      setName(profile.name)
      setBio(profile.bio || '')
      setAvatarUrl(profile.avatar_url || '')
      setSkills(profile.skills || [])
      setIsEditMode(false)
    }
  }, [profile])

  if (!isProfileModalOpen || !profile) return null

  const handleAvatarUpload = async (file: File) => {
    if (!currentUser) return
    setUploadingAvatar(true)
    try {
      const ext = file.name.split('.').pop()
      const path = `avatars/${currentUser.id}.${ext}`
      const { error } = await supabase.storage
        .from('community-uploads')
        .upload(path, file, { upsert: true })

      if (!error) {
        const { data } = supabase.storage
          .from('community-uploads')
          .getPublicUrl(path)
        setAvatarUrl(data.publicUrl)
      } else {
        // Fallback: use local object URL for preview
        setAvatarUrl(URL.createObjectURL(file))
      }
    } catch {
      setAvatarUrl(URL.createObjectURL(file))
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
      <div className="modal-content overflow-hidden">
        {/* Banner */}
        <div className="h-24 bg-gradient-to-r from-[#0a1628] via-[#1e3a5f] to-[#254b7a] relative flex items-start justify-between p-4 text-white">
          <div className="flex items-center gap-1.5 bg-black/25 backdrop-blur-sm px-2.5 py-1 rounded-full text-[11px] font-mono text-amber-300">
            <GraduationCap className="w-3.5 h-3.5" />
            <span>UBDT College of Engineering • CSE</span>
          </div>
          <button
            type="button"
            onClick={() => setIsProfileModalOpen(false)}
            className="p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Profile Header */}
        <div className="p-5 pt-0">
          <div className="-mt-12 flex items-end justify-between mb-4">
            {/* Avatar + upload */}
            <div className="relative group/avatar">
              <div className="w-20 h-20 rounded-full overflow-hidden bg-white dark:bg-slate-800 p-1 shadow-lg ring-2 ring-slate-100 dark:ring-slate-700">
                <div className="w-full h-full rounded-full overflow-hidden bg-[#1e3a5f] text-white flex items-center justify-center font-bold text-lg">
                  {avatarUrl ? (
                    <Image src={avatarUrl} alt={name} width={80} height={80} className="w-full h-full object-cover" />
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
                    className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center opacity-0 group-hover/avatar:opacity-100 transition-opacity cursor-pointer"
                  >
                    {uploadingAvatar ? (
                      <Loader2 className="w-5 h-5 text-white animate-spin" />
                    ) : (
                      <Camera className="w-5 h-5 text-white" />
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
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  isEditMode
                    ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                    : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-600'
                }`}
              >
                {isEditMode ? <><Save className="w-3.5 h-3.5" /><span>Save</span></> : <><Edit2 className="w-3.5 h-3.5" /><span>Edit Profile</span></>}
              </button>
            )}
          </div>

          {isEditMode ? (
            <div className="space-y-3 text-xs">
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
                    <span key={s} className="inline-flex items-center gap-1 text-[11px] font-semibold bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-200 px-2 py-0.5 rounded-md">
                      {s}
                      <button type="button" onClick={() => handleRemoveSkill(s)} className="text-slate-400 hover:text-rose-500">×</button>
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
                  <button type="submit" className="px-3 py-1 bg-[#1e3a5f] text-white rounded-lg font-bold text-xs hover:bg-[#152e4d]">Add</button>
                </form>
              </div>
              <div className="pt-2 flex justify-end gap-2 border-t border-slate-100 dark:border-slate-700">
                <button type="button" onClick={() => setIsEditMode(false)} className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-700">Cancel</button>
                <button type="button" onClick={handleSave} className="px-4 py-1.5 rounded-lg bg-[#1e3a5f] hover:bg-[#152e4d] text-white font-bold text-xs">Save Changes</button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 leading-snug">{name}</h3>
                <div className="flex flex-wrap items-center gap-2 mt-1.5">
                  <span className="font-mono text-xs font-bold text-indigo-700 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40 px-2 py-0.5 rounded">
                    {profile.usn}
                  </span>
                  <span className="text-xs font-bold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 rounded border border-amber-200/60">
                    {getYearLabel(profile.year)} • CSE
                  </span>
                </div>
              </div>
              {bio && (
                <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed bg-slate-50 dark:bg-slate-800/60 p-3 rounded-lg border border-slate-100 dark:border-slate-700">
                  {bio}
                </p>
              )}
              {skills && skills.length > 0 && (
                <div>
                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1">
                    <Code className="w-3.5 h-3.5 text-indigo-600" /> Skills &amp; Competencies
                  </h4>
                  <div className="flex flex-wrap gap-1.5">
                    {skills.map(s => (
                      <span key={s} className="text-xs font-semibold bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-200 px-2.5 py-1 rounded-md border border-slate-200/80 dark:border-slate-600">
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
