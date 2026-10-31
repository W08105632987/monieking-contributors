import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, CheckCircle2, XCircle, Clock, Share2, Download, Copy, ChevronDown } from 'lucide-react'
import toast from '@/lib/notify'
import { formatNaira } from '@/lib/utils'
import { exportReceiptAsPng, exportReceiptAsPdf, shareReceipt } from '@/lib/exportReceipt'
import { cn } from '@/lib/utils'
import { AppLogo } from '@/components/ui/AppLogo'
import { BillerLogo } from '@/components/billers/BillerLogo'
import { TokenCard } from '@/components/billers/TokenCard'
import { rgba, type BillerBrand } from '@/lib/billerBrand'
import { sheetMotion, SHEET_DURATION } from '@/lib/motion'
import { useScrollLock } from '@/hooks/useScrollLock'
import { haptic } from '@/lib/haptics'

export type ReceiptStatus = 'completed' | 'failed' | 'pending'

export interface ReceiptField {
  label: string
  value: string
  /** Renders large/monospace with its own copy button — use for tokens/PINs. */
  emphasis?: boolean
  /** 'token' renders the big grouped-digits card with Copy and Read-out buttons (electricity tokens). */
  kind?: 'token'
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
  /** The provider/network paid. Puts its logo and colours on the receipt. */
  brand?: BillerBrand | null
}

const statusMeta: Record<ReceiptStatus, { label: string; icon: typeof CheckCircle2; color: string; bg: string }> = {
  completed: { label: 'Successful', icon: CheckCircle2, color: 'text-green-700 dark:text-green-400', bg: 'bg-green-50 dark:bg-green-900/20' },
  failed:    { label: 'Failed',     icon: XCircle,       color: 'text-red-600 dark:text-red-400',     bg: 'bg-red-50 dark:bg-red-900/20' },
  pending:   { label: 'Processing', icon: Clock,          color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-900/20' },
}

export function PaymentReceipt(props: PaymentReceiptProps) {
  const { open, onClose, status, amountKobo, serviceName, reference, timestamp, fields, failureReason, paidBy, brand } = props
  const receiptRef = useRef<HTMLDivElement>(null)
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  // Heavy content (token cards, field list, logo animation) mounts only after the slide-up
  // has finished, so the transition runs on a trivially cheap tree and never drops frames.
  const [ready, setReady] = useState(false)
  useScrollLock(open)
  useEffect(() => {
    if (!open) { setReady(false); return }
    haptic('success')
    // Fallback in case onAnimationComplete is skipped (reduced motion, interrupted animation).
    const t = window.setTimeout(() => setReady(true), Math.round(SHEET_DURATION * 1000) + 120)
    return () => window.clearTimeout(t)
  }, [open])

  const meta = statusMeta[status]
  const StatusIcon = meta.icon
  const filenameSafe = `MonieKing Receipt ${reference}`

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
          {...sheetMotion}
          style={{ willChange: ready ? 'auto' : 'transform', contain: 'layout paint' }}
          onAnimationComplete={(def) => { if (def === 'animate' || (typeof def === 'object' && (def as { y?: unknown }).y === 0)) setReady(true) }}
          role="dialog"
          aria-modal="true"
          aria-label="Payment receipt"
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
          <div className="flex-1 overflow-y-auto px-4 py-5 flex justify-center bg-green-50/60 dark:bg-night-900">
            <div
              ref={receiptRef}
              className="w-full max-w-sm self-start bg-white dark:bg-night-800 rounded-3xl overflow-hidden shadow-sm border border-green-100 dark:border-night-700"
            >
              {/* Header band — the provider's colours and logo (or our own mark) */}
              <div
                className="px-5 pt-6 pb-5 flex flex-col items-center text-center"
                style={{ backgroundImage: brand ? `linear-gradient(180deg, ${rgba(brand.main, 0.22)} 0%, ${rgba(brand.main, 0.04)} 100%)` : 'linear-gradient(180deg, rgba(20,83,45,0.10), rgba(20,83,45,0.02))' }}
              >
                {brand ? (
                  ready ? (
                    <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.22, ease: 'easeOut' }}>
                      <BillerLogo brand={brand} size={60} glow />
                    </motion.div>
                  ) : (
                    <div className="h-[60px] w-[60px] rounded-2xl bg-green-100/70 dark:bg-night-700" />
                  )
                ) : (
                  <div className="w-14 h-14 rounded-2xl bg-green-900 flex items-center justify-center">
                    <AppLogo size={30} rounded="10px" />
                  </div>
                )}
                <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-green-600 dark:text-night-300">Payment receipt</p>

                <div className={cn('mt-2.5 inline-flex items-center gap-1.5 rounded-full px-3 py-1', meta.bg)}>
                  <StatusIcon className={cn('w-3.5 h-3.5', meta.color)} />
                  <span className={cn('text-xs font-bold', meta.color)}>{meta.label}</span>
                </div>

                <p className="mt-3 font-extrabold leading-none text-green-950 dark:text-white" style={{ fontSize: 'clamp(1.75rem, 9vw, 2.25rem)' }}>{formatNaira(amountKobo)}</p>
                <p className="mt-2 px-2 text-[13px] leading-snug text-green-700 dark:text-night-200 break-words">{serviceName}</p>
              </div>

              {!ready ? (
                <div className="px-5 pb-6 pt-5 space-y-4" aria-hidden>
                  {[0, 1, 2, 3, 4].map((i) => (
                    <div key={i} className="flex justify-between gap-6">
                      <div className="h-3 w-20 rounded bg-green-100/70 dark:bg-night-700" />
                      <div className="h-3 w-28 rounded bg-green-100/70 dark:bg-night-700" />
                    </div>
                  ))}
                </div>
              ) : (
              <div className="px-5 pb-5">
                {status === 'failed' && failureReason && (
                  <div className="mt-4 rounded-xl bg-red-50 dark:bg-red-900/20 px-3.5 py-3 text-[13px] leading-snug text-red-700 dark:text-red-300 break-words">
                    {failureReason} — you were not charged for this transaction.
                  </div>
                )}
                {status === 'pending' && (
                  <div className="mt-4 rounded-xl bg-amber-50 dark:bg-amber-900/20 px-3.5 py-3 text-[13px] leading-snug text-amber-700 dark:text-amber-300">
                    This payment is still being confirmed. You will not be charged twice, and any failed payment is refunded automatically.
                  </div>
                )}

                {/* Special blocks first: tokens / PINs */}
                {fields.some((f) => f.kind === 'token') && (
                  <div className="mt-4 space-y-3">
                    {fields.filter((f) => f.kind === 'token').map((f) => (
                      <TokenCard key={f.label} token={f.value} label={f.label} brand={brand} />
                    ))}
                  </div>
                )}

                {/* Ticket tear line */}
                <div className="my-5 border-t-2 border-dashed border-green-100 dark:border-night-600" />

                {/* Details — label left, value right, long values wrap instead of overflowing */}
                <dl className="space-y-3.5">
                  {fields.filter((f) => f.kind !== 'token').map((f) => (
                    <div key={f.label} className="flex items-start justify-between gap-4">
                      <dt className="w-[38%] shrink-0 text-[12px] leading-5 text-green-500 dark:text-night-400">{f.label}</dt>
                      <dd className="min-w-0 flex-1 text-right">
                        {f.emphasis ? (
                          <button
                            onClick={() => { navigator.clipboard.writeText(f.value); toast.success(`${f.label} copied`) }}
                            className="inline-flex max-w-full items-center justify-end gap-1.5 font-mono text-[13px] font-bold leading-5 text-green-950 dark:text-white break-all"
                          >
                            <span className="break-all">{f.value}</span>
                            <Copy className="w-3.5 h-3.5 text-green-400 shrink-0" />
                          </button>
                        ) : (
                          <span className="text-[13px] font-semibold leading-5 text-green-950 dark:text-night-100 break-words">{f.value}</span>
                        )}
                      </dd>
                    </div>
                  ))}
                  <div className="flex items-start justify-between gap-4">
                    <dt className="w-[38%] shrink-0 text-[12px] leading-5 text-green-500 dark:text-night-400">Date</dt>
                    <dd className="min-w-0 flex-1 text-right text-[13px] font-semibold leading-5 text-green-950 dark:text-night-100">{timestamp}</dd>
                  </div>
                  {paidBy && (
                    <div className="flex items-start justify-between gap-4">
                      <dt className="w-[38%] shrink-0 text-[12px] leading-5 text-green-500 dark:text-night-400">Processed by</dt>
                      <dd className="min-w-0 flex-1 text-right text-[13px] font-semibold leading-5 text-green-950 dark:text-night-100 break-words">{paidBy}</dd>
                    </div>
                  )}
                  <div className="flex items-start justify-between gap-4">
                    <dt className="w-[38%] shrink-0 text-[12px] leading-5 text-green-500 dark:text-night-400">Reference</dt>
                    <dd className="min-w-0 flex-1 text-right">
                      <button onClick={copyReference} className="inline-flex max-w-full items-center justify-end gap-1.5 text-[12px] font-semibold leading-5 text-green-950 dark:text-night-100">
                        <span className="break-all text-right font-mono">{reference}</span>
                        <Copy className="w-3.5 h-3.5 text-green-400 shrink-0" />
                      </button>
                    </dd>
                  </div>
                </dl>

                {/* Footer */}
                <div className="mt-6 pt-4 border-t border-green-50 dark:border-night-700 text-center">
                  <p className="text-[11px] font-semibold text-green-600 dark:text-night-300">Powered by MonieKing</p>
                  <p className="mt-0.5 text-[11px] text-green-400 dark:text-night-500">Need help? Chat us on WhatsApp</p>
                </div>
              </div>
              )}
            </div>
          </div>

          {/* Sticky action bar */}
          <div className="shrink-0 border-t border-green-50 dark:border-night-700 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] flex gap-3 relative">
            <button
              onClick={handleShare}
              disabled={busy || !ready}
              className="flex-1 flex items-center justify-center gap-2 rounded-2xl bg-green-900 text-white font-semibold py-3.5 disabled:opacity-60 active:scale-[0.98] transition-transform"
            >
              <Share2 className="w-4 h-4" /> Share
            </button>

            <div className="relative">
              <button
                onClick={() => setExportMenuOpen((o) => !o)}
                disabled={busy || !ready}
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
