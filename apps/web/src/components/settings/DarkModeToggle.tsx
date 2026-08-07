import { Moon, Sun } from 'lucide-react'
import { useDarkMode } from '@/hooks/useDarkMode'

export function DarkModeToggle() {
  const { isDark, toggle } = useDarkMode()

  return (
    <button
      onClick={toggle}
      className="w-full flex items-center justify-between bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-4 transition-colors"
    >
      <div className="flex items-center gap-2">
        {isDark ? <Moon className="w-4 h-4 text-night-200" /> : <Sun className="w-4 h-4 text-amber-500" />}
        <p className="text-green-900 dark:text-white font-bold text-sm">Dark mode</p>
      </div>
      <div className={`w-11 h-6 rounded-full flex items-center px-0.5 transition-colors ${isDark ? 'bg-green-700 justify-end' : 'bg-green-100 justify-start'}`}>
        <div className="w-5 h-5 rounded-full bg-white shadow" />
      </div>
    </button>
  )
}
