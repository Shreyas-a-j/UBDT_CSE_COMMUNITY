'use client'

import Link from 'next/link'
import { GraduationCap } from 'lucide-react'

export default function AuthFormShell({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle: string
  children: React.ReactNode
}) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: '#060a14' }}>
      <div className="modal-content" style={{ maxWidth: 480 }}>
        <div style={{ background: '#090e1c', borderBottom: '2px solid #1e3560', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <Link href="/" style={{ width: 36, height: 36, background: '#00aaff', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '2px 2px 0px #000' }}>
            <GraduationCap style={{ width: 20, height: 20, color: '#060a14' }} />
          </Link>
          <div>
            <h1 style={{ fontSize: '0.95rem', color: '#e8f4fd', fontWeight: 700, margin: 0 }}>{title}</h1>
            <p style={{ fontSize: '0.72rem', color: '#00ffcc', margin: '2px 0 0' }}>{subtitle}</p>
          </div>
        </div>
        <div style={{ padding: 20 }}>{children}</div>
      </div>
    </div>
  )
}
