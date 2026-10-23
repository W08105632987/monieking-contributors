import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Crown } from 'lucide-react'
import { useCelebrateStore } from '@/store/celebrate.store'
import { fireConfetti } from '@/lib/confetti'

/** Animated "marked" moment: ring + drawn tick, message, and confetti when a card is completed. */
export function CelebrationHost() {
  const { current, close } = useCelebrateStore()

  useEffect(() => {
    if (!current) return
    if (current.cardComplete) { fireConfetti({ count: 240, duration: 3600 }); setTimeout(() => fireConfetti({ count: 120 }), 700) }
    else fireConfetti({ count: 60, duration: 1800 })
    const t = setTimeout(close, current.cardComplete ? 4200 : 2200)
    return () => clearTimeout(t)
  }, [current, close])

  return (
    <AnimatePresence>
      {current && (
        <motion.div
          className="fixed inset-0 z-[10040] flex items-center justify-center bg-black/55 px-6 backdrop-blur-sm"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={close}
        >
          <motion.div
            role="status"
            className="w-full max-w-xs rounded-3xl bg-white p-7 text-center shadow-2xl dark:bg-night-700"
            initial={{ scale: 0.7, y: 30, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 22 }}
          >
            <div className="relative mx-auto mb-4 h-24 w-24">
              <motion.span className="absolute inset-0 rounded-full bg-green-500/25" initial={{ scale: 0.6, opacity: 0.9 }} animate={{ scale: 1.7, opacity: 0 }} transition={{ duration: 1.1, repeat: 1 }} />
              <svg viewBox="0 0 96 96" className="relative h-24 w-24">
                <motion.circle cx="48" cy="48" r="42" fill="none" stroke="#16a34a" strokeWidth="6" strokeLinecap="round"
                  initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.55, ease: 'easeOut' }} />
                <motion.circle cx="48" cy="48" r="36" fill="#16a34a" initial={{ scale: 0 }} animate={{ scale: 1 }} style={{ originX: '48px', originY: '48px' }}
                  transition={{ delay: 0.35, type: 'spring', stiffness: 300, damping: 18 }} />
                <motion.path d="M30 49 L43 62 L67 36" fill="none" stroke="#fff" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round"
                  initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 0.5, duration: 0.4, ease: 'easeOut' }} />
              </svg>
              {current.cardComplete && (
                <motion.span className="absolute -top-3 left-1/2 -translate-x-1/2 text-amber-400" initial={{ y: 10, opacity: 0, rotate: -20 }} animate={{ y: 0, opacity: 1, rotate: 0 }} transition={{ delay: 0.9, type: 'spring' }}>
                  <Crown className="h-7 w-7" fill="currentColor" />
                </motion.span>
              )}
            </div>
            <motion.h2 className="font-display text-xl font-extrabold text-green-950 dark:text-white" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }}>
              {current.title}
            </motion.h2>
            {current.message && (
              <motion.p className="mt-1.5 text-sm text-green-700 dark:text-night-200" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.75 }}>
                {current.message}
              </motion.p>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
