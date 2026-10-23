import { AnimatePresence, motion } from 'framer-motion'
import { CheckCircle2, Download, XCircle } from 'lucide-react'
import { useDownloadStore } from '@/store/download.store'

/** Mounted once in main.tsx — the single progress modal every download in the app uses. */
export function DownloadHost() {
  const { open, filename, label, progress, phase, error, close } = useDownloadStore()
  const pct = Math.round(progress ?? 0)
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[10001] flex items-center justify-center px-5" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0 bg-green-950/60 backdrop-blur-sm" onClick={phase === 'working' ? undefined : close} />
          <motion.div className="relative w-full max-w-sm rounded-3xl bg-white p-6 text-center shadow-2xl dark:bg-night-800"
            initial={{ scale: 0.9, y: 18, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
            transition={{ type: 'spring', damping: 22, stiffness: 300 }}>
            <div className="relative mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
              {phase === 'working' && (<>
                <motion.span className="absolute inset-0 rounded-full border-2 border-green-400/60" animate={{ scale: [1, 1.35], opacity: [0.7, 0] }} transition={{ duration: 1.4, repeat: Infinity }} />
                <motion.div animate={{ y: [-3, 3, -3] }} transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}><Download className="h-7 w-7 text-green-700 dark:text-green-300" /></motion.div>
              </>)}
              {phase === 'done' && (
                <motion.div initial={{ scale: 0, rotate: -30 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', damping: 10, stiffness: 260 }}>
                  <CheckCircle2 className="h-9 w-9 text-green-600" />
                </motion.div>
              )}
              {phase === 'error' && <XCircle className="h-9 w-9 text-red-500" />}
            </div>

            <p className="text-base font-extrabold text-green-950 dark:text-white">
              {phase === 'error' ? 'Download failed' : phase === 'done' ? 'Downloaded' : label}
            </p>
            <p className="mt-1 break-words text-xs font-semibold text-green-600 dark:text-night-200">{filename}</p>

            {phase !== 'error' ? (
              <div className="mt-5">
                <div className="h-2.5 overflow-hidden rounded-full bg-green-100 dark:bg-night-600">
                  <motion.div className="relative h-full rounded-full bg-gradient-to-r from-green-500 to-amber-400"
                    initial={false} animate={{ width: `${phase === 'done' ? 100 : pct}%` }} transition={{ ease: 'easeOut', duration: 0.35 }}>
                    {phase === 'working' && <motion.span className="absolute inset-y-0 w-10 bg-white/40 blur-sm" animate={{ x: ['-100%', '400%'] }} transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }} />}
                  </motion.div>
                </div>
                <p className="mt-2 text-sm font-bold tabular-nums text-green-800 dark:text-night-100">{phase === 'done' ? '100%' : `${pct}%`}</p>
              </div>
            ) : (
              <>
                <p className="mt-3 text-sm text-red-600 dark:text-red-300">{error}</p>
                <button onClick={close} className="mt-5 w-full rounded-xl bg-green-900 py-3 text-sm font-bold text-white active:scale-95 dark:bg-night-100 dark:text-night-900">Close</button>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
