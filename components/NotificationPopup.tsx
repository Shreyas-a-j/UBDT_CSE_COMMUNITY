'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Bell } from 'lucide-react'

import { useCommunity } from '@/contexts/CommunityContext'
import {
  safeNotificationLink,
  selectPopupNotification,
} from '@/lib/logic/notifications'
import type { Notification } from '@/lib/types'

/**
 * One dismissible notification at launch and when the tab returns to the
 * foreground.
 *
 * The launch/foreground check is a one-shot request: realtime inserts still
 * update the bell, but never open this card while the user is already active.
 * Seen ids live in memory for the session, so dismissing hides a row until the
 * next cold launch without deleting it or marking it read.
 */
export default function NotificationPopup() {
  const {
    currentUser,
    notifications,
    notificationsLoaded,
    markNotificationAsRead,
  } = useCommunity()
  const router = useRouter()
  const [candidate, setCandidate] = useState<Notification | null>(null)
  const seenRef = useRef(new Set<string>())
  const checkRequestedRef = useRef(false)
  const notificationsRef = useRef(notifications)
  const loadedRef = useRef(notificationsLoaded)
  const userRef = useRef(currentUser)

  // Latest-value refs are written in an effect, never during render. The
  // selection below runs from a microtask, after this effect has synced.
  useEffect(() => {
    notificationsRef.current = notifications
    loadedRef.current = notificationsLoaded
    userRef.current = currentUser
  }, [notifications, notificationsLoaded, currentUser])

  const runCheck = useCallback(() => {
    if (!userRef.current || !loadedRef.current || !checkRequestedRef.current) return
    checkRequestedRef.current = false
    setCandidate(selectPopupNotification(notificationsRef.current, seenRef.current))
  }, [])

  const requestCheck = useCallback(() => {
    checkRequestedRef.current = true
    queueMicrotask(runCheck)
  }, [runCheck])

  // Return to the tab.
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') requestCheck()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [requestCheck])

  // A new signed-in account starts a fresh popup session; signing out clears
  // the seen set and closes any open card. This also covers the initial
  // authenticated mount, so there is no separate launch effect to race it.
  const userId = currentUser?.id ?? null
  useEffect(() => {
    seenRef.current.clear()
    checkRequestedRef.current = false
    queueMicrotask(() => setCandidate(null))
    if (userId) requestCheck()
  }, [userId, requestCheck])

  // A launch/foreground check that arrived before the first fetch resolved is
  // retried once the list is available. A check flag is consumed only when
  // there is a loaded list for the signed-in account.
  useEffect(() => {
    if (notificationsLoaded) queueMicrotask(runCheck)
  }, [notificationsLoaded, notifications, runCheck])

  // Derive visibility from the live list so a row marked read elsewhere (for
  // example, from the bell) closes without another setState.
  const liveCandidate = candidate
    ? notifications.find(notification => notification.id === candidate.id)
    : null
  const shownCandidate =
    candidate && liveCandidate && !liveCandidate.read && candidate.user_id === userId
      ? liveCandidate
      : null

  const dismiss = () => {
    if (!shownCandidate) return
    seenRef.current.add(shownCandidate.id)
    setCandidate(null)
  }

  const view = () => {
    if (!shownCandidate) return
    const { id, link } = shownCandidate
    if (!shownCandidate.read) markNotificationAsRead(id)
    seenRef.current.add(id)
    setCandidate(null)
    router.push(safeNotificationLink(link))
  }

  if (!shownCandidate) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-[60] w-[min(22rem,calc(100vw-2rem))]"
    >
      <div className="card border-accent/30 bg-surface p-4 shadow-pop">
        <div className="flex items-start gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-accent/30 bg-accent-soft text-accent-text">
            <Bell className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-ink">{shownCandidate.title}</p>
            {shownCandidate.body && (
              <p className="mt-1 whitespace-pre-wrap text-[11.5px] leading-relaxed text-muted">
                {shownCandidate.body}
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={view} className="btn btn-primary btn-sm">
                View
              </button>
              <button type="button" onClick={dismiss} className="btn btn-outline btn-sm">
                Dismiss
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
