'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { fetchEmailVerificationStatus } from '@/lib/supabase/emailVerification'
import { uniqueVerificationIds } from '@/lib/logic/emailVerification'

/**
 * Loads trusted email-verification state for a set of profile ids.
 *
 * The ids are de-duplicated and sorted into a stable key so a parent that
 * creates a new array every render does not trigger a request loop. The hook
 * refetches when the window regains focus or the tab becomes visible, which is
 * how a member sees their badge change after confirming their email without a
 * hard reload.
 */
export function useEmailVerification(userIds: readonly string[]) {
  const supabase = useMemo(() => createClient(), [])
  const [status, setStatus] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)

  const ids = useMemo(() => uniqueVerificationIds(userIds), [userIds])
  const key = useMemo(() => ids.join(','), [ids])

  const refresh = useCallback(() => {
    setRevision(value => value + 1)
  }, [])

  useEffect(() => {
    if (!key) return

    const requestedIds = key.split(',')
    let cancelled = false

    const load = async () => {
      setLoading(true)
      try {
        const next = await fetchEmailVerificationStatus(supabase, requestedIds)
        if (cancelled) return
        setStatus(next)
        setError(null)
      } catch (err) {
        if (cancelled) return
        setError(
          err instanceof Error
            ? err.message
            : 'Could not load email verification status.',
        )
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [key, revision, supabase])

  useEffect(() => {
    if (!key) return

    const onFocus = () => refresh()
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refresh()
    }

    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [key, refresh])

  // When the key is empty (no faculty visible), return a clean empty result
  // instead of whatever the last requested batch left in state.
  return {
    status: key ? status : {},
    loading: key ? loading : false,
    error: key ? error : null,
    refresh,
  }
}
