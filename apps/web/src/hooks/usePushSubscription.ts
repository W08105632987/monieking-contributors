import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api'

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

export function usePushSubscription() {
  const [supported, setSupported] = useState(false)
  const [permission, setPermission] = useState<NotificationPermission>('default')
  const [subscribed, setSubscribed] = useState(false)
  const [loading, setLoading] = useState(false)

  const isIosNeedsInstall = isIosSafari() && !isStandalone()

  useEffect(() => {
    const ok = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
    setSupported(ok)
    if (ok) {
      setPermission(Notification.permission)
      navigator.serviceWorker.ready.then(async (reg) => {
        const existing = await reg.pushManager.getSubscription()
        setSubscribed(!!existing)
      }).catch(() => {})
    }
  }, [])

  const subscribe = useCallback(async () => {
    if (!supported || isIosNeedsInstall) return false
    setLoading(true)
    try {
      const result = await Notification.requestPermission()
      setPermission(result)
      if (result !== 'granted') return false

      const { data } = await api.get<{ public_key: string }>('/push/vapid-public-key')
      const reg = await navigator.serviceWorker.ready
      const existing = await reg.pushManager.getSubscription()
      const sub = existing || await reg.pushManager.subscribe({
        userVisibleOnly: true,
        // Cast needed: TS's DOM lib types Uint8Array as generic over
        // ArrayBufferLike (which includes SharedArrayBuffer) in newer
        // lib versions, which isn't directly assignable to the stricter
        // BufferSource the Push API expects — the value itself is a
        // perfectly normal ArrayBuffer-backed Uint8Array at runtime.
        applicationServerKey: urlBase64ToUint8Array(data.public_key) as BufferSource,
      })

      await api.post('/push/subscribe', sub.toJSON())
      setSubscribed(true)
      return true
    } catch (e) {
      console.warn('Push subscribe failed', e)
      return false
    } finally {
      setLoading(false)
    }
  }, [supported, isIosNeedsInstall])

  const unsubscribe = useCallback(async () => {
    setLoading(true)
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        await api.post('/push/unsubscribe', { endpoint: sub.endpoint })
        await sub.unsubscribe()
      }
      setSubscribed(false)
    } finally {
      setLoading(false)
    }
  }, [])

  return { supported, permission, subscribed, loading, isIosNeedsInstall, subscribe, unsubscribe }
}
