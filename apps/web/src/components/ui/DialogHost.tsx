import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, CheckCircle2, HelpCircle, Info } from 'lucide-react'
import { useDialogStore } from '@/store/dialog.store'
import { cn } from '@/lib/utils'

const TONES = {
  default: { Icon: HelpCircle,    halo: 'bg-green-100 dark:bg-green-900/30', icon: 'text-green-700 dark:text-green-300', btn: 'bg-green-900 hover:bg-green-800 dark:bg-night-100 dark:text-night-900 text-white' },
  danger:  { Icon: AlertTriangle, halo: 'bg-red-100 dark:bg-red-900/30',     icon: 'text-red-600 dark:text-red-300',     btn: 'bg-red-600 hover:bg-red-700 text-white' },
  success: { Icon: CheckCircle2,  halo: 'bg-green-100 dark:bg-green-900/30', icon: 'text-green-700 dark:text-green-300', btn: 'bg-green-700 hover:bg-green-800 text-white' },
  info:    { Icon: Info,          halo: 'bg-amber-100 dark:bg-amber-900/30', icon: 'text-amber-600 dark:text-amber-300', btn: 'bg-green-900 hover:bg-green-800 dark:bg-night-100 dark:text-night-900 text-white' },
} as const

/** Mounted once in main.tsx. Renders whatever ask()/tell() queued. */
export function DialogHost() {
  const { current, settle } = useDialogStore()

  useEffect(() => {
    if (!current) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') settle(false)
      if (e.key === 'Enter') settle(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [current, settle])

  const t = current ? TONES[current.tone] : TONES.default
  return (
    <AnimatePresence>
      {current && (
        <motion.div key={current.id} className="fixed inset-0 z-[10000] flex items-center justify-center px-5"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0 bg-green-950/60" onClick={() => settle(false)} />
          <motion.div role="alertdialog" aria-modal="true"
            className="relative w-full max-w-sm rounded-3xl bg-white dark:bg-night-800 p-6 text-center shadow-2xl"
            initial={{ scale: 0.88, y: 16, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }} exit={{ scale: 0.94, opacity: 0 }}
            transition={{ type: 'spring', damping: 22, stiffness: 320 }}>
            <motion.div className={cn('mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full', t.halo)}
              initial={{ scale: 0.5, rotate: -12 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', damping: 12, stiffness: 260, delay: 0.05 }}>
              <t.Icon className={cn('h-8 w-8', t.icon)} />
            </motion.div>
            <h2 className="text-lg font-extrabold leading-tight text-green-950 dark:text-white">{current.title}</h2>
            {current.message && <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-green-700 dark:text-night-200">{current.message}</p>}
            <div className={cn('mt-6 grid gap-2', current.kind === 'confirm' ? 'grid-cols-2' : 'grid-cols-1')}>
              {current.kind === 'confirm' && (
                <button onClick={() => settle(false)} className="rounded-xl border-2 border-green-100 py-3 text-sm font-bold text-green-800 transition active:scale-95 dark:border-night-500 dark:text-night-100">
                  {current.cancelLabel}
                </button>
              )}
              <button autoFocus onClick={() => settle(true)} className={cn('rounded-xl py-3 text-sm font-bold transition active:scale-95', t.btn)}>
                {current.confirmLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
