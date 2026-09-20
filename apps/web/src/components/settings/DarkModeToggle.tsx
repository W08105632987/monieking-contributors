import { Moon, Sun } from 'lucide-react'
import { useDarkMode } from '@/hooks/useDarkMode'

/**
 * Lives inside the Preferences card now (see Profile pages) as a row,
 * not its own standalone card — same icon-box + label shape as every
 * other row there, with a toggle switch instead of a chevron on the
 * right since this one flips a setting rather than opening something.
 */
export function DarkModeToggle() {
  const { isDark, toggle } = useDarkMode()

  return (
    <button
      onClick={toggle}
      className="w-full flex items-center gap-3 py-3.5 border-b border-green-50 dark:border-night-600 active:bg-green-50/50 dark:active:bg-white/5 transition-all text-left"
    >
      <div className="w-9 h-9 rounded-xl bg-green-50 dark:bg-night-600 flex items-center justify-center flex-shrink-0">
        {isDark ? <Moon className="w-4 h-4 text-night-200" /> : <Sun className="w-4 h-4 text-amber-500" />}
      </div>
      <div className="flex-1">
        <p className="text-green-900 dark:text-white text-sm font-semibold">Dark mode</p>
      </div>
      <div className={`w-11 h-6 rounded-full flex items-center px-0.5 transition-colors flex-shrink-0 ${isDark ? 'bg-green-700 justify-end' : 'bg-green-100 dark:bg-night-500 justify-start'}`}>
        <div className="w-5 h-5 rounded-full bg-white shadow" />
      </div>
    </button>
  )
}
