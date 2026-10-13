'use client'

import Link from 'next/link'
import UserAvatar from '@/components/UserAvatar'
import ConnectButton from '@/components/ConnectButton'
import { Profile } from '@/lib/types'
import { displayName, isVerifiedFaculty } from '@/lib/profile'
import { getYearLabel } from '@/lib/utils'

export default function ProfileCard({ profile, showConnect = true }: { profile: Profile; showConnect?: boolean }) {
  const faculty = isVerifiedFaculty(profile)
  return (
    <article style={{ background: '#0d1426', border: '2px solid #1e3560', padding: 16, boxShadow: '4px 4px 0px #000', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Link href={`/people/${profile.id}`} style={{ display: 'flex', gap: 12, textDecoration: 'none', color: 'inherit' }}>
        <UserAvatar src={profile.avatar_url} name={displayName(profile)} size={48} borderColor={faculty ? '#ffe066' : '#00aaff'} />
        <div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0, fontSize: '0.95rem', color: '#e8f4fd', fontWeight: 700 }}>{displayName(profile)}</h3>
            {faculty && <span className="badge badge-showcase">Verified faculty</span>}
            {profile.role === 'admin' && <span className="badge badge-neon">Admin</span>}
          </div>
          <p style={{ margin: '4px 0 0', fontSize: '0.75rem', color: '#6bafd4' }}>
            {profile.usn || profile.designation || profile.role} · {profile.branch} {profile.year ? `· ${getYearLabel(profile.year)}` : ''}
          </p>
        </div>
      </Link>
      {profile.bio && <p style={{ fontSize: '0.8rem', color: '#a8d4f0', margin: 0 }}>{profile.bio}</p>}
      {(profile.skills?.length ?? 0) > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {profile.skills.slice(0, 6).map(skill => (
            <span key={skill} className="badge" style={{ background: '#0c1220', border: '1px solid #1e3560', color: '#a8d4f0' }}>{skill}</span>
          ))}
        </div>
      )}
      {typeof profile.connection_count === 'number' && (
        <p style={{ fontSize: '0.75rem', color: '#00ffcc', margin: 0 }}>{profile.connection_count} connections</p>
      )}
      {showConnect && <ConnectButton otherUserId={profile.id} />}
    </article>
  )
}
