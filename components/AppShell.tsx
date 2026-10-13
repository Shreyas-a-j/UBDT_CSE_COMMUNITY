'use client'

import { Suspense } from 'react'
import Navbar from '@/components/Navbar'
import CreatePostModal from '@/components/CreatePostModal'
import CreateEventModal from '@/components/CreateEventModal'
import ProfileModal from '@/components/ProfileModal'
import AuthModal from '@/components/AuthModal'
import { GraduationCap } from 'lucide-react'
import { useCommunity } from '@/contexts/CommunityContext'

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { setFeedFilter } = useCommunity()

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: '#060a14',
        color: '#a8d4f0',
      }}
    >
      <Suspense
        fallback={
          <div
            style={{
              minHeight: 64,
              background: '#090e1c',
              borderBottom: '1px solid #1e3560',
            }}
          />
        }
      >
        <Navbar />
      </Suspense>

      <main style={{ flex: 1 }} className="app-container w-full">
        {children}
      </main>

      <footer
        style={{
          borderTop: '2px solid #1e3560',
          background: '#090e1c',
          padding: '20px 0',
          marginTop: 'auto',
        }}
      >
        <div
          className="app-container"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            alignItems: 'center',
            textAlign: 'center',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <GraduationCap
              style={{ width: 18, height: 18, color: '#00aaff' }}
            />
            <span
              style={{
                fontSize: '0.8rem',
                color: '#e8f4fd',
                fontWeight: 700,
                letterSpacing: '0.04em',
              }}
            >
              UCC — COMPUTER SCIENCE &amp; ENGINEERING
            </span>
          </div>

          <button
            type="button"
            onClick={() => {
              setFeedFilter('all')
              window.scrollTo({ top: 0, behavior: 'smooth' })
            }}
            style={{
              fontSize: '0.75rem',
              color: '#6bafd4',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              textDecoration: 'underline',
              fontWeight: 600,
            }}
          >
            BACK TO TOP ↑
          </button>
        </div>
      </footer>

      <CreatePostModal />
      <CreateEventModal />
      <ProfileModal />
      <AuthModal />
    </div>
  )
}