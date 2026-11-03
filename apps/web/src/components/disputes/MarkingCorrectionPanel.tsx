import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Phone, Trash2, History } from 'lucide-react'
import { api } from '@/lib/api'
import toast from '@/lib/notify'
import { ask } from '@/lib/dialog'
import { friendlyError } from '@/lib/errorText'
import { formatNaira } from '@/lib/utils'

interface Ctx {
  status: string; claimed_by_me: boolean; claimed: boolean; reason: string
  card: { id: string; card_number: number; type: string; rate_kobo: number; status: string; days: number; total_kobo: number }
  customer: { id: string; name: string; customer_number?: string; phone: string | null }
  officer: { id: string; name: string; phone: string | null }
  days: { slot: number; month: number; day: number; amount_kobo: number; by_name: string | null; by_officer: boolean; at: string; withdrawn: boolean }[]
  total_days_on_card: number; officer_days_total: number; officer_days_at_end: number; withdrawn_at_end: number
  can_correct: boolean
  corrections: { mode: string; days: number; amount_kobo: number; note: string; at: string }[]
}

/** Shown on a marking dispute: the card, who marked each day, the customer's phone, and the correction buttons. */
export function MarkingCorrectionPanel({ disputeId, isDirector }: { disputeId: string; isDirector: boolean }) {
  const qc = useQueryClient()
  const [count, setCount] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const { data } = useQuery({ queryKey: ['marking', disputeId], queryFn: async () => (await api.get<Ctx>(`/disputes/${disputeId}/marking`)).data, refetchInterval: 15000 })
  if (!data) return null

  const correct = async (mode: 'remove_days' | 'remove_all') => {
    if (busy) return
    const n = mode === 'remove_all' ? data.officer_days_at_end : Number(count)
    if (mode === 'remove_days' && !(n > 0)) { toast.error('Enter how many of the last days to remove.'); return }
    if (note.trim().length < 5) { toast.error('Write what you found, so the officer and customer can see it.'); return }
    const ok = await ask(`This removes the last ${n} day(s) from card #${data.card.card_number} and returns their money to whoever paid. The card updates immediately for the customer.`, { title: 'Update the card?', tone: 'danger', confirmLabel: 'Remove and publish' })
    if (!ok) return
    setBusy(true)
    try {
      const r = (await api.post(`/disputes/${disputeId}/marking/correct`, mode === 'remove_all' ? { mode, note } : { mode, days: n, note })).data
      toast.success(`${r.removed} day(s) removed. Card updated.`)
      setCount(''); setNote('')
      qc.invalidateQueries({ queryKey: ['marking', disputeId] }); qc.invalidateQueries({ queryKey: ['dispute', disputeId] })
    } catch (e) { toast.error(friendlyError(e, 'Could not correct the card')) } finally { setBusy(false) }
  }

  const input = 'mt-1 w-full rounded-xl border border-green-200 bg-white px-3 py-2.5 text-sm text-green-950 dark:border-night-500 dark:bg-night-800 dark:text-white'
  return (
    <div className="mb-3 space-y-3 rounded-2xl border border-green-200 bg-white p-4 shadow-sm dark:border-night-600 dark:bg-night-700">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-green-700 dark:text-night-200">Marking on card #{data.card.card_number}</p>
          <p className="mt-0.5 text-sm font-semibold text-green-900 dark:text-white">{data.customer.name} · {data.card.days} days · {formatNaira(data.card.total_kobo)}</p>
          <p className="text-xs text-green-600 dark:text-night-300">Officer {data.officer.name} marked {data.officer_days_total} day(s) on this card</p>
        </div>
        {isDirector && data.customer.phone && (
          <a href={`tel:${data.customer.phone}`} className="flex shrink-0 items-center gap-1.5 rounded-full bg-green-900 px-3 py-2 text-xs font-bold text-white dark:bg-copper-400 dark:text-green-950"><Phone className="h-3.5 w-3.5" /> Call customer</a>
        )}
      </div>

      <div className="max-h-44 overflow-y-auto rounded-xl border border-green-100 dark:border-night-600">
        {data.days.map((d) => (
          <div key={d.slot} className={`flex items-center justify-between gap-2 border-b border-green-50 px-3 py-1.5 text-xs last:border-0 dark:border-night-600 ${d.by_officer ? 'bg-amber-50 dark:bg-amber-900/10' : ''}`}>
            <span className="font-semibold text-green-900 dark:text-white">Day {d.slot}</span>
            <span className="truncate text-green-600 dark:text-night-300">{d.by_name ?? '—'}{d.withdrawn ? ' · withdrawn' : ''}</span>
            <span className="font-semibold text-green-900 dark:text-white">{formatNaira(d.amount_kobo)}</span>
          </div>
        ))}
      </div>
      {data.total_days_on_card > data.days.length && <p className="text-[11px] text-green-600 dark:text-night-300">Showing the last {data.days.length} of {data.total_days_on_card} days. Highlighted rows were marked by the officer.</p>}

      {isDirector && data.can_correct && (
        data.claimed_by_me ? (
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-green-700 dark:text-night-200">What you found after calling the customer
              <textarea className={input} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Customer confirmed ₦2,000 only; 3 days were marked in error." />
            </label>
            <div className="flex items-end gap-2">
              <label className="flex-1 text-xs font-semibold text-green-700 dark:text-night-200">Remove last … days
                <input className={input} inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, '').slice(0, 3))} />
              </label>
              <button onClick={() => correct('remove_days')} disabled={busy} className="flex items-center gap-1.5 rounded-xl bg-amber-600 px-4 py-2.5 text-xs font-bold text-white disabled:opacity-60"><Trash2 className="h-3.5 w-3.5" /> Remove & publish</button>
            </div>
            <button onClick={() => correct('remove_all')} disabled={busy || data.officer_days_at_end < 1} className="w-full rounded-xl border-2 border-red-300 py-2.5 text-xs font-bold text-red-700 disabled:opacity-50 dark:border-red-800 dark:text-red-300">
              Remove all {data.officer_days_at_end} day(s) marked by the officer at the end of the card
            </button>
          </div>
        ) : (
          <p className="rounded-xl bg-amber-50 p-3 text-xs font-semibold text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">Claim this dispute first, call the customer, then fix the card here.</p>
        )
      )}

      {data.corrections.length > 0 && (
        <div className="space-y-1 border-t border-green-100 pt-2 dark:border-night-600">
          {data.corrections.map((c, i) => (
            <p key={i} className="flex items-start gap-1.5 text-xs text-green-800 dark:text-night-100"><History className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {c.days} day(s) removed · {formatNaira(c.amount_kobo)} returned — {c.note}</p>
          ))}
        </div>
      )}
    </div>
  )
}
