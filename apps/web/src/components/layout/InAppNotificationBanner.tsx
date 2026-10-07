import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, X } from 'lucide-react'
import { useInAppBannerStore } from '@/store/inAppBanner.store'
import { useAuthStore } from '@/store/auth.store'
import { notificationsPathForRole } from '@/lib/newNotifications'

const VISIBLE_MS = 5000

/**
 * The app's own "heads-up" notification: drops from the top for ~5 seconds when
 * a notification arrives while the app is open, then slides away (the item stays
 * in the Notifications list and the bell badge). Mounted once in App.tsx.
 */
export function InAppNotificationBanner() {
  const banner = useInAppBannerStore((s) => s.banner)
  const hide = useInAppBannerStore((s) => s.hide)
  const role = useAuthStore((s) => s.user?.role)
  const navigate = useNavigate()
  const [shown, setShown] = useState(false)

  useEffect(() => {
    if (!banner) { setShown(false); return }
    // next frame so the slide-in transition runs
    const raf = requestAnimationFrame(() => setShown(true))
    const slideOut = setTimeout(() => setShown(false), VISIBLE_MS)
    const clear = setTimeout(hide, VISIBLE_MS + 300)
    return () => { cancelAnimationFrame(raf); clearTimeout(slideOut); clearTimeout(clear) }
  }, [banner, hide])

  if (!banner) return null

  return (
    <div
      className="fixed left-0 right-0 top-0 z-[60] px-3 pointer-events-none"
      style={{ paddingTop: 'calc(env(safe-area-inset-top) + 8px)' }}
    >
      <div
        role="alert"
        aria-live="assertive"
        className={`pointer-events-auto mx-auto max-w-md bg-green-900 text-white rounded-2xl shadow-card-lg p-3.5 flex items-start gap-3 transition-all duration-300 ease-out ${shown ? 'translate-y-0 opacity-100' : '-translate-y-full opacity-0'}`}
      >
        <button
          type="button"
          className="flex items-start gap-3 flex-1 min-w-0 text-left"
          onClick={() => { navigate(notificationsPathForRole(role)); hide() }}
        >
          <div className="w-9 h-9 rounded-xl bg-amber-400 flex items-center justify-center flex-shrink-0">
            <Bell className="w-4.5 h-4.5 text-green-900" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-bold text-sm truncate">{banner.title}</p>
            <p className="text-green-200 text-xs line-clamp-2">{banner.body}</p>
            {banner.extra > 0 && <p className="text-amber-300 text-[11px] font-semibold mt-0.5">+{banner.extra} more</p>}
          </div>
        </button>
        <button type="button" aria-label="Dismiss" onClick={hide}
          className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0">
          <X className="w-3 h-3" />
        </button>
      </div>
    </div>
  )
}
