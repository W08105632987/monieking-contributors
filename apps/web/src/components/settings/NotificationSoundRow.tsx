import { useState } from 'react'
import { Volume2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { isSoundMuted, setSoundMuted, notificationFeedback } from '@/lib/notificationFeedback'

/** Mute switch for the in-app chime + vibration only. Push notifications themselves are compulsory. */
export function NotificationSoundRow() {
  const [on, setOn] = useState(() => !isSoundMuted())

  const toggle = () => {
    const next = !on
    setOn(next)
    setSoundMuted(!next)
    if (next) notificationFeedback() // preview
  }

  return (
    <div className="flex items-center justify-between py-3.5 border-b border-green-100 dark:border-night-500">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-9 h-9 rounded-xl bg-amber-50 dark:bg-amber-950/40 flex items-center justify-center text-amber-600 dark:text-amber-400 shrink-0">
          <Volume2 className="w-4.5 h-4.5" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-green-900 dark:text-white truncate">Notification sound</p>
          <p className="text-xs text-green-500 dark:text-night-200 mt-0.5">Chime and vibration when a notification arrives in the app</p>
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="Notification sound"
        onClick={toggle}
        className={cn(
          'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none',
          on ? 'bg-amber-500' : 'bg-zinc-300 dark:bg-night-500',
        )}
      >
        <span className={cn('pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out', on ? 'translate-x-5' : 'translate-x-0')} />
      </button>
    </div>
  )
}
