import { Bell } from 'lucide-react'
import { cn } from '@/lib/utils'
import { usePushSubscription } from '@/hooks/usePushSubscription'

/**
 * Matches the existing "SMS Transaction Alerts" row's visual pattern in
 * ProfilePage.tsx exactly, for push instead. Also doubles as the iOS
 * "add to home screen first" explainer, since push silently does nothing
 * in a plain Safari tab otherwise — showing a generic toggle there would
 * look broken, not just unavailable.
 */
export function PushNotificationsRow() {
  const { supported, subscribed, loading, isIosNeedsInstall, subscribe, unsubscribe } = usePushSubscription()

  if (!supported && !isIosNeedsInstall) return null

  return (
    <div className="flex items-center justify-between py-3.5 border-b border-green-100 dark:border-night-500">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-9 h-9 rounded-xl bg-amber-50 dark:bg-amber-950/40 flex items-center justify-center text-amber-600 dark:text-amber-400 shrink-0">
          <Bell className="w-4.5 h-4.5" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-green-900 dark:text-white truncate">Push Notifications</p>
            {subscribed ? (
              <span className="text-[10px] uppercase font-extrabold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-400 shrink-0">
                On
              </span>
            ) : (
              <span className="text-[10px] uppercase font-extrabold px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-600 dark:bg-night-600 dark:text-zinc-400 shrink-0">
                Off
              </span>
            )}
          </div>
          <p className="text-xs text-green-500 dark:text-night-200 mt-0.5">
            {isIosNeedsInstall
              ? 'Add MonieKing to your home screen first (Share → Add to Home Screen)'
              : 'Get notified on this device, even when the app is closed'}
          </p>
        </div>
      </div>
      {!isIosNeedsInstall && (
        <button
          type="button"
          disabled={loading}
          role="switch"
          aria-checked={subscribed}
          aria-label="Push notifications"
          onClick={() => (subscribed ? unsubscribe() : subscribe())}
          className={cn(
            'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none',
            subscribed ? 'bg-amber-500' : 'bg-zinc-300 dark:bg-night-500',
            loading && 'opacity-50 cursor-not-allowed',
          )}
        >
          <span
            className={cn(
              'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out',
              subscribed ? 'translate-x-5' : 'translate-x-0',
            )}
          />
        </button>
      )}
    </div>
  )
}
