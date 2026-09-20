import { motion, AnimatePresence } from 'framer-motion'
import { X, ArrowDown } from 'lucide-react'
import { formatNaira, cn } from '@/lib/utils'

export interface ConfirmDetailRow {
  label: string
  value: string
  icon?: React.ReactNode
}

interface PaymentConfirmSheetProps {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  isSubmitting: boolean
  title: string
  icon?: React.ReactNode
  amountKobo: number
  walletBalanceKobo: number
  detailRows: ConfirmDetailRow[]
  confirmLabel?: string
}

/**
 * The standard fintech "review before you pay" sheet — used by both
 * AirtimeDataPage and BillPaymentPage. Tapping the amount-bearing Pay
 * button on either page opens this instead of firing the payment
 * straight away; the actual charge only happens when the person taps
 * Confirm & pay inside here. Shows exactly what a professional
 * fintech app shows at this step: current balance, what's about to
 * leave it, and what's left afterward — so there's never a surprise
 * balance after a payment completes.
 */
export function PaymentConfirmSheet({
  open, onClose, onConfirm, isSubmitting, title, icon, amountKobo, walletBalanceKobo, detailRows, confirmLabel = 'Confirm & pay',
}: PaymentConfirmSheetProps) {
  const balanceAfter = walletBalanceKobo - amountKobo
  const insufficientFunds = balanceAfter < 0

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center">
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 bg-green-950/60 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="relative bg-white dark:bg-night-800 rounded-t-3xl w-full max-w-lg p-6 pb-8"
          >
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2.5">
                {icon}
                <h2 className="text-green-950 dark:text-white font-extrabold text-lg">{title}</h2>
              </div>
              <button onClick={onClose} className="w-8 h-8 rounded-full bg-green-50 dark:bg-night-600 flex items-center justify-center">
                <X className="w-4 h-4 text-green-600 dark:text-night-200" />
              </button>
            </div>

            {/* Amount to be debited — the headline figure */}
            <div className="text-center mb-6">
              <p className="text-green-400 dark:text-night-300 text-xs font-semibold uppercase tracking-widest mb-1">Amount to be debited</p>
              <p className="text-green-950 dark:text-white text-4xl font-extrabold tracking-tight">{formatNaira(amountKobo)}</p>
            </div>

            {/* Detail rows — network, phone number, plan, meter, etc. */}
            {detailRows.length > 0 && (
              <div className="bg-green-50 dark:bg-night-700 rounded-2xl divide-y divide-green-100 dark:divide-night-600 mb-4 overflow-hidden">
                {detailRows.map((row, i) => (
                  <div key={i} className="flex items-center justify-between px-4 py-3">
                    <span className="text-green-500 dark:text-night-300 text-sm flex items-center gap-2">{row.icon}{row.label}</span>
                    <span className="text-green-950 dark:text-white text-sm font-bold">{row.value}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Balance before -> after */}
            <div className="bg-white dark:bg-night-700 border border-green-100 dark:border-night-500 rounded-2xl mb-6 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-green-500 dark:text-night-300 text-sm">Current balance</span>
                <span className="text-green-950 dark:text-white text-sm font-bold">{formatNaira(walletBalanceKobo)}</span>
              </div>
              <div className="flex items-center justify-center py-1 bg-green-50 dark:bg-night-600">
                <ArrowDown className="w-3.5 h-3.5 text-green-400 dark:text-night-300" />
              </div>
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-green-700 dark:text-night-100 text-sm font-semibold">Balance after</span>
                <span className={cn('text-sm font-extrabold', insufficientFunds ? 'text-red-500' : 'text-green-900 dark:text-white')}>
                  {formatNaira(Math.max(balanceAfter, 0))}
                </span>
              </div>
            </div>

            {insufficientFunds && (
              <p className="text-red-500 text-xs font-semibold text-center mb-4">
                Insufficient balance for this payment — top up your wallet first.
              </p>
            )}

            <button
              onClick={onConfirm}
              disabled={isSubmitting || insufficientFunds}
              className="w-full bg-green-900 dark:bg-copper-400 text-white dark:text-green-950 font-bold py-3.5 rounded-2xl disabled:opacity-50 active:scale-[0.98] transition-transform"
            >
              {isSubmitting ? 'Processing…' : confirmLabel}
            </button>
            <button
              onClick={onClose}
              disabled={isSubmitting}
              className="w-full text-green-500 dark:text-night-300 font-semibold text-sm py-3 disabled:opacity-50"
            >
              Cancel
            </button>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
