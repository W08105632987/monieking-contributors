import { useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { queryClient } from '@/lib/queryClient'
import { cn } from '@/lib/utils'

const THRESHOLD = 72      // px of pull needed to trigger
const MAX_PULL = 120
const RESIST = 0.5        // finger travel is felt as half as much, so it feels like rubber

/** Nearest ancestor that actually scrolls vertically (pages here scroll inside a flex-1 box, not the window). */
function scroller(el: EventTarget | null): HTMLElement | null {
  let n = el as HTMLElement | null
  while (n && n !== document.body && n !== document.documentElement) {
    const oy = getComputedStyle(n).overflowY
    if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight + 1) return n
    n = n.parentElement
  }
  return null
}

/**
 * Pull down from the top of any page to refresh it, like every phone app. The browser's own version is switched off
 * (the app sets overscroll-behavior-y: none to stop rubber-banding), so this restores it: it reloads every query on
 * screen, which is what a person wants after a network drop. Sheets, dialogs and horizontal swipes are left alone.
 */
export function PullToRefresh() {
  const [pull, setPull] = useState(0)
  const [busy, setBusy] = useState(false)
  const start = useRef<{ y: number; x: number } | null>(null)
  const pulling = useRef(false)
  const busyRef = useRef(false)

  useEffect(() => {
    const onStart = (e: TouchEvent) => {
      start.current = null; pulling.current = false
      if (busyRef.current || e.touches.length !== 1) return
      const t = e.target as HTMLElement | null
      // Not inside a sheet / modal / text field.
      if (t?.closest('[role="dialog"],[role="alertdialog"],input,textarea,select,[data-no-ptr]')) return
      if (t && getComputedStyle(t.closest('.fixed') ?? document.body).position === 'fixed' && !t.closest('nav')) {
        const f = t.closest('.fixed') as HTMLElement | null
        if (f && f.clientHeight >= window.innerHeight - 4) return   // a full-screen overlay is open
      }
      const sc = scroller(t)
      if ((sc ? sc.scrollTop : window.scrollY) > 0) return
      start.current = { y: e.touches[0]!.clientY, x: e.touches[0]!.clientX }
    }
    const onMove = (e: TouchEvent) => {
      const s = start.current
      if (!s || busyRef.current) return
      const dy = e.touches[0]!.clientY - s.y
      const dx = e.touches[0]!.clientX - s.x
      if (!pulling.current) {
        if (dy < 8 || Math.abs(dx) > dy) { if (dy < -4) start.current = null; return }   // upward or sideways: not ours
        pulling.current = true
      }
      setPull(Math.min(MAX_PULL, dy * RESIST))
    }
    const onEnd = async () => {
      const was = pulling.current
      start.current = null; pulling.current = false
      if (!was) return
      setPull((p) => {
        if (p >= THRESHOLD * RESIST + 20) { void run(); return 56 }
        return 0
      })
    }
    const run = async () => {
      if (busyRef.current) return
      busyRef.current = true; setBusy(true)
      try {
        await Promise.race([queryClient.refetchQueries({ type: 'active' }), new Promise((r) => setTimeout(r, 8000))])
      } catch { /* the pages show their own errors */ }
      busyRef.current = false; setBusy(false); setPull(0)
    }
    window.addEventListener('touchstart', onStart, { passive: true })
    window.addEventListener('touchmove', onMove, { passive: true })
    window.addEventListener('touchend', onEnd, { passive: true })
    window.addEventListener('touchcancel', onEnd, { passive: true })
    return () => {
      window.removeEventListener('touchstart', onStart); window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onEnd); window.removeEventListener('touchcancel', onEnd)
    }
  }, [])

  const ready = pull >= THRESHOLD * RESIST + 20
  return (
    <div aria-hidden={!pull && !busy} className="pointer-events-none fixed inset-x-0 top-0 z-[70] flex justify-center"
      style={{ transform: `translateY(${pull ? pull - 44 : -60}px)`, transition: pull && !busy ? 'none' : 'transform 220ms cubic-bezier(0.22,1,0.36,1)', paddingTop: 'env(safe-area-inset-top)' }}>
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-lg ring-1 ring-green-100 dark:bg-night-700 dark:ring-night-500">
        <RefreshCw className={cn('h-5 w-5 text-green-700 dark:text-night-100', busy && 'animate-spin')} style={busy ? undefined : { transform: `rotate(${pull * 4}deg)`, opacity: ready ? 1 : 0.6 }} />
      </div>
    </div>
  )
}
