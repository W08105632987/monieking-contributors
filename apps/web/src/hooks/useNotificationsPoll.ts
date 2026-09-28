import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth.store'
import { useNotificationsStore } from '@/store/notifications.store'

// Safety-net fallback poll interval (every 3 minutes instead of aggressive 10-second polling)
const FALLBACK_POLL_INTERVAL_MS = 3 * 60 * 1000

/** Keeps the notification bell badge live app-wide.
 *  Uses Supabase Realtime postgres_changes subscription as primary push mechanism (1.6),
 *  with a conservative 3-minute fallback poll and window focus refresh. */
export function useNotificationsPoll() {
  const { user, isAuthenticated } = useAuthStore()
  const setUnreadCount = useNotificationsStore((s) => s.setUnreadCount)
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

    if (!isAuthenticated || !user) {
      if (intervalRef.current) clearInterval(intervalRef.current)
      prevCountRef.current = null
      return
    }

    // 1. Initial fetch on mount / login
    fetchCount()

    // 2. Realtime push subscription on notifications table for the current user
    const channel = supabase
      .channel(`user-notifications-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          fetchCount()
        },
      )
      .subscribe()

    // 3. Low-frequency safety-net poll in case realtime websocket disconnects silently
    intervalRef.current = setInterval(fetchCount, FALLBACK_POLL_INTERVAL_MS)

    // 4. Also refresh when tab regains focus
    const onFocus = () => {
      fetchCount()
      qc.invalidateQueries({ queryKey: ['wallet'] })
      qc.invalidateQueries({ queryKey: ['wallet-transactions'] })
    }
    window.addEventListener('focus', onFocus)
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') onFocus()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      supabase.removeChannel(channel)
      if (intervalRef.current) clearInterval(intervalRef.current)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [isAuthenticated, user?.id, qc])
}