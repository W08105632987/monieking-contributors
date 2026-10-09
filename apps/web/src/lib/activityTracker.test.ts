import { describe, it, expect, vi, beforeEach } from 'vitest'

function memStorage() {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  }
}

const MIN = 60 * 1000
const HOUR = 60 * MIN
const AUTH_KEY = 'monieking-auth'
const loggedInBlob = () =>
  JSON.stringify({ state: { user: { id: 'u1', role: 'customer' }, isAuthenticated: true }, version: 0 })

let ls: ReturnType<typeof memStorage>
let ss: ReturnType<typeof memStorage>

beforeEach(() => {
  vi.resetModules()
  ls = memStorage()
  ss = memStorage()
  vi.stubGlobal('localStorage', ls)
  vi.stubGlobal('sessionStorage', ss)
})

describe('isIdleExpired (pure) — fails CLOSED', () => {
  it('treats a missing timestamp as expired — the old code treated it as "active just now"', async () => {
    const { isIdleExpired } = await import('@/lib/activityTracker')
    expect(isIdleExpired(null)).toBe(true)
  })

  it('is not expired inside the 2 minute window, expired at and beyond it', async () => {
    const { isIdleExpired } = await import('@/lib/activityTracker')
    const now = 1_000_000_000_000
    expect(isIdleExpired(now - 10_000, now)).toBe(false)
    expect(isIdleExpired(now - (2 * MIN - 1), now)).toBe(false)
    expect(isIdleExpired(now - 2 * MIN, now)).toBe(true)
    expect(isIdleExpired(now - 3 * HOUR, now)).toBe(true)
  })

  it('treats a timestamp far in the future (clock rolled back) as expired, not as an extension', async () => {
    const { isIdleExpired } = await import('@/lib/activityTracker')
    const now = 1_000_000_000_000
    expect(isIdleExpired(now + 10 * MIN, now)).toBe(true)   // suspicious
    expect(isIdleExpired(now + 5_000, now)).toBe(false)     // ordinary jitter is tolerated
  })
})

describe('getLastActivity', () => {
  it('returns null — not "now" — when nothing is stored (cold-started PWA / new context)', async () => {
    const { getLastActivity } = await import('@/lib/activityTracker')
    expect(getLastActivity()).toBeNull()
  })

  it('lives in localStorage, so the browser tab and the installed PWA see the same clock', async () => {
    const { recordActivity, getLastActivity } = await import('@/lib/activityTracker')
    recordActivity(12345)
    expect(ls.getItem('mk_last_activity')).toBe('12345')
    expect(ss.getItem('mk_last_activity')).toBeNull()
    expect(getLastActivity()).toBe(12345)
  })

  it('ignores a garbled value instead of trusting it', async () => {
    ls.setItem('mk_last_activity', 'not-a-number')
    const { getLastActivity } = await import('@/lib/activityTracker')
    expect(getLastActivity()).toBeNull()
  })
})

describe('applyBootIdleGate — runs before the first render', () => {
  it('PROBLEM 2: login persisted, away 3 hours, no timestamp (PWA / cold start) → session ended', async () => {
    ls.setItem(AUTH_KEY, loggedInBlob())
    const { applyBootIdleGate, getBootIdleExpired, hasPendingServerLogout } = await import('@/lib/activityTracker')

    expect(applyBootIdleGate()).toBe(true)
    expect(getBootIdleExpired()).toBe(true)
    const blob = JSON.parse(ls.getItem(AUTH_KEY)!)
    expect(blob.state.user).toBeNull()
    expect(blob.state.isAuthenticated).toBe(false)
    expect(hasPendingServerLogout()).toBe(true)          // cookie is still valid server-side: must be retried
    expect(ss.getItem('mk_logout_reason')).toBe('inactivity')
  })

  it('login persisted, timestamp 3 hours old → session ended', async () => {
    ls.setItem(AUTH_KEY, loggedInBlob())
    ls.setItem('mk_last_activity', String(Date.now() - 3 * HOUR))
    const { applyBootIdleGate } = await import('@/lib/activityTracker')
    expect(applyBootIdleGate()).toBe(true)
  })

  it('PROBLEM 1: login persisted, away 12 minutes → session ended', async () => {
    ls.setItem(AUTH_KEY, loggedInBlob())
    ls.setItem('mk_last_activity', String(Date.now() - 12 * MIN))
    const { applyBootIdleGate } = await import('@/lib/activityTracker')
    expect(applyBootIdleGate()).toBe(true)
  })

  it('left 30 seconds ago → session kept, blob untouched', async () => {
    ls.setItem(AUTH_KEY, loggedInBlob())
    ls.setItem('mk_last_activity', String(Date.now() - 30_000))
    const { applyBootIdleGate, hasPendingServerLogout } = await import('@/lib/activityTracker')
    expect(applyBootIdleGate()).toBe(false)
    expect(ls.getItem(AUTH_KEY)).toBe(loggedInBlob())
    expect(hasPendingServerLogout()).toBe(false)
  })

  it('does nothing when nobody is logged in (no spurious pending logout)', async () => {
    const { applyBootIdleGate, hasPendingServerLogout } = await import('@/lib/activityTracker')
    expect(applyBootIdleGate()).toBe(false)
    expect(hasPendingServerLogout()).toBe(false)
  })

  it('survives a corrupt persisted blob without throwing', async () => {
    ls.setItem(AUTH_KEY, '{not json')
    const { applyBootIdleGate } = await import('@/lib/activityTracker')
    expect(() => applyBootIdleGate()).not.toThrow()
    expect(applyBootIdleGate()).toBe(false)
  })
})

describe('auth store — the very first state a render can ever see', () => {
  it('NO FLASH: after a long absence the first state is already logged out and not stuck loading', async () => {
    ls.setItem(AUTH_KEY, loggedInBlob())
    ls.setItem('mk_last_activity', String(Date.now() - 3 * HOUR))
    const { useAuthStore } = await import('@/store/auth.store')
    const s = useAuthStore.getState()
    expect(s.isAuthenticated).toBe(false)
    expect(s.user).toBeNull()
    expect(s.isLoading).toBe(false)   // login flow can show immediately, nothing to wait for
  })

  it('a recent session still resumes normally (hydrated as authenticated, profile fetch pending)', async () => {
    ls.setItem(AUTH_KEY, loggedInBlob())
    ls.setItem('mk_last_activity', String(Date.now() - 20_000))
    const { useAuthStore } = await import('@/store/auth.store')
    const s = useAuthStore.getState()
    expect(s.isAuthenticated).toBe(true)
    expect(s.isLoading).toBe(true)
  })
})
