import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'
import { formatNaira, formatDateTime, MONTH_NAMES } from '@/lib/utils'
import type { ContributionRecord } from '@/types'

interface ContributionHistoryModalProps {
  open: boolean
  onClose: () => void
  contributions: ContributionRecord[]
}

/**
 * Full-page modal (not a route/page) listing every contribution ever
 * posted on a card. Card detail pages only show the 2 most recent
 * entries inline — this is what "View more" opens.
 */
export function ContributionHistoryModal({ open, onClose, contributions }: ContributionHistoryModalProps) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-green-50 flex flex-col"
        >
          <header className="flex items-center gap-3 px-4 py-3 border-b border-green-100 bg-white shrink-0">
            <button
              onClick={onClose}
              className="w-9 h-9 bg-green-50 border border-green-200 rounded-xl flex items-center justify-center active:scale-95 transition-all"
            >
              <X className="w-5 h-5 text-green-700" />
            </button>
            <div>
              <h1 className="text-green-900 font-extrabold text-lg leading-tight">Contribution history</h1>
              <p className="text-green-400 text-xs">
                {contributions.length} contribution{contributions.length === 1 ? '' : 's'} total
              </p>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto px-4 py-4">
            {contributions.length === 0 ? (
              <p className="text-green-400 text-sm text-center mt-10">No contributions yet.</p>
            ) : (
              <div className="bg-white rounded-2xl border border-green-100 shadow-card px-4">
                {contributions.map(c => (
                  <div key={c.id} className="flex items-center justify-between py-3 border-b border-green-50 last:border-0">
                    <div>
                      <p className="text-green-900 text-sm font-semibold">
                        {MONTH_NAMES[c.logical_month - 1]} Day {c.logical_day}
                      </p>
                      <p className="text-green-400 text-xs mt-0.5">
                        {c.method === 'cash_via_officer' ? 'Cash via officer' : 'Digital'} · {formatDateTime(c.created_at)}
                      </p>
                    </div>
                    <p className="text-green-700 font-bold text-sm">{formatNaira(c.amount_kobo)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
