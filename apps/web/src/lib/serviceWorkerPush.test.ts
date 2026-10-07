import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import vm from 'node:vm'

/** Runs the real public/service-worker.js in a sandbox with a fake `self`. */
function loadWorker(windows: { visibilityState: string }[]) {
  const handlers: Record<string, (e: any) => void> = {}
  const shown: { title: string; opts: any }[] = []
  const posted: any[] = []
  const clients = windows.map((w) => ({ ...w, postMessage: (m: any) => posted.push(m), url: 'https://app.monieking.com/' }))
  const self: any = {
    location: { origin: 'https://app.monieking.com' },
    addEventListener: (type: string, fn: (e: any) => void) => { handlers[type] = fn },
    skipWaiting: () => {},
    clients: { matchAll: async () => clients, claim: () => {}, openWindow: async () => {} },
    registration: { showNotification: async (title: string, opts: any) => { shown.push({ title, opts }) } },
  }
  const src = readFileSync(resolve(__dirname, '../../public/service-worker.js'), 'utf8')
  vm.runInNewContext(src, { self, caches: { open: async () => ({ addAll: async () => {} }), keys: async () => [], delete: async () => true }, URL, Promise, console })
  const push = async (payload: object) => {
    let p: Promise<unknown> = Promise.resolve()
    handlers.push({ data: { json: () => payload, text: () => '' }, waitUntil: (x: Promise<unknown>) => { p = x } })
    await p
  }
  return { push, shown, posted }
}

describe('service worker push handler', () => {
  it('app closed: shows a system notification with a vibration pattern, not silent', async () => {
    const w = loadWorker([])
    await w.push({ title: 'Deposit', body: 'N5,000 received', deep_link_url: '/customer/wallet' })
    expect(w.shown).toHaveLength(1)
    expect(w.shown[0].title).toBe('Deposit')
    expect(w.shown[0].opts.vibrate.length).toBeGreaterThan(1)
    expect(w.shown[0].opts.silent).toBe(false)
    expect(w.shown[0].opts.data.url).toBe('/customer/wallet')
    expect(w.posted).toHaveLength(0)
  })
  it('app in background (hidden window): still a system notification', async () => {
    const w = loadWorker([{ visibilityState: 'hidden' }])
    await w.push({ title: 'x', body: 'y' })
    expect(w.shown).toHaveLength(1)
  })
  it('app open and visible: forwards to the page and shows NO duplicate system notification', async () => {
    const w = loadWorker([{ visibilityState: 'visible' }])
    await w.push({ title: 'Deposit', body: 'N5,000 received' })
    expect(w.shown).toHaveLength(0)
    expect(w.posted).toEqual([{ type: 'push-received', title: 'Deposit', body: 'N5,000 received', url: '/' }])
  })
})
