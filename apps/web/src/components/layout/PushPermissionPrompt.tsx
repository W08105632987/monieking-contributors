import { useEffect, useState } from 'react'
import { Bell, X } from 'lucide-react'
import { usePushSubscription } from '@/hooks/usePushSubscription'

const DISMISS_KEY = 'monieking-push-dismissed'
// Shown only after the user has been in the app a little while, not on
// first launch — burning the one-shot browser permission prompt on
// someone with zero context tanks acceptance rates for good.
const SHOW_AFTER_MS = 15_000

/**
 * Mounted once, app-wide (see AppLayout.tsx), same pattern as InstallPrompt.
 * Renders nothing once subscribed, dismissed, or on iOS Safari running in
 * a plain browser tab (push there requires installing to the home screen
 * first — see usePushSubscription's isIosNeedsInstall).
 */
export function PushPermissionPrompt() {
  const { supported, permission, subscribed, isIosNeedsInstall, subscribe } = usePushSubscription()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!supported || subscribed || permission !== 'default' || isIosNeedsInstall) return
    if (localStorage.getItem(DISMISS_KEY)) return

    const timer = setTimeout(() => setVisible(true), SHOW_AFTER_MS)
    return () => clearTimeout(timer)
  }, [supported, subscribed, permission, isIosNeedsInstall])

  const handleEnable = async () => {
    await subscribe()
    setVisible(false)
  }

  const handleDismiss = () => {
    localStorage.setItem(DISMISS_KEY, '1')
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div
      className="fixed left-4 right-4 z-40 bg-green-900 rounded-2xl p-4 flex items-center gap-3 shadow-card-lg"
      style={{ bottom: 'calc(76px + env(safe-area-inset-bottom))' }}
    >
      <div className="w-10 h-10 rounded-xl bg-amber-400 flex items-center justify-center flex-shrink-0">
        <Bell className="w-5 h-5 text-green-900" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-white font-bold text-sm">Turn on notifications</p>
        <p className="text-green-300 text-xs">Get notified the moment something needs your attention</p>
      </div>
      <button onClick={handleEnable} className="bg-amber-400 text-green-900 text-xs font-bold rounded-full px-3.5 py-2 flex-shrink-0">
        Enable
      </button>
      <button onClick={handleDismiss} className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0" aria-label="Dismiss">
        <X className="w-3 h-3 text-white" />
      </button>
    </div>
  )
}
