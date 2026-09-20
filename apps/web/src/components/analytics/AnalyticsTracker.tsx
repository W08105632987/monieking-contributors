import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { api } from '@/lib/api'
import { useAuthStore } from '@/store/auth.store'

const SESSION_KEY = 'monieking-analytics-session'

function getSessionId(): string {
  let id = localStorage.getItem(SESSION_KEY)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(SESSION_KEY, id)
  }
  return id
}

function sendEvent(payload: Record<string, unknown>) {
  const body = JSON.stringify(payload)
  const url = `${(api.defaults.baseURL ?? '/api/v1').replace(/\/$/, '')}/analytics/track`
  // sendBeacon fires-and-forgets even as the page is unloading (a click
  // that navigates away, a tab close) — a plain fetch call gets
  // silently cancelled by the browser in exactly that moment, which is
  // precisely when a lot of real clicks happen. Falls back to fetch
  // for contexts without it, or if it refuses the payload.
  if (navigator.sendBeacon) {
    const blob = new Blob([body], { type: 'application/json' })
    if (navigator.sendBeacon(url, blob)) return
  }
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {})
}

/** A short, readable label for whatever was clicked — prefers an
 * explicit opt-in label so pages can name things precisely
 * (`data-analytics-label="Withdraw button"`), falls back to visible
 * text content, then the element's tag as a last resort. Never
 * anything that could contain user data (input values, card numbers)
 * — only the label of the interactive element itself. */
function labelForClick(el: Element | null): string | null {
  let node: Element | null = el
  for (let depth = 0; node && depth < 4; depth++, node = node.parentElement) {
    const explicit = node.getAttribute?.('data-analytics-label')
    if (explicit) return explicit
    if (node.tagName === 'BUTTON' || node.tagName === 'A' || node.getAttribute('role') === 'button') {
      const text = node.textContent?.trim().replace(/\s+/g, ' ').slice(0, 80)
      if (text) return text
      const ariaLabel = node.getAttribute('aria-label')
      if (ariaLabel) return ariaLabel
      return `${node.tagName.toLowerCase()} (unlabeled)`
    }
  }
  return null
}

/**
 * Mounted once near the app root (see main.tsx / App.tsx), active
 * regardless of auth state so pre-login pages (landing, login) are
 * tracked too — feeds the live-metrics dashboard on the admin CRM and
 * director portal. See backend/app/services/analytics_service.py for
 * what happens to this data; nothing here ever leaves this codebase's
 * own backend.
 */
export function AnalyticsTracker() {
  const location = useLocation()
  const user = useAuthStore(s => s.user)
  const sessionIdRef = useRef(getSessionId())

  // Kept in refs, not just closure variables, specifically so the
  // single document-level click listener below (mounted once, for the
  // app's whole lifetime) always reads the CURRENT path/user rather
  // than whatever they were the moment the listener was attached.
  const locationRef = useRef(location.pathname)
  const userRef = useRef(user)
  locationRef.current = location.pathname
  userRef.current = user

  useEffect(() => {
    sendEvent({
      event_type: 'pageview',
      path: location.pathname,
      session_id: sessionIdRef.current,
      user_id: user?.id ?? null,
      role: user?.role ?? null,
      referrer: document.referrer || null,
    })
  }, [location.pathname, user?.id, user?.role])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const label = labelForClick(e.target as Element)
      if (!label) return   // clicks with no interactive ancestor aren't meaningful to chart
      sendEvent({
        event_type: 'click',
        path: locationRef.current,
        label,
        session_id: sessionIdRef.current,
        user_id: userRef.current?.id ?? null,
        role: userRef.current?.role ?? null,
      })
    }
    document.addEventListener('click', handler, { capture: true })
    return () => document.removeEventListener('click', handler, { capture: true })
  }, [])

  return null
}
