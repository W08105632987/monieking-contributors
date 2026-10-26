import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { StarfieldBackground } from './StarfieldBackground'
import { Crown, Users, Wallet } from 'lucide-react'
import { OrbitRing } from '@/components/onboarding/OrbitRing'

const SPLASH_MIN_DURATION_MS = 1500

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
          className="fixed inset-0 z-[999] flex flex-col items-center justify-center overflow-hidden bg-[#02100a]"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.35, ease: 'easeOut' } }}
        >
          <div
            aria-hidden="true"
            className="absolute inset-0"
            style={{ background: 'radial-gradient(70% 45% at 50% 38%, rgba(16,185,129,0.22), transparent 70%), linear-gradient(180deg,#03160e 0%,#02100a 60%,#010a06 100%)' }}
          />
          <StarfieldBackground className="opacity-40" starCount={50} />

          <div className="relative flex w-full max-w-sm flex-col items-center px-6">
            <motion.div
              className="aspect-square w-[78%] max-w-[18rem]"
              initial={{ scale: 0.6, opacity: 0, rotate: -10 }}
              style={{ willChange: 'transform, opacity' }}
              animate={{ scale: 1, opacity: 1, rotate: 0 }}
              transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            >
              <OrbitRing badges={[
                { icon: Crown, angle: 38, radius: 52, accent: true },
                { icon: Users, angle: 232, radius: 50 },
                { icon: Wallet, angle: 148, radius: 52 },
              ]}>
                <div className="relative flex h-full w-full flex-col items-center justify-center bg-[rgb(5,46,22)]">
                  <img src="/icons/icon-512.png" alt="" width={512} height={512} className="h-[52%] w-[52%] object-contain" draggable={false} />
                  <p className="mt-1 font-display text-[1.05rem] font-extrabold tracking-wide text-white">
                    MONIE<span className="text-amber-400">KING</span>
                  </p>
                  <p className="mt-0.5 text-[0.5rem] font-medium tracking-[0.1em] whitespace-nowrap text-emerald-100/70">SAVE • CONTRIBUTE • GROW</p>
                  {/* shimmer: a soft gradient moved with transform (no blur filter, no layout work) */}
                  <motion.div
                    className="pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/20 to-transparent"
                    style={{ willChange: 'transform' }}
                    initial={{ x: '-120%' }}
                    animate={{ x: '420%' }}
                    transition={{ delay: 0.55, duration: 0.8, ease: 'easeInOut' }}
                  />
                </div>
              </OrbitRing>
            </motion.div>

            <div className="mt-12 h-[3px] w-28 overflow-hidden rounded-full bg-white/10">
              <motion.div
                className="h-full w-full origin-left rounded-full bg-amber-500"
                style={{ willChange: 'transform' }}
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ duration: SPLASH_MIN_DURATION_MS / 1000 - 0.2, ease: 'linear' }}
              />
            </div>
            <motion.p
              className="mt-4 text-center text-sm text-emerald-100/70"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.35, duration: 0.35 }}
            >
              Building a stronger<br />tomorrow together...
            </motion.p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
