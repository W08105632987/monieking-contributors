import { AnimatePresence, motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { ShieldAlert } from 'lucide-react'
import { useKycGateStore } from '@/store/kyc.store'
import { useAuthStore } from '@/store/auth.store'
import { kycPath } from '@/lib/kyc'

/** Mounted once in main.tsx. "Complete your KYC" box with Cancel / Complete KYC. */
export function KycGateHost() {
  const { isOpen, close } = useKycGateStore()
  const role = useAuthStore((s) => s.user?.role)
  const nav = useNavigate()
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div className="fixed inset-0 z-[10001] flex items-center justify-center px-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0 bg-green-950/60" onClick={close} />
          <motion.div role="alertdialog" aria-modal="true" aria-labelledby="kyc-gate-title"
            className="relative w-full max-w-xs rounded-3xl bg-white p-6 text-center shadow-2xl dark:bg-night-800"
            initial={{ scale: 0.88, opacity: 0, y: 12 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.92, opacity: 0 }}
            transition={{ type: 'spring', damping: 22, stiffness: 320 }}>
            <motion.div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-amber-50 dark:bg-amber-900/30"
              animate={{ rotate: [0, -8, 8, -4, 4, 0] }} transition={{ duration: 0.7, delay: 0.2 }}>
              <ShieldAlert className="h-8 w-8 text-amber-600 dark:text-amber-400" />
            </motion.div>
            <h2 id="kyc-gate-title" className="text-lg font-extrabold text-green-950 dark:text-white">Complete your KYC</h2>
            <p className="mt-2 text-sm leading-relaxed text-green-700 dark:text-night-200">
              To use this service, please finish your identity verification first. It takes about a minute and you only do it once.
            </p>
            <button onClick={() => { close(); nav(kycPath(role)) }} autoFocus
              className="mt-5 w-full rounded-2xl bg-green-900 py-3 text-sm font-bold text-white transition active:scale-95 dark:bg-copper-400 dark:text-green-950">
              Complete KYC
            </button>
            <button onClick={close} className="mt-2 w-full rounded-2xl py-2.5 text-sm font-semibold text-green-700 dark:text-night-200">Cancel</button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
