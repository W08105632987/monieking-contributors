import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useSeason } from '@/hooks/useSeasonal'
import { SEASON_DECOR } from '@/lib/seasonal'
import { useAuthStore } from '@/store/auth.store'
import { playJingle, shouldPlayJingle, markJinglePlayed } from '@/lib/jingle'

const PARTICLES = Array.from({ length: 14 }, (_, i) => ({
  left: (i * 73) % 100,
  size: 14 + ((i * 7) % 12),
  delay: -((i * 1.7) % 14),
  duration: 14 + ((i * 3) % 9),
  drift: ((i % 2 === 0 ? 1 : -1) * (10 + ((i * 5) % 30))),
}))

/** Light, non-blocking seasonal decoration over the whole app + a one-time greeting per session. */
export function SeasonalLayer() {
  const season = useSeason()
  const [greet, setGreet] = useState(false)
  const userId = useAuthStore((s) => (s.isAuthenticated ? s.user?.id : undefined))

  // First login while the Christmas theme is on: one short jingle, once per person per year. If the browser
  // refuses sound until the person touches the screen, wait for that first tap and try again.
  useEffect(() => {
    if (season !== 'christmas' || !userId) return
    const year = new Date().getFullYear()
    if (!shouldPlayJingle(userId, year)) return
    let cancelled = false
    const attempt = async () => {
      if (cancelled) return
      if (await playJingle()) { markJinglePlayed(userId, year); cleanup() }
    }
    const cleanup = () => { window.removeEventListener('pointerdown', attempt); window.removeEventListener('keydown', attempt) }
    void attempt()
    window.addEventListener('pointerdown', attempt)
    window.addEventListener('keydown', attempt)
    return () => { cancelled = true; cleanup() }
  }, [season, userId])

  useEffect(() => {
    if (!season) return
    let seen = false
    try { seen = sessionStorage.getItem(`mk-season-${season}`) === '1'; sessionStorage.setItem(`mk-season-${season}`, '1') } catch { /* ignore */ }
    if (seen) return
    setGreet(true)
    const t = setTimeout(() => setGreet(false), 4500)
    return () => clearTimeout(t)
  }, [season])

  if (!season) return null
  const decor = SEASON_DECOR[season]

  return (
    <>
      <div aria-hidden="true" className="mk-season pointer-events-none fixed inset-0 z-[35] overflow-hidden">
        {PARTICLES.map((p, i) => (
          <span
            key={i}
            className="mk-fall absolute top-0 select-none"
            style={{
              left: `${p.left}%`, fontSize: p.size, animationDelay: `${p.delay}s`, animationDuration: `${p.duration}s`,
              ['--drift' as string]: `${p.drift}px`,
            }}
          >
            {decor.items[i % decor.items.length]}
          </span>
        ))}
      </div>
      <AnimatePresence>
        {greet && (
          <motion.div
            initial={{ y: -60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -60, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 24 }}
            className="pointer-events-none fixed left-1/2 z-[9000] -translate-x-1/2 rounded-full border border-amber-300/60 bg-green-950/90 px-4 py-2 text-xs font-bold text-amber-200 shadow-lg backdrop-blur"
            style={{ top: 'max(0.75rem, env(safe-area-inset-top))' }}
          >
            {decor.greeting}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
