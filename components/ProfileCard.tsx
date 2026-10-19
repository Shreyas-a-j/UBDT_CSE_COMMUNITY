'use client'

import Link from 'next/link'
import { BadgeCheck, Shield } from 'lucide-react'
import UserAvatar from '@/components/UserAvatar'
import ConnectButton from '@/components/ConnectButton'
import { Profile } from '@/lib/types'
import { displayName, isVerifiedFaculty } from '@/lib/profile'
import { getYearLabel } from '@/lib/utils'

export default function ProfileCard({
  profile,
  showConnect = true,
}: {
  profile: Profile
  showConnect?: boolean
}) {
  const faculty = isVerifiedFaculty(profile)
  const skills = Array.isArray(profile.skills) ? profile.skills : []

  return (
    <article className="card card-hover flex h-full flex-col gap-3.5 p-5">
      <Link
        href={`/people/${profile.id}`}
        className="group flex items-start gap-3"
      >
        <UserAvatar
          src={profile.avatar_url}
          name={displayName(profile)}
          size={46}
          borderColor={faculty ? 'var(--color-warn)' : undefined}
        />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="truncate text-[15px] font-semibold text-ink group-hover:underline">
              {displayName(profile)}
            </h3>
            {faculty && (
              <span className="chip chip-warn py-0 text-[10px]">
                <BadgeCheck className="h-3 w-3" /> Faculty
              </span>
            )}
            {profile.role === 'admin' && (
              <span className="chip chip-accent py-0 text-[10px]">
                <Shield className="h-3 w-3" /> Admin
              </span>
            )}
          </div>

          <p className="mt-1 truncate text-[11px] text-dim">
            {profile.usn || profile.designation || profile.role}
            {profile.branch ? ` · ${profile.branch}` : ''}
            {profile.year ? ` · ${getYearLabel(profile.year)}` : ''}
          </p>
        </div>
      </Link>

      {profile.bio && (
        <p className="clamp-2 text-[13px] leading-relaxed text-muted">{profile.bio}</p>
      )}

      {skills.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {skills.slice(0, 5).map(skill => (
            <span key={skill} className="chip text-[11px]">{skill}</span>
          ))}
          {skills.length > 5 && (
            <span className="chip border-dashed text-[11px] text-dim">+{skills.length - 5}</span>
          )}
        </div>
      )}

      <div className="mt-auto flex items-center justify-between gap-2 border-t border-line pt-3">
        {typeof profile.connection_count === 'number' ? (
          <span className="text-[10.5px] text-dim">
            {profile.connection_count} connection{profile.connection_count === 1 ? '' : 's'}
          </span>
        ) : (
          <Link
            href={`/people/${profile.id}`}
            className="text-[11px] font-medium text-muted transition-colors hover:text-ink"
          >
            View profile
          </Link>
        )}
        {showConnect && <ConnectButton otherUserId={profile.id} />}
      </div>
    </article>
  )
}
