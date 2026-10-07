import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth.store'
import { useNotificationsStore } from '@/store/notifications.store'
import { useInAppBannerStore } from '@/store/inAppBanner.store'
import { pickNewUnread } from '@/lib/newNotifications'
import { installAudioUnlock, notificationFeedback } from '@/lib/notificationFeedback'
import type { AppNotification } from '@/types'

// Backup check while the app is on screen. Cheap: one tiny request (just a number).
const POLL_INTERVAL_MS = 10_000
// A push is sent a moment BEFORE the server commits the notification row, so
// when a push arrives we look now and again shortly after to catch the commit.
const AFTER_PUSH_RECHECK_MS = [1_500, 4_000]

/**
 * Keeps the bell badge, the notification list and the in-app banner LIVE.
 *
 * Signals, fastest first:
 *  1. A Web Push arriving while the app is open (the service worker forwards it
 *     here instead of showing a second, system notification).
 *  2. A 10-second check of the unread count while the app is visible.
 *  3. Window focus / tab visible again (silent catch-up, no banner: the user
 *     already saw those as phone notifications).
 *  4. Supabase Realtime, kept as a bonus. It only delivers when Supabase knows
 *     the user, which this app's own login does not provide, so it is not relied on.
 */
export function useNotificationsPoll() {
  const { user, isAuthenticated } = useAuthStore()
  const setUnreadCount = useNotificationsStore((s) => s.setUnreadCount)
  const showBanner = useInAppBannerStore((s) => s.show)
  const qc = useQueryClient()
  const prevCountRef = useRef<number | null>(null)
  const seenRef = useRef<Set<string>>(new Set())
  const seededRef = useRef(false)

  useEffect(() => installAudioUnlock(), [])

  useEffect(() => {
    if (!isAuthenticated || !user) {
      prevCountRef.current = null
      seenRef.current = new Set()
      seededRef.current = false
      return
    }

    let cancelled = false

    const refreshRelated = () => {
      qc.invalidateQueries({ queryKey: ['notifications'] })
      qc.invalidateQueries({ queryKey: ['wallet'] })
      qc.invalidateQueries({ queryKey: ['wallet-transactions'] })
    }

    /** Fetch the newest notifications; announce ones we haven't shown yet. */
    const checkLatest = async (announce: boolean) => {
      try {
        const { data } = await api.get<AppNotification[]>('/notifications', { params: { page: 1, page_size: 8 } })
        if (cancelled) return
        const fresh = pickNewUnread(data, seenRef.current)
        // The very first load only records what already exists: no banner for old items.
        if (!seededRef.current) { seededRef.current = true; return }
        if (fresh.length === 0) return
        refreshRelated()
        if (announce) {
          const newest = fresh[fresh.length - 1]
          showBanner({ id: newest.id, title: newest.title, body: newest.body, extra: fresh.length - 1 })
          notificationFeedback()
        }
      } catch { /* silent: next cycle will retry */ }
    }

    const fetchCount = async (announce: boolean) => {
      try {
        const { data } = await api.get<{ unread_count: number }>('/notifications/unread-count')
        if (cancelled) return
        setUnreadCount(data.unread_count)
        const prev = prevCountRef.current
        prevCountRef.current = data.unread_count
        if (prev !== null && data.unread_count > prev) void checkLatest(announce)
      } catch { /* silent: badge just won't update this cycle */ }
    }

    // initial: seed what already exists (silently) and the badge
    void checkLatest(false)
    void fetchCount(false)

    // 1. push forwarded by the service worker while the app is open
    const onSwMessage = (e: MessageEvent) => {
      if (e.data?.type !== 'push-received') return
      void checkLatest(true)
      void fetchCount(true)
      AFTER_PUSH_RECHECK_MS.forEach((ms) => setTimeout(() => { if (!cancelled) { void checkLatest(true); void fetchCount(true) } }, ms))
    }
    navigator.serviceWorker?.addEventListener('message', onSwMessage)

    // 2. periodic check, only while the app is on screen
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') void fetchCount(true)
    }, POLL_INTERVAL_MS)

    // 3. returning to the app: catch up quietly
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      void checkLatest(false)
      void fetchCount(false)
      qc.invalidateQueries({ queryKey: ['wallet'] })
      qc.invalidateQueries({ queryKey: ['wallet-transactions'] })
    }
    window.addEventListener('focus', onVisible)
    document.addEventListener('visibilitychange', onVisible)

    // 4. Supabase Realtime (bonus; see note above)
    const channel = supabase
      .channel(`user-notifications-${user.id}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` },
        () => { void checkLatest(true); void fetchCount(true) })
      .subscribe()

    return () => {
      cancelled = true
      navigator.serviceWorker?.removeEventListener('message', onSwMessage)
      clearInterval(interval)
      window.removeEventListener('focus', onVisible)
      document.removeEventListener('visibilitychange', onVisible)
      supabase.removeChannel(channel)
    }
  }, [isAuthenticated, user?.id, qc, setUnreadCount, showBanner])
}
