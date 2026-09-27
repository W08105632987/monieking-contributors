import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Megaphone, X } from 'lucide-react'
import { useState, useEffect, useMemo } from 'react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/store/auth.store'
import type { InstantMessage } from '@/types'

// Constant reading speed rather than a fixed duration — a long message
// just takes proportionally longer to complete one loop instead of
// zooming past unreadably fast.
const CHARS_PER_SECOND = 12
const MIN_DURATION_S = 8

/**
 * Scrolling notice bar pinned at the very top of the viewport, above every
 * page's own header, on every page, every role. Separate from the
 * notification inbox — for things that need to be seen immediately.
 * Dismissible per-session (reappears on next login/poll if still active —
 * a dismiss is not a permanent "never show again").
 *
 * Pages don't share a layout wrapper, so instead of trying to inject this
 * into each page's header, it's fixed to the true top of the screen and
 * toggles a class on <body> that reserves space for it — every page's
 * content (including its own header) gets pushed down uniformly, so the
 * ticker always renders before any page's header/role badge, never over it.
 *
 * The text is rendered twice back-to-back and scrolled by exactly 50% of
 * that doubled width, on an infinite linear loop — this is what makes it
 * seamless for ANY message length: there's no "reset" to notice, the
 * second copy is always already in the exact position the first started
 * in the moment it scrolls off, so it reads first sentence → last →
 * loops back to the first with no jump, no matter how long the message is.
 */
export function InstantMessageTicker() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const [dismissedId, setDismissedId] = useState<string | null>(null)

  const { data: message } = useQuery({
    queryKey: ['instant-message-active'],
    queryFn: async () => {
      const { data } = await api.get<InstantMessage | null>('/instant-messages/active')
      return data
    },
    enabled: isAuthenticated,
    refetchInterval: 60_000,
    retry: false,
  })

  const isVisible = !!message && message.id !== dismissedId

  useEffect(() => {
    document.body.classList.toggle('has-instant-ticker', isVisible)
    return () => { document.body.classList.remove('has-instant-ticker') }
  }, [isVisible])

  const durationS = useMemo(() => {
    if (!message) return MIN_DURATION_S
    return Math.max(MIN_DURATION_S, message.message.length / CHARS_PER_SECOND)
  }, [message?.message])

  if (!isVisible || !message) return null

  const isUrgent = message.priority === 'urgent'

  return (
    <div
      className={cn(
        'fixed top-0 left-0 right-0 z-50 flex items-center gap-2 px-3 overflow-hidden',
        isUrgent ? 'bg-red-500' : 'bg-green-900',
      )}
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 4 }}
    >
      <div className="flex-shrink-0">
        {isUrgent
          ? <AlertTriangle className="w-3.5 h-3.5 text-white" />
          : <Megaphone className="w-3.5 h-3.5 text-amber-400" />}
      </div>

      <div className="flex-1 min-w-0 overflow-hidden">
        <div
          className="flex whitespace-nowrap w-max"
          style={{ animation: `ticker-scroll ${durationS}s linear infinite` }}
        >
          <span className={cn('text-xs font-semibold pr-16', isUrgent ? 'text-white' : 'text-green-50')}>
            {message.message}
          </span>
          <span className={cn('text-xs font-semibold pr-16', isUrgent ? 'text-white' : 'text-green-50')} aria-hidden="true">
            {message.message}
          </span>
        </div>
      </div>

      <button
        onClick={() => setDismissedId(message.id)}
        className="flex-shrink-0 w-4 h-4 rounded-full flex items-center justify-center bg-white/15 active:scale-90 transition-all"
        aria-label="Dismiss"
      >
        <X className="w-2.5 h-2.5 text-white" />
      </button>

      <style>{`
        @keyframes ticker-scroll {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
      `}</style>
    </div>
  )
}
