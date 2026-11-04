import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'

/**
 * Real "back": steps one entry back in the history when the app has one, otherwise
 * (deep link, refresh, notification tap) replaces the current page with `fallback`.
 * Never pushes the parent page, which is what made Back bounce between two pages.
 */
export function useGoBack(fallback: string) {
  const navigate = useNavigate()
  return useCallback(() => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0
    if (idx > 0) navigate(-1)
    else navigate(fallback, { replace: true })
  }, [navigate, fallback])
}
