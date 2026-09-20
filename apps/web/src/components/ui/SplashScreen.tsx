import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { StarfieldBackground } from './StarfieldBackground'
import { AppLogo } from './AppLogo'

const SPLASH_MIN_DURATION_MS = 1900

/**
 * The full-screen splash shown once, on app boot, before anything
 * else renders — not the small inline LogoLoader spinner used
 * elsewhere for in-page loading states (buttons, AuthGuard's brief
 * resolve window). This is the first thing anyone sees when they open
 * the app: logo only, no chrome, no UI.
 *
 * Mounted once at the very top of the tree (see App.tsx) and unmounts
 * itself after a minimum duration — actual data loading happens
 * underneath it regardless, this is purely presentational.
 *
 * `keepVisible` — pass the app's real "still checking the session"
 * flag (auth store's `isLoading`) here. Without it, the splash was
 * only ever guaranteed to last its own minimum timer, so on a slow
 * network the session check could still be pending by the time it
 * faded out — briefly exposing the landing/login page underneath
 * before the app corrected itself a moment later. Holding the splash
 * open until BOTH the minimum timer AND the real check have finished
 * closes that gap entirely — nothing underneath is ever visible
 * before the app actually knows whether you're signed in.
 */
export function SplashScreen({ onDone, keepVisible = false }: { onDone: () => void; keepVisible?: boolean }) {
  const [minDurationElapsed, setMinDurationElapsed] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setMinDurationElapsed(true), SPLASH_MIN_DURATION_MS)
    return () => clearTimeout(timer)
  }, [])

  const visible = !minDurationElapsed || keepVisible

  return (
    <AnimatePresence onExitComplete={onDone}>
      {visible && (
        <motion.div
          className="fixed inset-0 z-[999] flex items-center justify-center overflow-hidden bg-night-gradient"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.6, ease: 'easeInOut' } }}
        >
          <StarfieldBackground className="opacity-90" starCount={90} />

          <motion.div
            className="absolute rounded-full"
            style={{
              width: 420, height: 420,
              background: 'radial-gradient(circle, rgba(245,158,11,0.25) 0%, rgba(5,46,22,0) 70%)',
            }}
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 1.4, ease: 'easeOut' }}
          />

          <div className="relative flex flex-col items-center">
            <motion.div
              className="relative w-24 h-24 rounded-[28px] bg-green-900 flex items-center justify-center shadow-copper mb-5"
              initial={{ scale: 0.4, opacity: 0, rotate: -8 }}
              animate={{ scale: [0.4, 1.08, 1], opacity: 1, rotate: 0 }}
              transition={{ duration: 0.9, ease: [0.34, 1.56, 0.64, 1] }}
            >
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.3, duration: 0.4 }}
              >
                <AppLogo size={56} rounded="14px" />
              </motion.div>

              <div className="absolute inset-0 rounded-[28px] overflow-hidden pointer-events-none">
                <motion.div
                  className="absolute top-0 bottom-0 w-8 bg-white/25 blur-md"
                  style={{ left: '-20%' }}
                  animate={{ left: ['-20%', '130%'] }}
                  transition={{ delay: 0.9, duration: 0.9, ease: 'easeInOut' }}
                />
              </div>
            </motion.div>

            <motion.p
              className="text-white font-extrabold text-2xl tracking-tight"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5, duration: 0.5 }}
            >
              MonieKing
            </motion.p>
            <motion.p
              className="text-night-200 text-xs font-medium mt-1.5 tracking-wide"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.75, duration: 0.5 }}
            >
              Contribution savings, reimagined
            </motion.p>
          </div>

          <motion.div
            className="absolute bottom-14 h-[3px] bg-copper-400 rounded-full"
            initial={{ width: 0 }}
            animate={{ width: 120 }}
            transition={{ duration: SPLASH_MIN_DURATION_MS / 1000 - 0.3, ease: 'linear' }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  )
}
