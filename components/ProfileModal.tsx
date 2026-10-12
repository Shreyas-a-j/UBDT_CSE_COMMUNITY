'use client'

import React, { useState, useEffect } from 'react'
import Image from 'next/image'
import { X, Edit2, Save, Plus, Trash2, Check, GraduationCap, Code } from 'lucide-react'
import { useCommunity } from '@/contexts/CommunityContext'
import { getAvatarFallback, getYearLabel } from '@/lib/utils'

export default function ProfileModal() {
  const {
    isProfileModalOpen,
    setIsProfileModalOpen,
    selectedProfileForView,
    currentUser,
    updateProfile,
  } = useCommunity()

  const profile = selectedProfileForView || currentUser
  const isEditingSelf = profile.id === currentUser.id

  const [isEditMode, setIsEditMode] = useState(false)
  const [name, setName] = useState(profile.name)
  const [bio, setBio] = useState(profile.bio || '')
  const [avatarUrl, setAvatarUrl] = useState(profile.avatar_url || '')
  const [skills, setSkills] = useState<string[]>(profile.skills || [])
  const [newSkillInput, setNewSkillInput] = useState('')

  useEffect(() => {
    setName(profile.name)
    setBio(profile.bio || '')
    setAvatarUrl(profile.avatar_url || '')
    setSkills(profile.skills || [])
    setIsEditMode(false)
  }, [profile])

  if (!isProfileModalOpen) return null

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
    updateProfile({
      name: name.trim(),
      bio: bio.trim(),
      avatar_url: avatarUrl.trim() || null,
      skills,
    })
    setIsEditMode(false)
  }

  return (
    <div className="modal-overlay">
      <div className="modal-content overflow-hidden">
        {/* Banner with UBDT CSE theme */}
        <div className="h-24 bg-gradient-to-r from-[#0a1628] via-[#1e3a5f] to-[#254b7a] relative p-4 flex items-start justify-between text-white">
          <div className="flex items-center gap-1.5 bg-black/20 backdrop-blur-sm px-2.5 py-0.5 rounded-full text-[11px] font-mono text-amber-300">
            <GraduationCap className="w-3.5 h-3.5" />
            <span>UBDT College of Engineering • CSE</span>
          </div>
          <button
            type="button"
            onClick={() => setIsProfileModalOpen(false)}
            className="p-1 rounded-md text-white/80 hover:text-white hover:bg-white/10"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Profile Card Header */}
        <div className="p-5 pt-0 relative">
          <div className="-mt-12 flex items-end justify-between mb-3">
            <div className="w-20 h-20 rounded-full overflow-hidden bg-white p-1 shadow-lg ring-2 ring-slate-100">
              <div className="w-full h-full rounded-full overflow-hidden bg-[#1e3a5f] text-white flex items-center justify-center font-bold text-lg">
                {avatarUrl ? (
                  <Image
                    src={avatarUrl}
                    alt={name}
                    width={80}
                    height={80}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  getAvatarFallback(name)
                )}
              </div>
            </div>

            {isEditingSelf && (
              <button
                type="button"
                onClick={() => setIsEditMode(!isEditMode)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  isEditMode
                    ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {isEditMode ? (
                  <>
                    <Save className="w-3.5 h-3.5" />
                    <span>Done Editing</span>
                  </>
                ) : (
                  <>
                    <Edit2 className="w-3.5 h-3.5" />
                    <span>Edit Profile</span>
                  </>
                )}
              </button>
            )}
          </div>

          {/* Profile Details or Edit Form */}
          {isEditMode ? (
            <div className="space-y-3 text-xs pt-2">
              <div>
                <label className="label">Full Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="input text-xs"
                />
              </div>

              <div>
                <label className="label">Avatar Image URL</label>
                <input
                  type="url"
                  placeholder="https://images.unsplash.com/..."
                  value={avatarUrl}
                  onChange={e => setAvatarUrl(e.target.value)}
                  className="input text-xs"
                />
              </div>

              <div>
                <label className="label">Bio & Interests</label>
                <textarea
                  rows={3}
                  value={bio}
                  onChange={e => setBio(e.target.value)}
                  className="textarea text-xs"
                />
              </div>

              {/* Skills Editor */}
              <div>
                <label className="label">Skills & Technologies</label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {skills.map(s => (
                    <span
                      key={s}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold bg-slate-100 text-slate-800 px-2 py-0.5 rounded-md"
                    >
                      {s}
                      <button
                        type="button"
                        onClick={() => handleRemoveSkill(s)}
                        className="text-slate-400 hover:text-rose-600"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>

                <form onSubmit={handleAddSkill} className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Add skill (e.g. Next.js, C++, System Design)..."
                    value={newSkillInput}
                    onChange={e => setNewSkillInput(e.target.value)}
                    className="flex-1 input text-xs"
                  />
                  <button
                    type="submit"
                    className="px-3 py-1 bg-[#1e3a5f] text-white rounded-lg font-bold hover:bg-[#152e4d]"
                  >
                    Add
                  </button>
                </form>
              </div>

              <div className="pt-3 flex justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={handleSave}
                  className="px-4 py-1.5 rounded-lg bg-[#1e3a5f] hover:bg-[#152e4d] text-white font-bold"
                >
                  Save Changes
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-bold text-slate-900 leading-snug">{name}</h3>
                <div className="flex items-center gap-2 mt-1">
                  <span className="font-mono text-xs font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded">
                    USN: {profile.usn}
                  </span>
                  <span className="text-xs font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200/60">
                    {getYearLabel(profile.year)} • Branch: CSE
                  </span>
                </div>
              </div>

              {bio && (
                <p className="text-xs sm:text-sm text-slate-600 leading-relaxed bg-slate-50 p-3 rounded-lg border border-slate-100">
                  {bio}
                </p>
              )}

              {/* Skills */}
              {skills && skills.length > 0 && (
                <div>
                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1">
                    <Code className="w-3.5 h-3.5 text-indigo-600" />
                    Skills & Competencies
                  </h4>
                  <div className="flex flex-wrap gap-1.5">
                    {skills.map(s => (
                      <span
                        key={s}
                        className="text-xs font-semibold bg-slate-100 text-slate-800 px-2.5 py-1 rounded-md border border-slate-200/80"
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
