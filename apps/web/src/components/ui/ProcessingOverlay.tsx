import { AnimatePresence, motion } from 'framer-motion'
import { useProcessingStore } from '@/store/processing.store'
import { LogoLoader } from '@/components/ui/LogoLoader'

/** Mounted once in main.tsx. Covers the confirm sheet the moment the PIN is entered, so nobody sees the sheet's
 *  balance change (it would flip to "insufficient balance" as the money leaves the wallet) before the receipt. */
export function ProcessingOverlay() {
  const label = useProcessingStore((s) => s.label)
  return (
    <AnimatePresence>
      {label && (
        <motion.div
          key="processing"
          role="alert"
          aria-live="assertive"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[90] flex flex-col items-center justify-center gap-5 bg-green-950/80 backdrop-blur-sm"
        >
          <LogoLoader size={88} />
          <div className="text-center px-8">
            <p className="text-white text-lg font-extrabold">{label}</p>
            <p className="text-green-200 text-sm mt-1">Please do not close this screen.</p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
