/**
 * Everything about ending a session that must NOT depend on React being
 * mounted, rendered, or in the right state: it's initialised once from
 * main.tsx, before React renders, and keeps working across every
 * mount/unmount of the component tree.
 *
 *  - endSession():   logs out LOCALLY and synchronously first, then tells
 *                    the server in the background. The old signOut awaited
 *                    the /auth/logout round trip before clearing local
 *                    state — on a slow connection that meant the person
 *                    sat looking at the app they'd left for seconds
 *                    before the login page appeared (the "I can see
 *                    inside the app first" bug).
 *  - privacy shield: an opaque brand-coloured cover, toggled directly on
 *                    the DOM (not via React state, so it applies in the
 *                    same task rather than waiting for a render).
 *  - resume check:   the moment the page becomes visible/focused/restored
 *                    from bfcache, decide expiry synchronously.
 *  - durable server logout: retried until it lands (see activityTracker).
 */
import { api } from '@/lib/api'
import { useAuthStore } from '@/store/auth.store'
import {
  getLastActivity,
  isIdleExpired,
  markPendingServerLogout,
  hasPendingServerLogout,
  clearPendingServerLogout,
} from '@/lib/activityTracker'

// ── Navigation bridge (so non-React code can route via the real router) ──
let navigateFn: ((to: string) => void) | null = null
export function registerNavigator(fn: ((to: string) => void) | null): void {
  navigateFn = fn
}

// ── Privacy shield ────────────────────────────────────────────────────────
const SHIELD_ID = 'mk-privacy-shield'
let shieldEl: HTMLElement | null = null

function ensureShield(): HTMLElement | null {
  if (typeof document === 'undefined') return null
  if (shieldEl && document.body.contains(shieldEl)) return shieldEl
  const el = document.createElement('div')
  el.id = SHIELD_ID
  el.setAttribute('aria-hidden', 'true')
  el.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:2147483647',
    'background:#052E16',          // brand forest green — same as the splash
    'display:none', 'align-items:center', 'justify-content:center',
  ].join(';')
  const img = document.createElement('img')
  img.src = '/brand/logo-icon.png'
  img.alt = ''
  img.style.cssText = 'width:72px;height:72px;opacity:.9'
  el.appendChild(img)
  document.body.appendChild(el)
  shieldEl = el
  return el
}

export function showShield(): void {
  const el = ensureShield()
  if (!el) return
  el.style.display = 'flex'
  // Force style+layout NOW so the cover is part of the next committed
  // frame instead of being batched behind whatever runs after this.
  void el.offsetHeight
}

export function hideShield(): void {
  if (shieldEl) shieldEl.style.display = 'none'
}

/** Keep the cover up until React has committed the login UI AND painted it. */
function hideShieldAfterPaint(): void {
  if (typeof requestAnimationFrame === 'undefined') { hideShield(); return }
  requestAnimationFrame(() => requestAnimationFrame(hideShield))
}

// The shield exists for the "came back after a long absence" case, which
// is overwhelmingly a phone / installed-PWA thing. On a desktop browser
// tab-switching is constant and a green flash on every return would be
// pure annoyance for no benefit — the synchronous resume check below is
// enough there.
function shouldShieldOnHide(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return (
    window.matchMedia('(pointer: coarse)').matches ||
    window.matchMedia('(display-mode: standalone)').matches
  )
}

// ── Server logout (durable) ───────────────────────────────────────────────
let flushing = false

// When the session was last ended. A /users/me request that was already in
// flight (or retrying) when that happened is answering about a session we
// have since closed — useAuth compares its start time against this and
// discards the response rather than letting it resurrect the login.
let lastSessionEndedAt = 0
export function getSessionEndedAt(): number {
  return lastSessionEndedAt
}

export async function flushPendingServerLogout(): Promise<void> {
  if (!hasPendingServerLogout() || flushing) return
  // If someone has logged in again since, this logout is obsolete — and
  // sending it now would wipe the cookies of their brand-new session.
  if (useAuthStore.getState().isAuthenticated) { clearPendingServerLogout(); return }
  flushing = true
  try {
    await api.post('/auth/logout')
    clearPendingServerLogout()
  } catch {
    // Offline / server hiccup — leave the marker; retried on next boot and
    // on the browser's 'online' event.
  } finally {
    flushing = false
  }
}

/**
 * End the session. Local state first (synchronous, what the person
 * actually sees), server second (background, retried until it lands).
 * Idempotent: calling it twice, or when already logged out, is a no-op.
 */
export function endSession(reason?: 'inactivity'): void {
  if (!useAuthStore.getState().isAuthenticated) return

  if (reason === 'inactivity') {
    try { sessionStorage.setItem('mk_logout_reason', reason) } catch { /* UI hint only */ }
    showShield()
  }

  lastSessionEndedAt = Date.now()
  useAuthStore.getState().logout()
  navigateFn?.('/auth/login')

  markPendingServerLogout()
  void flushPendingServerLogout()

  if (reason === 'inactivity') hideShieldAfterPaint()
}

// ── Resume handling ───────────────────────────────────────────────────────
function reconcileOnResume(): void {
  const { isAuthenticated } = useAuthStore.getState()
  if (!isAuthenticated) { hideShield(); return }

  if (isIdleExpired(getLastActivity())) {
    endSession('inactivity')   // shows the shield first, hides it after the login paints
    return
  }
  hideShield()
}

let initialised = false

export function initSessionLifecycle(): void {
  if (initialised || typeof window === 'undefined') return
  initialised = true

  ensureShield()

  // Leaving: cover the screen so the last frame the OS keeps (and the
  // app-switcher thumbnail) isn't the person's account.
  const onHide = () => {
    if (useAuthStore.getState().isAuthenticated && shouldShieldOnHide()) showShield()
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') onHide()
    else reconcileOnResume()
  })
  window.addEventListener('pagehide', onHide)

  // Returning — every signal a browser can give us, earliest first.
  // (`resume` = Page Lifecycle API, un-freezing; `pageshow` with
  // persisted=true = restored from the back/forward cache, which brings
  // back the OLD DOM instantly with no reload.)
  document.addEventListener('resume', reconcileOnResume)
  window.addEventListener('pageshow', reconcileOnResume)
  window.addEventListener('focus', reconcileOnResume)

  // A logout that didn't land while offline gets retried once we're back.
  window.addEventListener('online', () => { void flushPendingServerLogout() })
}
