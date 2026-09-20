import { useEffect, useState, useCallback } from 'react'

const STORAGE_KEY = 'monieking-theme'

type Theme = 'light' | 'dark'

function getInitialTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'light' || stored === 'dark') return stored
  // No explicit choice yet — default to dark (matches the inline
  // script in index.html, which applies this same rule before React
  // mounts, so the two can never disagree and cause a flash). Used to
  // fall back to the device's system color-scheme instead; changed so
  // every brand-new visitor starts in dark, with the toggle on Login
  // as how they'd opt into light.
  return 'dark'
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
