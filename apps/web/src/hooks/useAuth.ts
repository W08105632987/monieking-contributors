import { useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { api } from '@/lib/api'
import { useAuthStore } from '@/store/auth.store'
import { useNotificationsStore } from '@/store/notifications.store'
import { preloadRoleRoutes } from '@/lib/preloadRoutes'
import { getBootIdleExpired, hasPendingServerLogout } from '@/lib/activityTracker'
import { endSession, flushPendingServerLogout, registerNavigator, getSessionEndedAt } from '@/lib/sessionLifecycle'
import type { AuthUser, AppNotification } from '@/types'

export function useAuth() {
  const user = useAuthStore((s) => s.user)
  const isLoading = useAuthStore((s) => s.isLoading)
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const setUser = useAuthStore((s) => s.setUser)
  const setLoading = useAuthStore((s) => s.setLoading)
  const logout = useAuthStore((s) => s.logout)
  const setNotifications = useNotificationsStore((s) => s.setNotifications)
  const navigate = useNavigate()

  // Lets non-React code (the always-on resume handler, endSession) route
  // through the real router instead of a hard reload. Deliberately no
  // cleanup: useAuth is mounted in more than one place, and an unmounting
  // instance must not null out the registration the app root depends on.
  useEffect(() => {
    registerNavigator((to) => navigate(to, { replace: true }))
  }, [navigate])

  useEffect(() => {
    // The session lives in an httpOnly cookie now — there's no client-side
    // token to inspect, so "am I logged in" just means "does /users/me
    // succeed". The browser sends the cookie automatically (see
    // withCredentials in api.ts); if it's missing, expired, or invalid,
    // this 401s and fetchProfile's catch handles it below.
    //
    // EXCEPT when we have just ended this session for being idle (or an
    // earlier idle logout never reached the server): the cookie is still
    // valid for up to 30 days, so asking /users/me "am I logged in?" would
    // answer yes and quietly resurrect the very session we closed — racing
    // the logout request, which is why the old behaviour was random. In
    // that case don't ask; finish the server-side logout instead.
    if (!useAuthStore.getState().isAuthenticated && (getBootIdleExpired() || hasPendingServerLogout())) {
      setLoading(false)
      void flushPendingServerLogout()
      return
    }
    fetchProfile()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function fetchProfile(retriesLeft = 2, startedAt = Date.now()) {
    try {
      const { data } = await api.get<AuthUser>('/users/me')
      // The session was ended (idle logout) while this request — or one
      // of its retries — was in flight. Its answer is about a session we
      // already closed; applying it would resurrect it.
      if (getSessionEndedAt() >= startedAt) return
      const role = typeof data.role === 'object'
        ? (data.role as any).value ?? 'customer'
        : data.role
      setUser({ ...data, role })
      preloadRoleRoutes(role)
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
        setTimeout(() => fetchProfile(retriesLeft - 1, startedAt), 2000)
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

  // Local state first, server second. The old version awaited the
  // /auth/logout round trip BEFORE clearing anything, so on a slow
  // connection the person kept looking at the app for seconds after
  // choosing (or being forced) to leave it. endSession() flips the UI
  // synchronously and finishes the server side in the background.
  const signOut = useCallback(async () => {
    endSession()
    navigate('/auth/login')
  }, [navigate])

  return { user, isLoading, isAuthenticated, signOut }
}
