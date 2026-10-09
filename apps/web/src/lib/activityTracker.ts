/**
 * The idle clock — ONE place that decides "has this person been away too
 * long", used by the boot gate, the always-on resume handler, and the
 * in-app InactivityMonitor, so they can never disagree with each other.
 *
 * Three flaws in the previous version combined into the "works sometimes,
 * sometimes doesn't" session timeout:
 *
 *  1. The timestamp lived in sessionStorage, but the login itself
 *     (`monieking-auth`) lives in localStorage + httpOnly cookies. Those
 *     two have completely different lifetimes and scopes: sessionStorage
 *     is wiped when the app is closed/killed and is NOT shared between a
 *     browser tab and the installed PWA window, while the login survives
 *     both. So a cold-started PWA (or a PWA opened after using the
 *     browser) had a valid login but no timestamp at all...
 *
 *  2. ...and a missing timestamp was treated as "active right now"
 *     (`return Date.now()`), i.e. the check FAILED OPEN. Hours-old login +
 *     no timestamp = "idle for 0 minutes" = never logged out.
 *
 *  3. The check itself ran inside a useEffect — after the first paint —
 *     so even when it did decide to log out, the app had already
 *     rendered what the person left behind.
 *
 * Fixes here: the timestamp now lives in localStorage next to the login
 * (shared by browser + PWA, survives being killed), a missing/garbled/
 * future-dated timestamp means EXPIRED (fail closed), and the pre-
 * hydration gate below evaluates all of this synchronously before
 * anything can render.
 */

export const IDLE_TIMEOUT_MS = 2 * 60 * 1000

const LAST_ACTIVITY_KEY = 'mk_last_activity'
const PENDING_SERVER_LOGOUT_KEY = 'mk_pending_server_logout'
// Must match the `name` passed to zustand's persist() in auth.store.ts.
const AUTH_STORAGE_KEY = 'monieking-auth'
// A clock that's moved BACKWARDS (or a stamp from a device with a wrong
// clock) would otherwise make "now - last" negative forever and extend
// the session indefinitely. A little tolerance covers normal jitter.
const FUTURE_SKEW_TOLERANCE_MS = 60 * 1000

// Only used if localStorage throws (locked-down browser contexts) — keeps
// the in-app timer working instead of instantly logging everyone out.
let memoryFallback: number | null = null

/** Epoch ms of the last real interaction, or null if there isn't a usable one. */
export function getLastActivity(): number | null {
  try {
    const stored = localStorage.getItem(LAST_ACTIVITY_KEY)
    if (stored === null) return null
    const parsed = parseInt(stored, 10)
    return Number.isFinite(parsed) ? parsed : null
  } catch {
    return memoryFallback
  }
}

export function recordActivity(ts: number = Date.now()): void {
  memoryFallback = ts
  try { localStorage.setItem(LAST_ACTIVITY_KEY, String(ts)) } catch { /* memoryFallback covers it */ }
}

/**
 * Pure. FAILS CLOSED: no timestamp, a garbled one, or one from the future
 * all mean "treat as expired" — never "assume they were just here".
 */
export function isIdleExpired(last: number | null, now: number = Date.now()): boolean {
  if (last === null) return true
  if (last - now > FUTURE_SKEW_TOLERANCE_MS) return true
  return now - last >= IDLE_TIMEOUT_MS
}

// ── Pending server-side logout ─────────────────────────────────────────
// The session cookie is valid for up to 30 days and the server has no idle
// rule of its own. If we log out locally but the /auth/logout request
// never lands (offline, app killed mid-request), the cookie survives — and
// the app's own "does /users/me succeed?" check on next open would quietly
// log the person back in. This marker makes that retry durable.
export function markPendingServerLogout(): void {
  try { localStorage.setItem(PENDING_SERVER_LOGOUT_KEY, '1') } catch { /* best effort */ }
}
export function hasPendingServerLogout(): boolean {
  try { return localStorage.getItem(PENDING_SERVER_LOGOUT_KEY) === '1' } catch { return false }
}
export function clearPendingServerLogout(): void {
  try { localStorage.removeItem(PENDING_SERVER_LOGOUT_KEY) } catch { /* best effort */ }
}

// ── Pre-hydration boot gate ────────────────────────────────────────────
let bootIdleExpired = false

/** True if the boot gate found a persisted login that had gone idle. */
export function getBootIdleExpired(): boolean {
  return bootIdleExpired
}

/**
 * MUST run before zustand's persist() reads storage (auth.store.ts calls it
 * on the line before create()). Persist hydrates synchronously, so by the
 * time React's first render happens the store would already say
 * "authenticated" and the app would paint what the person left behind.
 * This looks at the same persisted blob first and, if the idle clock says
 * the session is over, rewrites it as logged-out — so the very first
 * render is already the login flow. Nothing stale is ever painted.
 *
 * Returns true if it expired a session.
 */
export function applyBootIdleGate(): boolean {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY)
    if (!raw) return false
    const blob = JSON.parse(raw)
    const state = blob?.state
    if (!state || (!state.user && !state.isAuthenticated)) return false

    if (!isIdleExpired(getLastActivity())) return false

    localStorage.setItem(
      AUTH_STORAGE_KEY,
      JSON.stringify({ ...blob, state: { ...state, user: null, isAuthenticated: false } }),
    )
    markPendingServerLogout()
    try { sessionStorage.setItem('mk_logout_reason', 'inactivity') } catch { /* UI hint only */ }
    bootIdleExpired = true
    return true
  } catch {
    // Unreadable/corrupt blob — zustand will ignore it too. Nothing to expire.
    return false
  }
}
