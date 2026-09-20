import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuthStore } from '@/store/auth.store'
import { useNotificationsStore } from '@/store/notifications.store'

const POLL_INTERVAL_MS = 10_000 // 10 seconds

/** Keeps the notification bell badge live app-wide, not just when the
 *  Notifications page happens to be open. Polls a cheap count-only endpoint. */
export function useNotificationsPoll() {
  const { isAuthenticated } = useAuthStore()
  const { setUnreadCount } = useNotificationsStore()
  const qc = useQueryClient()
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const prevCountRef = useRef<number | null>(null)

  useEffect(() => {
    const fetchCount = async () => {
      try {
        const { data } = await api.get<{ unread_count: number }>('/notifications/unread-count')
        setUnreadCount(data.unread_count)

        if (prevCountRef.current !== null && data.unread_count > prevCountRef.current) {
          // A new notification arrived! (deposit credited, payment made, etc.)
          qc.invalidateQueries({ queryKey: ['wallet'] })
          qc.invalidateQueries({ queryKey: ['wallet-transactions'] })
          qc.invalidateQueries({ queryKey: ['notifications'] })
        }
        prevCountRef.current = data.unread_count
      } catch {
        // silent — badge just won't update this cycle, no need to disrupt the user
      }
    }

    if (!isAuthenticated) {
      if (intervalRef.current) clearInterval(intervalRef.current)
      prevCountRef.current = null
      return
    }

    fetchCount() // immediately on mount / login
    intervalRef.current = setInterval(fetchCount, POLL_INTERVAL_MS)

    // Also refresh the instant a tab regains focus — catches anything that
    // happened while the user was in their banking app or phone was locked.
    const onFocus = () => {
      fetchCount()
      qc.invalidateQueries({ queryKey: ['wallet'] })
      qc.invalidateQueries({ queryKey: ['wallet-transactions'] })
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') onFocus()
    })

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      window.removeEventListener('focus', onFocus)
    }
  }, [isAuthenticated, qc])
}