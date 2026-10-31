/** Light haptics. Silently no-ops where unsupported (iOS Safari, desktop, SSR). */
type Pattern = 'tap' | 'select' | 'success' | 'warning' | 'error'

const PATTERNS: Record<Pattern, number | number[]> = {
  tap: 8,
  select: 12,
  success: [10, 40, 18],
  warning: [20, 50, 20],
  error: [30, 40, 30, 40, 30],
}

export function haptic(kind: Pattern = 'tap'): void {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    navigator.vibrate(PATTERNS[kind])
  } catch {
    /* ignore */
  }
}
