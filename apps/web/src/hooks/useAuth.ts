import { useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { api } from '@/lib/api'
import { useAuthStore } from '@/store/auth.store'
import { useNotificationsStore } from '@/store/notifications.store'
import type { AuthUser, AppNotification } from '@/types'

export function useAuth() {
  const { user, isLoading, isAuthenticated, setUser, setLoading, logout } = useAuthStore()
  const { setNotifications } = useNotificationsStore()
  const navigate = useNavigate()

  useEffect(() => {
    // The session lives in an httpOnly cookie now — there's no client-side
    // token to inspect, so "am I logged in" just means "does /users/me
    // succeed". The browser sends the cookie automatically (see
    // withCredentials in api.ts); if it's missing, expired, or invalid,
    // this 401s and fetchProfile's catch handles it below.
    fetchProfile()

    // Keep the bell badge fresh while the app is open, not just when the
    // Notifications page happens to be mounted
    const pollId = setInterval(() => {
      if (useAuthStore.getState().isAuthenticated) fetchNotifications()
    }, 30_000)

    return () => clearInterval(pollId)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function fetchProfile(retriesLeft = 2) {
    try {
      const { data } = await api.get<AuthUser>('/users/me')
      const role = typeof data.role === 'object'
        ? (data.role as any).value ?? 'customer'
        : data.role
      setUser({ ...data, role })
      fetchNotifications()
    } catch (err: any) {
      const status = err?.response?.status
      const detail = err?.response?.data?.detail

      if (detail === 'USER_NOT_IN_PLATFORM') {
        // Auth exists but platform record missing — redirect to complete registration
        navigate('/auth/register?resume=true')
        return
      }
      if (status === 403 && detail?.toLowerCase().includes('suspended')) {
        try { await api.post('/auth/logout') } catch { /* cookies get cleared server-side either way */ }
        logout()
        toast.error('Your account has been suspended. Please contact a director to resolve this.', { duration: 6000 })
        navigate('/auth/login')
        return
      }

      // A genuine 401 means the session really is invalid — that's a
      // real logout. Anything else (500, 502, a dropped connection, a
      // request that timed out) is NOT proof the person is logged out —
      // it's proof something went wrong reaching the server. The auth
      // store is persisted to localStorage, so calling logout() here
      // was wiping a perfectly valid session (plus the wallet,
      // notifications, and entire query cache) on every transient
      // blip — which is exactly what "logged out on every refresh"
      // looked like from the outside. Retry a couple of times first;
      // only give up (without logging out) if it keeps failing.
      if (status === 401) {
        logout()
        return
      }

      if (retriesLeft > 0) {
        setTimeout(() => fetchProfile(retriesLeft - 1), 2000)
        return
      }

      // Out of retries, still not a 401 — leave the persisted session
      // exactly as it is (don't force a logout on a network problem)
      // and just stop the loading spinner so the app isn't stuck.
      setLoading(false)
    }
  }

  async function fetchNotifications() {
    try {
      const { data } = await api.get<AppNotification[]>('/notifications')
      setNotifications(data)
    } catch {
      // non-fatal — badge just won't refresh this cycle
    }
  }

  const signOut = useCallback(async () => {
    try { await api.post('/auth/logout') } catch { /* cookies get cleared server-side either way */ }
    logout()
    navigate('/auth/login')
  }, [logout, navigate])

  return { user, isLoading, isAuthenticated, signOut }
}
