import { useState } from 'react'
import { motion } from 'framer-motion'
import { X, AlertTriangle } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import toast from '@/lib/notify'
import { friendlyError } from '@/lib/errorText'
import { sheetMotion, overlayMotion } from '@/lib/motion'

/** An officer reports a wrong marking (marked too much, or on the wrong card). Opens a chat with the directors. */
export function MarkingDisputeModal({ cardId, cardNumber, onClose }: { cardId: string; cardNumber: number | string; onClose: () => void }) {
  const nav = useNavigate()
  const [reason, setReason] = useState<'over_marked' | 'wrong_card_marked'>('over_marked')
  const [days, setDays] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (busy) return
    if (message.trim().length < 10) { toast.error('Tell the director what happened (at least a short sentence).'); return }
    setBusy(true)
    try {
      const { data } = await api.post('/disputes/marking', { card_id: cardId, reason, message: message.trim(), days_wrong: days ? Number(days) : null })
      toast.success('Reported. A director will call the customer and fix the card.')
      onClose()
      nav(`/disputes/${data.id}`)
    } catch (e) { toast.error(friendlyError(e, 'Could not send your report')) } finally { setBusy(false) }
  }

  const opt = (v: typeof reason, label: string, hint: string) => (
    <button type="button" onClick={() => setReason(v)}
      className={`w-full rounded-2xl border-2 px-4 py-3 text-left ${reason === v ? 'border-green-700 bg-green-50 dark:border-copper-400 dark:bg-night-600' : 'border-green-100 dark:border-night-500'}`}>
      <p className="text-sm font-bold text-green-900 dark:text-white">{label}</p>
      <p className="text-xs text-green-600 dark:text-night-300">{hint}</p>
    </button>
  )

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center" onClick={onClose}>
      <motion.div {...overlayMotion} className="absolute inset-0 bg-green-950/60" />
      <motion.div {...sheetMotion} className="relative max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-6 pb-10 dark:bg-night-700" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-5 h-1 w-10 rounded-full bg-green-200 dark:bg-night-500" />
        <button onClick={onClose} aria-label="Close" className="absolute right-5 top-5 flex h-8 w-8 items-center justify-center rounded-full bg-green-50 dark:bg-night-600"><X className="h-4 w-4 text-green-700 dark:text-night-100" /></button>
        <div className="mb-4 flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-amber-500" /><h2 className="text-lg font-bold text-green-900 dark:text-white">Report a wrong marking · Card #{cardNumber}</h2></div>
        <div className="space-y-2">
          {opt('over_marked', 'I marked more than the customer paid', 'Too many days or too much money was marked.')}
          {opt('wrong_card_marked', 'I marked the wrong card', 'The money belongs on a different card.')}
        </div>
        <label className="mt-4 block text-xs font-semibold text-green-700 dark:text-night-200">How many days are wrong? (optional)
          <input value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, '').slice(0, 3))} inputMode="numeric" className="mt-1 w-full rounded-xl border border-green-200 bg-white px-3 py-2.5 text-sm dark:border-night-500 dark:bg-night-800 dark:text-white" />
        </label>
        <label className="mt-3 block text-xs font-semibold text-green-700 dark:text-night-200">What happened?
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4} placeholder="e.g. The customer paid ₦2,000 but I marked ₦5,000 by mistake." className="mt-1 w-full rounded-xl border border-green-200 bg-white px-3 py-2.5 text-sm dark:border-night-500 dark:bg-night-800 dark:text-white" />
        </label>
        <p className="mt-3 text-xs text-green-600 dark:text-night-300">A director will call the customer, check, then remove the wrong days. The money for removed days goes back to your wallet.</p>
        <button onClick={submit} disabled={busy} className="mt-4 w-full rounded-2xl bg-green-900 py-3.5 text-sm font-bold text-white disabled:opacity-60 dark:bg-copper-400 dark:text-green-950">{busy ? 'Sending…' : 'Send to director'}</button>
      </motion.div>
    </div>
  )
}
