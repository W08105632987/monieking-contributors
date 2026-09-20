import { useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, CheckCircle2, XCircle, Clock, Share2, Download, Copy, ChevronDown } from 'lucide-react'
import toast from 'react-hot-toast'
import { formatNaira } from '@/lib/utils'
import { exportReceiptAsPng, exportReceiptAsPdf, shareReceipt } from '@/lib/exportReceipt'
import { cn } from '@/lib/utils'
import { AppLogo } from '@/components/ui/AppLogo'

export type ReceiptStatus = 'completed' | 'failed' | 'pending'

export interface ReceiptField {
  label: string
  value: string
  /** Renders large/monospace with its own copy button — use for tokens/PINs. */
  emphasis?: boolean
}

export interface PaymentReceiptProps {
  open: boolean
  onClose: () => void
  status: ReceiptStatus
  amountKobo: number
  serviceName: string       // e.g. "Eko Electric — Prepaid", "MTN Data", "NIN Verification"
  reference: string
  timestamp: string          // already formatted, so this component doesn't own date-format decisions
  fields: ReceiptField[]
  failureReason?: string
  paidBy?: string             // "Processed by Officer: Jane D." — shown for officer-initiated transactions
}

const statusMeta: Record<ReceiptStatus, { label: string; icon: typeof CheckCircle2; color: string; bg: string }> = {
  completed: { label: 'Successful', icon: CheckCircle2, color: 'text-green-700 dark:text-green-400', bg: 'bg-green-50 dark:bg-green-900/20' },
  failed:    { label: 'Failed',     icon: XCircle,       color: 'text-red-600 dark:text-red-400',     bg: 'bg-red-50 dark:bg-red-900/20' },
  pending:   { label: 'Processing', icon: Clock,          color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-900/20' },
}

export function PaymentReceipt(props: PaymentReceiptProps) {
  const { open, onClose, status, amountKobo, serviceName, reference, timestamp, fields, failureReason, paidBy } = props
  const receiptRef = useRef<HTMLDivElement>(null)
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const meta = statusMeta[status]
  const StatusIcon = meta.icon
  const filenameSafe = `MonieKing-Receipt-${reference}`

  async function handleShare() {
    if (!receiptRef.current || busy) return
    setBusy(true)
    try {
      const result = await shareReceipt(receiptRef.current, filenameSafe)
      if (result === 'downloaded') toast.success('Receipt saved — sharing isn\'t supported on this browser')
    } catch {
      toast.error('Could not share receipt. Try downloading instead.')
    } finally {
      setBusy(false)
    }
  }

  async function handleExport(format: 'png' | 'pdf') {
    if (!receiptRef.current || busy) return
    setBusy(true)
    setExportMenuOpen(false)
    try {
      if (format === 'png') await exportReceiptAsPng(receiptRef.current, filenameSafe)
      else await exportReceiptAsPdf(receiptRef.current, filenameSafe)
      toast.success(`Receipt saved as ${format.toUpperCase()}`)
    } catch {
      toast.error('Could not export receipt. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  function copyReference() {
    navigator.clipboard.writeText(reference)
    toast.success('Reference copied')
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 bg-white dark:bg-night-900 flex flex-col"
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', damping: 32, stiffness: 300 }}
        >
          {/* Top bar */}
          <div className="flex items-center justify-between px-4 py-4 shrink-0 border-b border-green-50 dark:border-night-700">
            <span className="text-sm font-semibold text-green-900 dark:text-night-100">Receipt</span>
            <button
              onClick={onClose}
              className="w-9 h-9 flex items-center justify-center rounded-full bg-green-50 dark:bg-night-700 text-green-700 dark:text-night-200"
              aria-label="Close receipt"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Scrollable receipt content — this is the exact node captured for PNG/PDF export */}
          <div className="flex-1 overflow-y-auto px-4 py-6 flex justify-center">
            <div
              ref={receiptRef}
              className="w-full max-w-sm bg-white dark:bg-night-900 rounded-3xl p-6 flex flex-col items-center"
              style={{ aspectRatio: '9 / 16' }}
            >
              {/* Header — brand mark, matches LogoLoader's treatment */}
              <div className="flex flex-col items-center mb-6">
                <div className="w-14 h-14 rounded-2xl bg-green-900 flex items-center justify-center mb-2">
                  <AppLogo size={30} rounded="10px" />
                </div>
                <span className="text-xs text-green-600 dark:text-night-300 tracking-wide uppercase">Payment Receipt</span>
              </div>

              {/* Status band */}
              <div className={cn('w-full rounded-2xl flex items-center justify-center gap-2 py-2.5 mb-5', meta.bg)}>
                <StatusIcon className={cn('w-4 h-4', meta.color)} />
                <span className={cn('text-sm font-semibold', meta.color)}>{meta.label}</span>
              </div>

              {/* Amount */}
              <div className="text-center mb-1">
                <span className="text-3xl font-extrabold text-green-950 dark:text-white">{formatNaira(amountKobo)}</span>
              </div>
              <div className="text-sm text-green-600 dark:text-night-300 mb-6">{serviceName}</div>

              {status === 'failed' && failureReason && (
                <div className="w-full rounded-xl bg-red-50 dark:bg-red-900/20 px-4 py-3 mb-5 text-sm text-red-700 dark:text-red-300">
                  {failureReason} — you were not charged for this transaction.
                </div>
              )}

              {/* Details */}
              <div className="w-full space-y-3 mb-6">
                {fields.map((f) => (
                  <div key={f.label} className={cn('flex items-start justify-between gap-3', f.emphasis && 'flex-col')}>
                    <span className="text-xs text-green-500 dark:text-night-400 shrink-0">{f.label}</span>
                    {f.emphasis ? (
                      <button
                        onClick={() => { navigator.clipboard.writeText(f.value); toast.success(`${f.label} copied`) }}
                        className="w-full mt-1 flex items-center justify-between gap-2 rounded-xl bg-green-50 dark:bg-night-700 px-3 py-2.5 font-mono text-base font-bold text-green-950 dark:text-white"
                      >
                        {f.value}
                        <Copy className="w-4 h-4 text-green-500 dark:text-night-300 shrink-0" />
                      </button>
                    ) : (
                      <span className="text-sm font-medium text-green-900 dark:text-night-100 text-right break-words">{f.value}</span>
                    )}
                  </div>
                ))}
                <div className="flex items-start justify-between gap-3">
                  <span className="text-xs text-green-500 dark:text-night-400 shrink-0">Date</span>
                  <span className="text-sm font-medium text-green-900 dark:text-night-100">{timestamp}</span>
                </div>
                {paidBy && (
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-xs text-green-500 dark:text-night-400 shrink-0">Processed by</span>
                    <span className="text-sm font-medium text-green-900 dark:text-night-100 text-right">{paidBy}</span>
                  </div>
                )}
                <div className="flex items-start justify-between gap-3">
                  <span className="text-xs text-green-500 dark:text-night-400 shrink-0">Reference</span>
                  <button onClick={copyReference} className="flex items-center gap-1.5 text-sm font-medium text-green-900 dark:text-night-100">
                    {reference}
                    <Copy className="w-3.5 h-3.5 text-green-400" />
                  </button>
                </div>
              </div>

              {/* Footer */}
              <div className="mt-auto pt-4 border-t border-green-50 dark:border-night-700 w-full text-center">
                <p className="text-xs text-green-400 dark:text-night-500">Powered by MonieKing</p>
                <p className="text-xs text-green-400 dark:text-night-500">Need help? Chat us on WhatsApp</p>
              </div>
            </div>
          </div>

          {/* Sticky action bar */}
          <div className="shrink-0 border-t border-green-50 dark:border-night-700 px-4 py-3 flex gap-3 relative">
            <button
              onClick={handleShare}
              disabled={busy}
              className="flex-1 flex items-center justify-center gap-2 rounded-2xl bg-green-900 text-white font-semibold py-3.5 disabled:opacity-60"
            >
              <Share2 className="w-4 h-4" /> Share
            </button>

            <div className="relative">
              <button
                onClick={() => setExportMenuOpen((o) => !o)}
                disabled={busy}
                className="flex items-center justify-center gap-1.5 rounded-2xl bg-green-50 dark:bg-night-700 text-green-900 dark:text-night-100 font-semibold px-4 py-3.5 disabled:opacity-60"
              >
                <Download className="w-4 h-4" /> <ChevronDown className="w-3.5 h-3.5" />
              </button>
              <AnimatePresence>
                {exportMenuOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 8 }}
                    className="absolute bottom-full right-0 mb-2 bg-white dark:bg-night-800 rounded-2xl shadow-lg border border-green-50 dark:border-night-700 overflow-hidden w-36"
                  >
                    <button onClick={() => handleExport('png')} className="w-full text-left px-4 py-3 text-sm font-medium text-green-900 dark:text-night-100 hover:bg-green-50 dark:hover:bg-night-700">
                      Save as PNG
                    </button>
                    <button onClick={() => handleExport('pdf')} className="w-full text-left px-4 py-3 text-sm font-medium text-green-900 dark:text-night-100 hover:bg-green-50 dark:hover:bg-night-700">
                      Save as PDF
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
