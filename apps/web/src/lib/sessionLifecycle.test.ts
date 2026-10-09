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

const HOUR = 60 * 60 * 1000

/** Just enough DOM for the shield + listeners; no jsdom (matches this repo's other tests). */
function installFakeBrowser(opts: { touch: boolean }) {
  const children: any[] = []
  const doc: any = new EventTarget()
  doc.visibilityState = 'visible'
  doc.body = { appendChild: (el: any) => children.push(el), contains: (el: any) => children.includes(el) }
  doc.createElement = () => ({
    style: {} as Record<string, string>,
    offsetHeight: 0,
    setAttribute() {},
    appendChild() {},
  })
  const win: any = new EventTarget()
  win.matchMedia = (q: string) => ({ matches: q.includes('pointer: coarse') ? opts.touch : false })
  vi.stubGlobal('document', doc)
  vi.stubGlobal('window', win)
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => setTimeout(cb, 0))
  return {
    doc, win,
    shield: () => children[0],
    shieldVisible: () => children[0]?.style.display === 'flex',
    setVisibility(state: 'visible' | 'hidden') {
      doc.visibilityState = state
      doc.dispatchEvent(new Event('visibilitychange'))
    },
  }
}

const tick = () => new Promise((r) => setTimeout(r, 10))
const user = { id: 'u1', role: 'customer', full_name: 'T' } as any

let ls: ReturnType<typeof memStorage>
let ss: ReturnType<typeof memStorage>
let post: ReturnType<typeof vi.fn>

async function load() {
  vi.resetModules()
  vi.doMock('@/lib/api', () => ({ api: { post } }))
  const lifecycle = await import('@/lib/sessionLifecycle')
  const { useAuthStore } = await import('@/store/auth.store')
  const tracker = await import('@/lib/activityTracker')
  return { ...lifecycle, useAuthStore, ...tracker }
}

beforeEach(() => {
  ls = memStorage()
  ss = memStorage()
  post = vi.fn().mockResolvedValue({})
  vi.stubGlobal('localStorage', ls)
  vi.stubGlobal('sessionStorage', ss)
})

describe('endSession — local first, server second', () => {
  it('PROBLEM 1 (the visible flash): logs out synchronously, WITHOUT waiting for the server round trip', async () => {
    installFakeBrowser({ touch: true })
    post.mockReturnValue(new Promise(() => {}))        // a server request that never answers (bad network)
    const { endSession, useAuthStore, hasPendingServerLogout } = await load()
    useAuthStore.getState().setUser(user)
    expect(useAuthStore.getState().isAuthenticated).toBe(true)

    endSession('inactivity')

    expect(useAuthStore.getState().isAuthenticated).toBe(false)   // already gone — same tick
    expect(post).toHaveBeenCalledWith('/auth/logout')
    expect(hasPendingServerLogout()).toBe(true)                   // stays marked until the server confirms
    expect(ss.getItem('mk_logout_reason')).toBe('inactivity')
  })

  it('routes to the login page through the registered router', async () => {
    installFakeBrowser({ touch: true })
    const { endSession, registerNavigator, useAuthStore } = await load()
    const nav = vi.fn()
    registerNavigator(nav)
    useAuthStore.getState().setUser(user)
    endSession('inactivity')
    expect(nav).toHaveBeenCalledWith('/auth/login')
  })

  it('is idempotent and a no-op when nobody is logged in', async () => {
    installFakeBrowser({ touch: true })
    const { endSession, getSessionEndedAt } = await load()
    endSession('inactivity')
    expect(post).not.toHaveBeenCalled()
    expect(getSessionEndedAt()).toBe(0)
  })

  it('stamps when the session ended, so an in-flight /users/me answer can be discarded', async () => {
    installFakeBrowser({ touch: true })
    const { endSession, getSessionEndedAt, useAuthStore } = await load()
    useAuthStore.getState().setUser(user)
    const before = Date.now()
    endSession('inactivity')
    expect(getSessionEndedAt()).toBeGreaterThanOrEqual(before)
  })
})

describe('durable server logout — a valid cookie must never resurrect a closed session', () => {
  it('clears the marker once the server confirms', async () => {
    installFakeBrowser({ touch: true })
    const { flushPendingServerLogout, markPendingServerLogout, hasPendingServerLogout } = await load()
    markPendingServerLogout()
    await flushPendingServerLogout()
    expect(post).toHaveBeenCalledWith('/auth/logout')
    expect(hasPendingServerLogout()).toBe(false)
  })

  it('keeps the marker when the request fails (offline) so it is retried later', async () => {
    installFakeBrowser({ touch: true })
    post.mockRejectedValue(new Error('network'))
    const { flushPendingServerLogout, markPendingServerLogout, hasPendingServerLogout } = await load()
    markPendingServerLogout()
    await flushPendingServerLogout()
    expect(hasPendingServerLogout()).toBe(true)
  })

  it('drops a stale pending logout if the person has logged in again — never kills the new session', async () => {
    installFakeBrowser({ touch: true })
    const { flushPendingServerLogout, markPendingServerLogout, hasPendingServerLogout, useAuthStore } = await load()
    markPendingServerLogout()
    useAuthStore.getState().setUser(user)
    await flushPendingServerLogout()
    expect(post).not.toHaveBeenCalled()
    expect(hasPendingServerLogout()).toBe(false)
  })

  it('retries when the browser comes back online', async () => {
    const b = installFakeBrowser({ touch: true })
    const { initSessionLifecycle, markPendingServerLogout } = await load()
    initSessionLifecycle()
    markPendingServerLogout()
    b.win.dispatchEvent(new Event('online'))
    await tick()
    expect(post).toHaveBeenCalledWith('/auth/logout')
  })
})

describe('resume handling — what happens the instant the page comes back', () => {
  it('PROBLEM 1: away 12 min, page was merely backgrounded → logged out the moment it is visible again', async () => {
    const b = installFakeBrowser({ touch: true })
    const { initSessionLifecycle, useAuthStore } = await load()
    initSessionLifecycle()
    useAuthStore.getState().setUser(user)
    ls.setItem('mk_last_activity', String(Date.now() - 12 * 60 * 1000))

    b.setVisibility('hidden')
    b.setVisibility('visible')

    expect(useAuthStore.getState().isAuthenticated).toBe(false)
  })

  it('PROBLEM 2: away 3 hours → logged out on return', async () => {
    const b = installFakeBrowser({ touch: true })
    const { initSessionLifecycle, useAuthStore } = await load()
    initSessionLifecycle()
    useAuthStore.getState().setUser(user)
    ls.setItem('mk_last_activity', String(Date.now() - 3 * HOUR))

    b.setVisibility('hidden')
    b.setVisibility('visible')

    expect(useAuthStore.getState().isAuthenticated).toBe(false)
  })

  it('a quick app switch (still inside the window) keeps the session and drops the shield', async () => {
    const b = installFakeBrowser({ touch: true })
    const { initSessionLifecycle, useAuthStore } = await load()
    initSessionLifecycle()
    useAuthStore.getState().setUser(user)

    b.setVisibility('hidden')
    expect(b.shieldVisible()).toBe(true)
    b.setVisibility('visible')

    expect(useAuthStore.getState().isAuthenticated).toBe(true)
    expect(b.shieldVisible()).toBe(false)
  })

  it('restore from the back/forward cache (pageshow) is checked too — it brings back the OLD page instantly', async () => {
    const b = installFakeBrowser({ touch: true })
    const { initSessionLifecycle, useAuthStore } = await load()
    initSessionLifecycle()
    useAuthStore.getState().setUser(user)
    ls.setItem('mk_last_activity', String(Date.now() - 3 * HOUR))

    b.win.dispatchEvent(new Event('pageshow'))

    expect(useAuthStore.getState().isAuthenticated).toBe(false)
  })

  it('window focus is checked as well (desktop returning to the window)', async () => {
    const b = installFakeBrowser({ touch: false })
    const { initSessionLifecycle, useAuthStore } = await load()
    initSessionLifecycle()
    useAuthStore.getState().setUser(user)
    ls.setItem('mk_last_activity', String(Date.now() - 3 * HOUR))

    b.win.dispatchEvent(new Event('focus'))

    expect(useAuthStore.getState().isAuthenticated).toBe(false)
  })
})

describe('privacy shield', () => {
  it('covers the screen when an authenticated person leaves on a touch device', async () => {
    const b = installFakeBrowser({ touch: true })
    const { initSessionLifecycle, useAuthStore } = await load()
    initSessionLifecycle()
    useAuthStore.getState().setUser(user)
    b.setVisibility('hidden')
    expect(b.shieldVisible()).toBe(true)
  })

  it('does not flash a cover on every desktop tab switch', async () => {
    const b = installFakeBrowser({ touch: false })
    const { initSessionLifecycle, useAuthStore } = await load()
    initSessionLifecycle()
    useAuthStore.getState().setUser(user)
    b.setVisibility('hidden')
    expect(b.shieldVisible()).toBe(false)
  })

  it('does not cover anything when nobody is logged in', async () => {
    const b = installFakeBrowser({ touch: true })
    const { initSessionLifecycle } = await load()
    initSessionLifecycle()
    b.setVisibility('hidden')
    expect(b.shieldVisible()).toBe(false)
  })

  it('stays up through the logout and only lifts after the login screen has had a chance to paint', async () => {
    const b = installFakeBrowser({ touch: true })
    const { initSessionLifecycle, useAuthStore } = await load()
    initSessionLifecycle()
    useAuthStore.getState().setUser(user)
    ls.setItem('mk_last_activity', String(Date.now() - 3 * HOUR))

    b.setVisibility('hidden')
    b.setVisibility('visible')
    expect(b.shieldVisible()).toBe(true)     // logged out, login UI not yet painted → still covered

    await tick()
    await tick()
    expect(b.shieldVisible()).toBe(false)    // now lifted
  })
})
