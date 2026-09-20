import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import { idempotencyKey } from './utils'
import { useServerHealthStore } from '@/store/serverHealth.store'
import { useAuthStore } from '@/store/auth.store'
import type { ApiError } from '@/types'

// ── Base URL ─────────────────────────────────────────────────────
// Falls back to a RELATIVE path, not a hardcoded LAN IP. A hardcoded
// IP (e.g. "http://192.168.x.x:8000") breaks the moment your router
// reassigns that device's DHCP lease — which happens on every Wi-Fi
// reconnect/reboot, and is exactly why the app was "randomly" timing
// out across devices. A relative "/api/v1" instead rides on whatever
// host the page itself was loaded from (works identically on
// localhost AND on http://<current-lan-ip>:3000 from another device),
// and Vite's dev proxy (see vite.config.ts) forwards it to the
// backend on localhost:8000 on the SAME machine running Vite. Only
// set VITE_API_URL explicitly for a real deployed backend (staging/
// production), where there's no dev proxy to rely on.
export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? '/api/v1',
  // The old NullPool database setup (see backend/app/core/database.py)
  // was routinely taking 10-30+s per request just to open a DB
  // connection, which is why registration in particular could look
  // "stuck" or throw a network error with no visible response — the
  // browser gave up waiting before the server ever replied. That's
  // fixed on the backend now (connections are reused, not reopened
  // every time), but keeping a bit of headroom here rather than
  // dropping back to a very tight timeout, in case a first request
  // after the server has been idle needs a moment to warm the pool.
  timeout: 20_000,
  headers: { 'Content-Type': 'application/json' },
  // Session lives in an httpOnly cookie now (set by the backend's
  // /auth/login, /auth/refresh, /auth/logout, /webauthn/login/verify) —
  // this tells the browser to actually send it. Without this, cookies
  // are silently dropped on every request, which looks exactly like
  // "logged in one second, logged out the next."
  withCredentials: true,
})

// ── Idempotency key on mutating requests ───────────────────────────
api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  if (['post', 'put', 'patch'].includes(config.method ?? '')) {
    config.headers['Idempotency-Key'] ??= idempotencyKey()
  }
  return config
})

// ── On a 401, try refreshing the session once before giving up ─────
// The cookie is httpOnly, so unlike before there's no token this code
// can inspect or attach directly — the browser sends it automatically,
// and the backend is the only thing that can tell us whether it's
// still valid. A 401 on /auth/refresh itself means the refresh cookie
// is gone/expired too — that's a real logout, not a timing issue.
let refreshInFlight: Promise<boolean> | null = null
let redirectingToLogin = false

async function tryRefresh(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = api.post('/auth/refresh')
      .then(() => true)
      .catch(() => false)
      .finally(() => { refreshInFlight = null })
  }
  return refreshInFlight
}

api.interceptors.response.use(
  (res) => {
    if (useServerHealthStore.getState().isDown) useServerHealthStore.getState().setDown(false)
    return res
  },
  async (error: AxiosError<ApiError>) => {
    if (error.code === 'ERR_NETWORK' || (!error.response && error.code !== 'ECONNABORTED')) {
      useServerHealthStore.getState().setDown(true)
    }

    const original = error.config as (InternalAxiosRequestConfig & { _retried?: boolean }) | undefined

    const isAuthEndpoint = original?.url?.includes('/auth/login')
      || original?.url?.includes('/auth/refresh')
      || original?.url?.includes('/auth/signup-session')
      || original?.url?.includes('/webauthn/login/verify')
      || original?.url?.includes('/auth/logout')

    if (
      error.response?.status === 401 &&
      original &&
      !original._retried &&
      !isAuthEndpoint
    ) {
      original._retried = true
      const refreshed = await tryRefresh()
      if (refreshed) return api(original)
      // Used to be `window.location.href = '/auth/login'` here — a hard
      // full-page reload. That rebooted the ENTIRE app from scratch
      // (new splash, new everything) just to end up back at the login
      // page, which is exactly what caused the double-splash /
      // flash-of-landing-page-then-login bug. AuthGuard and the
      // onboarding overlay already react correctly, instantly, and
      // without a reload the moment isAuthenticated flips false — so
      // all a 401 needs to do is flip it. No navigation call needed
      // here at all.
      if (!redirectingToLogin) {
        redirectingToLogin = true
        useAuthStore.getState().logout()
        // A session can expire more than once in the life of one open
        // tab (sign back in, stay open for hours, expire again) — this
        // guard should only dedupe a single burst of parallel 401s
        // from firing logout() a bunch of times at once, not block
        // every future one for the rest of the session.
        setTimeout(() => { redirectingToLogin = false }, 2000)
      }
    }

    return Promise.reject(error)
  },
)

export const getErrorMessage = (error: unknown): string => {
  if (axios.isAxiosError(error)) {
    const detail = (error.response?.data as any)?.detail
    if (detail) {
      // FastAPI/Pydantic 422 errors return an ARRAY of error objects, and
      // the new login lockout errors return an OBJECT ({code, message}) —
      // neither is a plain string. Passing either straight to a toast
      // throws "Objects are not valid as a React child" and crashes the
      // render tree. Normalize every shape down to a string here.
      if (typeof detail === 'string') return detail
      if (typeof detail === 'object' && detail !== null && 'message' in detail) return String((detail as any).message)
      if (Array.isArray(detail)) return detail.map((d: any) => d?.msg ?? JSON.stringify(d)).join(', ')
      return JSON.stringify(detail)
    }
    if (error.code === 'ECONNABORTED' || error.message?.toLowerCase().includes('timeout')) {
      return "This is taking longer than expected. Check your connection and try again — if it keeps happening, the request may have gone through, so check before retrying anything money-related."
    }
    if (error.code === 'ERR_NETWORK' || !error.response) {
      return 'Could not reach the server. Check your connection and try again.'
    }
    return error.message ?? 'An error occurred'
  }
  if (error instanceof Error) return error.message
  return 'An unexpected error occurred'
}
