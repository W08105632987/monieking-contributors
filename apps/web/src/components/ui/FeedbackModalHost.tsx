import { AnimatePresence, motion } from 'framer-motion'
import { CheckCircle2, XCircle } from 'lucide-react'
import { useFeedbackStore } from '@/store/feedback.store'

/**
 * Mounted ONCE, in main.tsx, alongside <Toaster />. Triggered from
 * anywhere via showFeedback.success()/showFeedback.error() — no prop
 * drilling, no per-page state, same ergonomics as the toast calls it
 * sits next to.
 *
 * Always centered, on every viewport — unlike the existing <Modal />
 * component (components/ui/Modal.tsx), which is a bottom sheet on
 * mobile. That's a deliberate, separate design: this modal exists
 * specifically so a critical message can't be positioned somewhere the
 * eye skips past, which was the entire point of building it.
 */
export function FeedbackModalHost() {
  const { open, type, title, message, close } = useFeedbackStore()
  const isSuccess = type === 'success'

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 bg-green-950/60 backdrop-blur-sm z-[9998]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={close}
          />
          <div className="fixed inset-0 z-[9999] flex items-center justify-center px-6 pointer-events-none">
            <motion.div
              role="alertdialog"
              aria-modal="true"
              aria-live="assertive"
              className="pointer-events-auto w-full max-w-xs bg-white dark:bg-night-800 rounded-3xl p-6 flex flex-col items-center text-center shadow-2xl"
              initial={{ scale: 0.85, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: 'spring', damping: 22, stiffness: 320 }}
            >
              <div
                className={
                  isSuccess
                    ? 'w-14 h-14 rounded-full bg-green-50 dark:bg-green-900/30 flex items-center justify-center mb-4'
                    : 'w-14 h-14 rounded-full bg-red-50 dark:bg-red-900/30 flex items-center justify-center mb-4'
                }
              >
                {isSuccess ? (
                  <CheckCircle2 className="w-8 h-8 text-green-700 dark:text-green-400" />
                ) : (
                  <XCircle className="w-8 h-8 text-red-600 dark:text-red-400" />
                )}
              </div>

              <h2 className="text-green-950 dark:text-white font-extrabold text-lg leading-tight">
                {title}
              </h2>
              {message && (
                <p className="text-green-500 dark:text-night-300 text-sm mt-2 leading-relaxed">
                  {message}
                </p>
              )}

              <button
                onClick={close}
                className={
                  isSuccess
                    ? 'w-full mt-6 bg-green-900 text-white font-bold text-sm rounded-2xl py-3.5 active:scale-95 transition-all'
                    : 'w-full mt-6 bg-red-600 text-white font-bold text-sm rounded-2xl py-3.5 active:scale-95 transition-all'
                }
              >
                OK
              </button>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  )
}
