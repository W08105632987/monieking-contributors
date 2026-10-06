import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { api, getErrorMessage } from '@/lib/api'

/**
 * Web Push (VAPID) subscription lifecycle. No Firebase/paid service
 * involved — subscribes directly via the browser's own Push API, then
 * hands the subscription to the backend (POST /push/subscribe), which
 * signs and sends payloads itself.
 *
 * iOS note: push to a plain Safari tab does not work at all — it only
 * works once the app has been added to the home screen (iOS 16.4+).
 * `isIosNeedsInstall` reflects exactly that case so callers can show the
 * right nudge instead of a push permission prompt that would silently
 * do nothing.
 *
 * Every failure path tells the user what happened. Previously a failed
 * subscribe was only a console.warn, so the toggle just stayed "Off".
 */

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)))
}

function isIosSafari(): boolean {
  const ua = window.navigator.userAgent
  const isIos = /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && 'ontouchend' in document)
  const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua)
  return isIos && isSafari
}

function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone === true
}

function sameKey(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
  if (!a) return false
  const x = new Uint8Array(a)
  return x.length === b.length && x.every((v, i) => v === b[i])
}

/** navigator.serviceWorker.ready never settles if no worker is registered. */
function serviceWorkerReady(timeoutMs = 8000): Promise<ServiceWorkerRegistration> {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('SW_NOT_READY')), timeoutMs)),
  ])
}

function explain(e: unknown): string {
  const status = (e as any)?.response?.status
  if (status === 503) return 'Push notifications are not switched on for this server yet. Please contact support.'
  if (status === 401) return 'Please sign in again, then retry.'
  if ((e as any)?.response || (e as any)?.isAxiosError) return getErrorMessage(e)
  const msg = (e as Error)?.message ?? ''
  if (msg === 'SW_NOT_READY') return 'The app is still setting up on this device. Reload the page and try again.'
  if ((e as any)?.name === 'NotAllowedError') return 'Notifications are blocked for this site. Allow them in your browser settings, then retry.'
  if ((e as any)?.name === 'AbortError') return "Your browser's push service could not be reached. Check your connection (or try another browser) and retry."
  return 'Could not turn on notifications on this device. Please try again.'
}

export function usePushSubscription() {
  const [supported, setSupported] = useState(false)
  const [permission, setPermission] = useState<NotificationPermission>('default')
  const [subscribed, setSubscribed] = useState(false)
  const [loading, setLoading] = useState(false)

  const isIosNeedsInstall = isIosSafari() && !isStandalone()

  useEffect(() => {
    const ok = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
    setSupported(ok)
    if (!ok) return
    setPermission(Notification.permission)
    let cancelled = false
    ;(async () => {
      try {
        const reg = await serviceWorkerReady()
        const existing = await reg.pushManager.getSubscription()
        if (cancelled) return
        if (!existing) { setSubscribed(false); return }
        // The browser can hold a subscription the server never received (the
        // earlier POST failed) — showing "On" then is a lie. Re-send it; the
        // endpoint is an idempotent upsert, so this also repairs the record.
        try {
          await api.post('/push/subscribe', existing.toJSON())
          if (!cancelled) setSubscribed(true)
        } catch {
          if (!cancelled) setSubscribed(false)
        }
      } catch { /* no service worker yet: stay Off */ }
    })()
    return () => { cancelled = true }
  }, [])

  const subscribe = useCallback(async () => {
    if (!supported || isIosNeedsInstall) return false
    setLoading(true)
    try {
      const result = await Notification.requestPermission()
      setPermission(result)
      if (result !== 'granted') {
        if (result === 'denied') toast.error('Notifications are blocked for this site. Allow them in your browser settings, then retry.')
        return false
      }

      const { data } = await api.get<{ public_key: string }>('/push/vapid-public-key')
      const serverKey = urlBase64ToUint8Array(data.public_key)
      const reg = await serviceWorkerReady()

      let sub = await reg.pushManager.getSubscription()
      // A subscription made with a different server key can never receive our
      // pushes (e.g. keys were rotated). Drop it and make a fresh one.
      if (sub && !sameKey(sub.options?.applicationServerKey, serverKey)) {
        await sub.unsubscribe()
        sub = null
      }
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          // Cast needed: TS's DOM lib types Uint8Array as generic over
          // ArrayBufferLike (which includes SharedArrayBuffer) in newer
          // lib versions, which isn't directly assignable to the stricter
          // BufferSource the Push API expects — the value itself is a
          // perfectly normal ArrayBuffer-backed Uint8Array at runtime.
          applicationServerKey: serverKey as BufferSource,
        })
      }

      await api.post('/push/subscribe', sub.toJSON())
      setSubscribed(true)
      toast.success('Notifications are on for this device')
      return true
    } catch (e) {
      console.warn('Push subscribe failed', e)
      toast.error(explain(e))
      return false
    } finally {
      setLoading(false)
    }
  }, [supported, isIosNeedsInstall])

  const unsubscribe = useCallback(async () => {
    setLoading(true)
    try {
      const reg = await serviceWorkerReady()
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        await api.post('/push/unsubscribe', { endpoint: sub.endpoint })
        await sub.unsubscribe()
      }
      setSubscribed(false)
    } catch (e) {
      console.warn('Push unsubscribe failed', e)
      toast.error(explain(e))
    } finally {
      setLoading(false)
    }
  }, [])

  return { supported, permission, subscribed, loading, isIosNeedsInstall, subscribe, unsubscribe }
}
