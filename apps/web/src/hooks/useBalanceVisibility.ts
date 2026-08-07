import { useState, useEffect, useCallback } from 'react'

const STORAGE_PREFIX = 'monieking-balance-visible:'

/**
 * Same pattern as useDarkMode.ts — persisted in localStorage so it
 * survives navigating away, refreshing, and logging out/in again on the
 * same device. Keyed per-user (not global) since more than one account
 * can be used on the same browser, and one person's choice to hide
 * their balance shouldn't leak into someone else's session on a shared
 * device.
 */
export function useBalanceVisibility(userId: string | undefined) {
  const storageKey = userId ? `${STORAGE_PREFIX}${userId}` : null

  const [visible, setVisible] = useState<boolean>(() => {
    if (!storageKey) return true
    const stored = localStorage.getItem(storageKey)
    return stored === null ? true : stored === 'true'
  })

  useEffect(() => {
    if (!storageKey) return
    const stored = localStorage.getItem(storageKey)
    setVisible(stored === null ? true : stored === 'true')
  }, [storageKey])

  const toggle = useCallback(() => {
    setVisible(v => {
      const next = !v
      if (storageKey) localStorage.setItem(storageKey, String(next))
      return next
    })
  }, [storageKey])

  return { visible, toggle }
}
