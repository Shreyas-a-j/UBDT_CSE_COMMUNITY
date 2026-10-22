'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useCommunity } from '@/contexts/CommunityContext'
import { canonicalAuthHref } from '@/lib/auth'

/**
 * The in-app auth modal was a second, competing copy of the sign-in and
 * sign-up forms. Authentication is now a single page, so every prompt that
 * used to open the modal (`setIsAuthModalOpen(true)`) instead sends the user
 * to the canonical page — where they choose Sign In or a Sign Up role.
 *
 * The component is kept as a no-render redirect shim so the many existing
 * call sites and the CommunityContext state that drives them keep working.
 */
export default function AuthModal() {
  const { isAuthModalOpen, setIsAuthModalOpen } = useCommunity()
  const router = useRouter()

  useEffect(() => {
    if (!isAuthModalOpen) return
    setIsAuthModalOpen(false)
    router.push(canonicalAuthHref())
  }, [isAuthModalOpen, router, setIsAuthModalOpen])

  return null
}
