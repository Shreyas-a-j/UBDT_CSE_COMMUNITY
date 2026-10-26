'use client'

import React, { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Camera, Check, Edit2, ExternalLink, GraduationCap, Loader2, Plus, Save, X } from 'lucide-react'
import { useCommunity } from '@/contexts/CommunityContext'
import { alumniTag, normalizeProfileLinks, type ProfileLinkErrors } from '@/lib/profile'
import { validateAcademicYear } from '@/lib/validation'
import { getAvatarFallback, getYearLabel } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { compressAndTokenize } from '@/lib/imageProcessing'
import { uploadToR2 } from '@/lib/r2Upload'
import Modal, { ModalCloseButton } from '@/components/Modal'
import ProfileLinks from '@/components/ProfileLinks'

export default function ProfileModal() {
  const {
    isProfileModalOpen,
    setIsProfileModalOpen,
    selectedProfileForView,
    currentUser,
    updateProfile,
    linkStudentUsn,
  } = useCommunity()

  const supabase = createClient()
  const fileRef = useRef<HTMLInputElement>(null)

  const profile = selectedProfileForView || currentUser
  const isEditingSelf = Boolean(profile && currentUser && profile.id === currentUser.id)

  const [isEditMode, setIsEditMode] = useState(false)
  const [name, setName] = useState(profile?.name || 'Member')
  const [bio, setBio] = useState(profile?.bio || '')
  const [year, setYear] = useState<number | null>(profile?.year ?? null)
  const [yearError, setYearError] = useState<string | null>(null)
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatar_url || '')
  const [skills, setSkills] = useState<string[]>(profile?.skills || [])
  const [portfolioUrl, setPortfolioUrl] = useState(profile?.portfolio_url || '')
  const [githubUrl, setGithubUrl] = useState(profile?.github_url || '')
  const [linkedinUrl, setLinkedinUrl] = useState(profile?.linkedin_url || '')
  const [linkErrors, setLinkErrors] = useState<ProfileLinkErrors>({})
  const [newSkillInput, setNewSkillInput] = useState('')
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [uploadMessage, setUploadMessage] = useState<string | null>(null)
  const [usnInput, setUsnInput] = useState('')
  const [usnError, setUsnError] = useState<string | null>(null)
  const [usnPending, setUsnPending] = useState(false)
  const [admissionNumber, setAdmissionNumber] = useState<string | null>(null)

  useEffect(() => {
    if (!isProfileModalOpen || !isEditingSelf || !currentUser) {
      setAdmissionNumber(null)
      return
    }

    let active = true
    void supabase
      .from('student_admission_numbers')
      .select('admission_number')
      .eq('profile_id', currentUser.id)
      .maybeSingle()
      .then(({ data, error }) => {
        // A missing table means the additive migration has not been applied
        // yet. Hide the row rather than logging the private value.
        if (!active || error) return
        setAdmissionNumber(
          typeof data?.admission_number === 'string' ? data.admission_number : null,
        )
      })

    return () => {
      active = false
    }
  }, [isProfileModalOpen, isEditingSelf, currentUser?.id])

  useEffect(() => {
    if (profile) {
      queueMicrotask(() => {
        setName(profile.name || 'Member')
        setBio(profile.bio || '')
        setYear(profile.year ?? null)
        setYearError(null)
        setAvatarUrl(profile.avatar_url || '')
        setSkills(profile.skills || [])
        setPortfolioUrl(profile.portfolio_url || '')
        setGithubUrl(profile.github_url || '')
        setLinkedinUrl(profile.linkedin_url || '')
        setLinkErrors({})
        setUsnInput('')
        setUsnError(null)
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

  const handleLinkUsn = async (event: React.FormEvent) => {
    event.preventDefault()
    if (usnPending) return
    setUsnPending(true)
    setUsnError(null)
    const result = await linkStudentUsn(usnInput)
    setUsnPending(false)
    if (!result.ok) {
      setUsnError(result.error || 'Could not link the USN.')
      return
    }
    setUsnInput('')
  }

  const handleSave = () => {
    const isStudent = profile.member_type === 'student'
    if (isStudent) {
      const yearMessage = validateAcademicYear(year)
      if (yearMessage) {
        setYearError(yearMessage)
        return
      }
    }

    const links = normalizeProfileLinks({
      portfolio_url: portfolioUrl,
      github_url: githubUrl,
      linkedin_url: linkedinUrl,
    })
    if (Object.keys(links.errors).length > 0) {
      setLinkErrors(links.errors)
      return
    }

    setYearError(null)
    setLinkErrors({})
    updateProfile({
      name: name.trim(),
      bio: bio.trim(),
      avatar_url: avatarUrl || null,
      skills,
      ...(isStudent ? { year } : {}),
      ...links.values,
    })
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
          <p className="mb-3 flex items-center gap-1.5 rounded-md border border-accent/30 bg-accent/10 px-2.5 py-1.5 text-[11.5px] text-accent-text">
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

            {isEditingSelf && profile.member_type === 'student' && (
              <div>
                <label className="label" htmlFor="profile-usn">
                  {profile.usn ? 'USN' : 'Add your USN'}
                </label>
                {profile.usn ? (
                  <input
                    id="profile-usn"
                    type="text"
                    value={profile.usn}
                    readOnly
                    className="field font-mono"
                  />
                ) : (
                  <form onSubmit={handleLinkUsn} className="flex gap-2">
                    <input
                      id="profile-usn"
                      type="text"
                      value={usnInput}
                      onChange={event => {
                        setUsnInput(event.target.value.toUpperCase())
                        setUsnError(null)
                      }}
                      className="field flex-1 font-mono uppercase placeholder:normal-case"
                      placeholder="e.g. 4UB24CS045"
                      maxLength={12}
                      autoCapitalize="characters"
                      aria-invalid={Boolean(usnError)}
                      aria-describedby={usnError ? 'profile-usn-error' : undefined}
                    />
                    <button
                      type="submit"
                      className="btn btn-soft shrink-0"
                      disabled={!usnInput.trim() || usnPending}
                    >
                      {usnPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Link'}
                    </button>
                  </form>
                )}
                {usnError && (
                  <p id="profile-usn-error" role="alert" className="mt-1 text-[11px] text-danger">
                    {usnError}
                  </p>
                )}
                {!profile.usn && (
                  <p className="mt-1.5 text-[10.5px] text-dim">
                    You can link a USN once. It cannot be changed later.
                  </p>
                )}
              </div>
            )}

            {profile.member_type === 'student' && (
              <div>
                <label className="label" htmlFor="profile-year">Academic year</label>
                <select
                  id="profile-year"
                  value={year ?? ''}
                  onChange={event => {
                    setYear(event.target.value ? Number(event.target.value) : null)
                    setYearError(null)
                  }}
                  className="field"
                  required
                  aria-invalid={Boolean(yearError)}
                  aria-describedby={yearError ? 'profile-year-error' : undefined}
                >
                  <option value="">Select your academic year</option>
                  <option value={1}>1st year</option>
                  <option value={2}>2nd year</option>
                  <option value={3}>3rd year</option>
                  <option value={4}>4th year</option>
                </select>
                {yearError && (
                  <p id="profile-year-error" className="mt-1 text-[11px] text-danger">
                    {yearError}
                  </p>
                )}
              </div>
            )}

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

            <div className="space-y-2.5 border-t border-line pt-4">
              <div>
                <h3 className="text-[12px] font-semibold text-ink">Public links</h3>
                <p className="mt-0.5 text-[11px] text-dim">
                  Optional. Bare domains like github.com/you are saved as HTTPS links.
                </p>
              </div>

              <div>
                <label className="label" htmlFor="profile-portfolio-url">Portfolio URL</label>
                <input
                  id="profile-portfolio-url"
                  type="text"
                  inputMode="url"
                  autoComplete="url"
                  value={portfolioUrl}
                  onChange={e => {
                    setPortfolioUrl(e.target.value)
                    if (linkErrors.portfolio_url) {
                      setLinkErrors(prev => ({ ...prev, portfolio_url: undefined }))
                    }
                  }}
                  className="field"
                  placeholder="https://your-site.dev"
                  aria-invalid={Boolean(linkErrors.portfolio_url)}
                  aria-describedby={linkErrors.portfolio_url ? 'profile-portfolio-error' : undefined}
                />
                {linkErrors.portfolio_url && (
                  <p id="profile-portfolio-error" className="mt-1 text-[11px] text-danger">
                    {linkErrors.portfolio_url}
                  </p>
                )}
              </div>

              <div>
                <label className="label" htmlFor="profile-github-url">GitHub URL</label>
                <input
                  id="profile-github-url"
                  type="text"
                  inputMode="url"
                  autoComplete="url"
                  value={githubUrl}
                  onChange={e => {
                    setGithubUrl(e.target.value)
                    if (linkErrors.github_url) {
                      setLinkErrors(prev => ({ ...prev, github_url: undefined }))
                    }
                  }}
                  className="field"
                  placeholder="github.com/username"
                  aria-invalid={Boolean(linkErrors.github_url)}
                  aria-describedby={linkErrors.github_url ? 'profile-github-error' : undefined}
                />
                {linkErrors.github_url && (
                  <p id="profile-github-error" className="mt-1 text-[11px] text-danger">
                    {linkErrors.github_url}
                  </p>
                )}
              </div>

              <div>
                <label className="label" htmlFor="profile-linkedin-url">LinkedIn URL</label>
                <input
                  id="profile-linkedin-url"
                  type="text"
                  inputMode="url"
                  autoComplete="url"
                  value={linkedinUrl}
                  onChange={e => {
                    setLinkedinUrl(e.target.value)
                    if (linkErrors.linkedin_url) {
                      setLinkErrors(prev => ({ ...prev, linkedin_url: undefined }))
                    }
                  }}
                  className="field"
                  placeholder="linkedin.com/in/username"
                  aria-invalid={Boolean(linkErrors.linkedin_url)}
                  aria-describedby={linkErrors.linkedin_url ? 'profile-linkedin-error' : undefined}
                />
                {linkErrors.linkedin_url && (
                  <p id="profile-linkedin-error" className="mt-1 text-[11px] text-danger">
                    {linkErrors.linkedin_url}
                  </p>
                )}
              </div>
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
                {profile.member_type === 'alumni' && profile.graduation_year ? (
                  <span className="chip chip-peach">
                    <GraduationCap className="h-3 w-3" /> Class of {profile.graduation_year}
                  </span>
                ) : (
                  <span className="chip">{getYearLabel(profile.year)}</span>
                )}
                <span className="chip">CSE</span>
                {profile.role === 'faculty' && <span className="chip chip-warn">Faculty</span>}
                {profile.member_type === 'alumni' && (
                  <span className="chip chip-peach">{alumniTag(profile.graduation_year)}</span>
                )}
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

            {isEditingSelf && admissionNumber && (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-canvas px-3 py-2">
                <span className="text-[11.5px] text-muted">Admission number on file</span>
                <span className="chip chip-mono">{admissionNumber}</span>
              </div>
            )}

            <ProfileLinks profile={profile} />

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
                className="inline-flex items-center gap-1.5 text-[12px] font-medium text-accent-text hover:underline"
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
