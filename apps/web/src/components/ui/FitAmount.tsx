import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * A big money figure that never overflows its card. It keeps the design's font size and only shrinks (down to 55%) when
 * the amount, e.g. ₦12,450,300.00, is too wide for the space it has. Re-fits when the text or the card width changes.
 */
export function FitAmount({ children, className, as: Tag = 'p' }: { children: ReactNode; className?: string; as?: 'p' | 'span' | 'div' }) {
  const ref = useRef<HTMLElement>(null)
  const text = typeof children === 'string' || typeof children === 'number' ? String(children) : ''

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const fit = () => {
      el.style.fontSize = ''
      const base = parseFloat(getComputedStyle(el).fontSize) || 16
      const avail = el.clientWidth
      const need = el.scrollWidth
      if (avail > 0 && need > avail + 1) {
        el.style.fontSize = `${Math.max(base * 0.55, base * (avail / need) * 0.97)}px`
      }
    }
    fit()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null
    if (ro && el.parentElement) ro.observe(el.parentElement)
    return () => ro?.disconnect()
  }, [text])

  const C = Tag as any
  return <C ref={ref} className={cn('block max-w-full min-w-0 overflow-hidden whitespace-nowrap', className)}>{children}</C>
}
