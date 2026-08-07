import { useState } from 'react'
import { motion } from 'framer-motion'
import { X, AlertTriangle } from 'lucide-react'
import { api } from '@/lib/api'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { DISPUTE_REASON_LABEL, type DisputeEntityType, type DisputeReason } from '@/types'

const REASONS_BY_ENTITY: Record<DisputeEntityType, DisputeReason[]> = {
  wallet_transaction: ['not_mine', 'amount_wrong', 'duplicate', 'other'],
  withdrawal:          ['rejected_in_error', 'money_not_received', 'amount_wrong', 'other'],
}

export function DisputeModal({
  entityType,
  entityId,
  onClose,
}: {
  entityType: DisputeEntityType
  entityId: string
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [reason, setReason] = useState<DisputeReason | null>(null)
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async () => {
    if (!reason) { toast.error('Pick a reason'); return }
    if (message.trim().length < 3) { toast.error('Add a short note'); return }
    setSubmitting(true)
    try {
      await api.post('/disputes', { entity_type: entityType, entity_id: entityId, reason, message })
      toast.success('Dispute submitted — you can track it under My Disputes')
      qc.invalidateQueries({ queryKey: ['my-disputes'] })
      onClose()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail ?? 'Could not submit dispute')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-green-950/60 backdrop-blur-sm" />
      <motion.div
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 22, stiffness: 260, mass: 0.9 }}
        className="relative bg-white dark:bg-night-700 rounded-t-3xl w-full max-w-lg p-6 pb-10 max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-green-200 dark:bg-night-500 rounded-full mx-auto mb-5" />
        <button onClick={onClose} className="absolute top-5 right-5 w-8 h-8 rounded-full bg-green-50 dark:bg-night-600 flex items-center justify-center">
          <X className="w-4 h-4 text-green-700 dark:text-night-100" />
        </button>

        <div className="flex items-center gap-2 mb-5">
          <div className="w-10 h-10 bg-red-50 rounded-2xl flex items-center justify-center">
            <AlertTriangle className="w-5 h-5 text-red-400" />
          </div>
          <h2 className="text-green-900 dark:text-white font-bold text-lg">Raise a dispute</h2>
        </div>

        <p className="text-green-500 dark:text-night-200 text-xs font-semibold uppercase tracking-wide mb-2">What's wrong?</p>
        <div className="space-y-2 mb-5">
          {REASONS_BY_ENTITY[entityType].map(r => (
            <button
              key={r}
              onClick={() => setReason(r)}
              className={`w-full text-left px-4 py-3 rounded-xl border-2 text-sm font-semibold transition-colors ${
                reason === r
                  ? 'border-green-600 dark:border-night-200 bg-green-50 dark:bg-night-600 text-green-900 dark:text-white'
                  : 'border-green-100 dark:border-night-500 text-green-700 dark:text-night-100'
              }`}
            >
              {DISPUTE_REASON_LABEL[r]}
            </button>
          ))}
        </div>

        <p className="text-green-500 dark:text-night-200 text-xs font-semibold uppercase tracking-wide mb-2">Tell us more</p>
        <textarea
          value={message}
          onChange={e => setMessage(e.target.value)}
          placeholder="A short note helps whoever picks this up..."
          rows={4}
          maxLength={1000}
          className="w-full rounded-xl border-2 border-green-100 dark:border-night-500 bg-transparent px-4 py-3 text-sm text-green-900 dark:text-white placeholder:text-green-300 dark:placeholder:text-night-400 focus:outline-none focus:border-green-500 dark:focus:border-night-200 mb-5"
        />

        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="w-full bg-green-900 dark:bg-night-100 text-white dark:text-night-900 font-bold text-sm rounded-full py-4 active:scale-95 transition-all disabled:opacity-60"
        >
          {submitting ? 'Submitting...' : 'Submit dispute'}
        </button>
      </motion.div>
    </div>
  )
}