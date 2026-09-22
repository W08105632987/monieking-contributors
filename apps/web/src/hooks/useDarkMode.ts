import { useEffect, useState, useCallback } from 'react'

const STORAGE_KEY = 'monieking-theme'

type Theme = 'light' | 'dark'

function getInitialTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'light' || stored === 'dark') return stored
  // No explicit choice stored yet — default to light mode so every
  // brand-new visitor lands on a clean, bright interface. The theme
  // toggle persists their preference via localStorage for future visits.
  return 'light'
}

export function useDarkMode() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    localStorage.setItem(STORAGE_KEY, theme)
  }, [theme])

  const toggle = useCallback(() => {
    setTheme(t => (t === 'dark' ? 'light' : 'dark'))
  }, [])

  return { theme, isDark: theme === 'dark', toggle, setTheme }
}
