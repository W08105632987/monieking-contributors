import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CheckCircle2, XCircle, Info } from 'lucide-react'
import { useNoticeStore } from '@/store/notice.store'

/** Mounted once in main.tsx. Errors: a centred box with an OK button. Everything else: a small self-closing card. */
export function NoticeHost() {
  const { open, kind, text, icon, seq, durationMs, close } = useNoticeStore()

  useEffect(() => {
    if (!open || !durationMs) return
    const t = setTimeout(close, durationMs)
    return () => clearTimeout(t)
  }, [open, seq, durationMs, close])

  const isError = kind === 'error'
  return (
    <AnimatePresence>
      {open && isError && (
        <motion.div key="err" className="fixed inset-0 z-[10000] flex items-center justify-center px-6"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0 bg-green-950/60" onClick={close} />
          <motion.div role="alertdialog" aria-modal="true" aria-live="assertive"
            className="relative w-full max-w-xs rounded-3xl bg-white p-6 text-center shadow-2xl dark:bg-night-800"
            initial={{ scale: 0.88, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.92, opacity: 0 }}
            transition={{ type: 'spring', damping: 22, stiffness: 320 }}>
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-50 dark:bg-red-900/30">
              <XCircle className="h-7 w-7 text-red-600 dark:text-red-400" />
            </div>
            <p className="text-sm font-semibold leading-relaxed text-green-950 dark:text-white">{text}</p>
            <button onClick={close} autoFocus
              className="mt-5 w-full rounded-2xl bg-red-600 py-3 text-sm font-bold text-white transition-all active:scale-95">OK</button>
          </motion.div>
        </motion.div>
      )}
      {open && !isError && (
        <div key="note" className="pointer-events-none fixed inset-0 z-[10000] flex items-center justify-center px-6">
          <motion.div role="status" aria-live="polite" onClick={close}
            className="pointer-events-auto flex max-w-xs items-center gap-3 rounded-2xl bg-green-950 px-4 py-3 text-sm font-semibold text-green-50 shadow-2xl"
            initial={{ scale: 0.9, opacity: 0, y: 8 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0 }}>
            {icon ? <span className="text-lg leading-none">{icon}</span>
              : kind === 'success' ? <CheckCircle2 className="h-5 w-5 shrink-0 text-amber-400" />
              : <Info className="h-5 w-5 shrink-0 text-amber-400" />}
            <span className="leading-snug">{text}</span>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
