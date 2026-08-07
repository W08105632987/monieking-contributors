import { useEffect, useRef } from 'react'
import { api } from '@/lib/api'
import { useAuthStore } from '@/store/auth.store'
import { useNotificationsStore } from '@/store/notifications.store'

const POLL_INTERVAL_MS = 20_000 // 20 seconds

/** Keeps the notification bell badge live app-wide, not just when the
 *  Notifications page happens to be open. Polls a cheap count-only endpoint. */
export function useNotificationsPoll() {
  const { isAuthenticated } = useAuthStore()
  const { setUnreadCount } = useNotificationsStore()
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    const fetchCount = async () => {
      try {
        const { data } = await api.get<{ unread_count: number }>('/notifications/unread-count')
        setUnreadCount(data.unread_count)
      } catch {
        // silent — badge just won't update this cycle, no need to disrupt the user
      }
    }

    if (!isAuthenticated) {
      if (intervalRef.current) clearInterval(intervalRef.current)
      return
    }

    fetchCount() // immediately on mount / login
    intervalRef.current = setInterval(fetchCount, POLL_INTERVAL_MS)

    // Also refresh the instant a tab regains focus — catches anything that
    // happened while the phone was locked or the tab was backgrounded.
    const onFocus = () => fetchCount()
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') fetchCount()
    })

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      window.removeEventListener('focus', onFocus)
    }
  }, [isAuthenticated])
}