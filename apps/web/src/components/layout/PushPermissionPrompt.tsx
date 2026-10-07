import { useEffect, useState } from 'react'
import { Bell } from 'lucide-react'
import { usePushSubscription } from '@/hooks/usePushSubscription'

// Brief delay so the banner doesn't flash over the first paint after login.
const SHOW_AFTER_MS = 2_000

/**
 * Push notifications are compulsory for every signed-in user, so there is no
 * toggle in Settings and this banner has NO dismiss button. It stays until the
 * device is registered.
 *
 * Browsers will not let a site force the permission dialog: it must come from a
 * tap. So this is the tap target. (Once permission is granted, usePushSubscription
 * registers the device automatically on every app load.)
 *
 * States: not yet asked -> "Enable"; blocked in the browser -> how to unblock;
 * iOS Safari tab -> must add to Home Screen first. Mounted app-wide in App.tsx.
 */
export function PushPermissionPrompt() {
  const { supported, permission, subscribed, loading, isIosNeedsInstall, subscribe } = usePushSubscription()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setReady(true), SHOW_AFTER_MS)
    return () => clearTimeout(t)
  }, [])

  if (!ready || subscribed) return null
  if (!supported && !isIosNeedsInstall) return null
  // Permission already granted: registration happens automatically, nothing for the user to do.
  if (supported && permission === 'granted') return null

  const denied = permission === 'denied'
  const title = isIosNeedsInstall
    ? 'Install MonieKing to get notifications'
    : denied ? 'Notifications are blocked' : 'Turn on notifications'
  const text = isIosNeedsInstall
    ? 'Tap Share, then "Add to Home Screen", and open MonieKing from there.'
    : denied
      ? 'Allow notifications for this site in your browser settings, then reload the app.'
      : 'Required so you never miss a payment, dispute or approval.'

  return (
    <div
      className="fixed left-4 right-4 z-40 bg-green-900 rounded-2xl p-4 flex items-center gap-3 shadow-card-lg"
      style={{ bottom: 'calc(76px + env(safe-area-inset-bottom))' }}
      role="alert"
    >
      <div className="w-10 h-10 rounded-xl bg-amber-400 flex items-center justify-center flex-shrink-0">
        <Bell className="w-5 h-5 text-green-900" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-white font-bold text-sm">{title}</p>
        <p className="text-green-300 text-xs">{text}</p>
      </div>
      {!isIosNeedsInstall && !denied && (
        <button
          onClick={() => { void subscribe() }}
          disabled={loading}
          className="bg-amber-400 text-green-900 text-xs font-bold rounded-full px-3.5 py-2 flex-shrink-0 disabled:opacity-50"
        >
          {loading ? 'Enabling…' : 'Enable'}
        </button>
      )}
    </div>
  )
}
