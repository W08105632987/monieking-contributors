import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Copy, Check, X } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from '@/lib/notify'
import { ask } from '@/lib/dialog'
import { api, getErrorMessage } from '@/lib/api'
import { copyToClipboard, formatDateTime, formatNaira, cn } from '@/lib/utils'
import { ActionButton, DirectorModal, Notice } from '@/components/director/DirectorModal'

interface Payout { id: string; officer_name: string | null; amount_kobo: number; bank_name: string; account_number: string; account_name: string; status: 'pending' | 'paid' | 'rejected'; rejection_reason: string | null; requested_at: string; processed_at: string | null }
const TABS: { id: Payout['status']; label: string }[] = [{ id: 'pending', label: 'To pay' }, { id: 'paid', label: 'Paid' }, { id: 'rejected', label: 'Rejected' }]

/** Affiliated officers' payout requests. Same flow as customer withdrawals: pay to the details on the request, then mark paid or reject with a reason. */
export default function OfficerPayoutsPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [tab, setTab] = useState<Payout['status']>('pending')
  const [rejecting, setRejecting] = useState<Payout | null>(null)
  const [reason, setReason] = useState('')

  const { data = [], isLoading } = useQuery({ queryKey: ['officer-payouts', tab], queryFn: async () => (await api.get<Payout[]>(`/officer-earnings/payouts?status=${tab}`)).data })
  const done = () => { qc.invalidateQueries({ queryKey: ['officer-payouts'] }); qc.invalidateQueries({ queryKey: ['officer-earnings'] }) }
  const paid = useMutation({ mutationFn: (id: string) => api.post(`/officer-earnings/payouts/${id}/paid`), onSuccess: () => { toast.success('Marked paid'); done() }, onError: (e) => toast.error(getErrorMessage(e)) })
  const reject = useMutation({
    mutationFn: () => api.post(`/officer-earnings/payouts/${rejecting!.id}/reject`, { reason }),
    onSuccess: () => { toast.success('Payout rejected'); setRejecting(null); setReason(''); done() },
    onError: (e) => toast.error(getErrorMessage(e)),
  })
  const copy = async (t: string) => { (await copyToClipboard(t)) ? toast.success('Copied') : toast.error('Could not copy') }

  return (
    <div className="min-h-dvh flex flex-col bg-green-50 dark:bg-night-800">
      <header className="flex items-center gap-3 px-4 py-3">
        <button onClick={() => navigate(-1)} aria-label="Back" className="w-9 h-9 rounded-full bg-white dark:bg-night-700 border border-green-100 dark:border-night-500 flex items-center justify-center"><ArrowLeft className="w-4 h-4 text-green-700 dark:text-night-100" /></button>
        <h1 className="text-green-900 dark:text-white font-extrabold text-lg">Officer payouts</h1>
      </header>
      <div className="flex-1 overflow-y-auto px-4 pb-safe-nav">
        <div className="mb-4 flex gap-2">
          {TABS.map((t) => <button key={t.id} onClick={() => setTab(t.id)} className={cn('rounded-full px-4 py-2 text-xs font-bold border', tab === t.id ? 'border-transparent bg-green-900 text-white dark:bg-night-100 dark:text-night-900' : 'border-green-100 bg-white text-green-700 dark:border-night-500 dark:bg-night-700 dark:text-night-100')}>{t.label}</button>)}
        </div>
        {isLoading && <div className="h-24 animate-pulse rounded-2xl bg-white dark:bg-night-700" />}
        {!isLoading && data.length === 0 && <p className="py-10 text-center text-sm text-green-500 dark:text-night-300">{tab === 'pending' ? 'No payout requests waiting.' : 'Nothing here yet.'}</p>}
        {data.map((p) => (
          <div key={p.id} className="mb-3 rounded-2xl border border-green-100 bg-white p-4 shadow-card dark:border-night-500 dark:bg-night-700">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0"><p className="truncate text-sm font-extrabold text-green-950 dark:text-white">{p.officer_name ?? 'Officer'}</p><p className="text-[11px] text-green-500 dark:text-night-300">{formatDateTime(p.requested_at)}</p></div>
              <p className="shrink-0 text-lg font-extrabold text-green-800 dark:text-green-300">{formatNaira(p.amount_kobo)}</p>
            </div>
            <div className="mt-3 rounded-xl bg-green-50 p-3 text-xs dark:bg-night-600">
              <p className="font-bold text-green-950 dark:text-white">{p.account_name}</p>
              <p className="text-green-700 dark:text-night-200">{p.bank_name}</p>
              <button onClick={() => copy(p.account_number)} className="mt-1 flex items-center gap-1.5 font-mono text-sm font-bold text-green-900 dark:text-white">{p.account_number}<Copy className="h-3.5 w-3.5" /></button>
            </div>
            {p.status === 'pending' && (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button onClick={() => { setRejecting(p); setReason('') }} className="flex items-center justify-center gap-1 rounded-xl border-2 border-red-200 py-2.5 text-xs font-bold text-red-600 dark:border-red-900 dark:text-red-300"><X className="h-4 w-4" />Reject</button>
                <button disabled={paid.isPending} onClick={async () => { if (await ask(`Pay ${formatNaira(p.amount_kobo)} to ${p.account_name} (${p.bank_name} ${p.account_number}) first, then confirm.`, { title: 'Have you sent the money?', confirmLabel: 'Yes, mark paid' })) paid.mutate(p.id) }} className="flex items-center justify-center gap-1 rounded-xl bg-green-700 py-2.5 text-xs font-bold text-white disabled:opacity-50"><Check className="h-4 w-4" />Mark paid</button>
              </div>
            )}
            {p.status === 'rejected' && p.rejection_reason && <p className="mt-2 text-xs text-red-600 dark:text-red-300">Reason: {p.rejection_reason}</p>}
            {p.status === 'paid' && p.processed_at && <p className="mt-2 text-xs text-green-600 dark:text-green-300">Paid {formatDateTime(p.processed_at)}</p>}
          </div>
        ))}
      </div>
      <DirectorModal open={!!rejecting} title="Reject payout" onClose={() => setRejecting(null)} busy={reject.isPending}>
        <div className="space-y-3">
          <p className="text-sm text-green-800 dark:text-night-100">{rejecting?.officer_name} is told why, and the money goes back to their earnings.</p>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Reason (required)" className="w-full rounded-xl border border-green-200 bg-white px-3 py-2.5 text-sm text-green-950 dark:border-night-500 dark:bg-night-800 dark:text-white" />
          {reject.isError && <Notice kind="error">{getErrorMessage(reject.error)}</Notice>}
          <ActionButton tone="red" busy={reject.isPending} disabled={reason.trim().length < 3} onClick={() => reject.mutate()}>Reject payout</ActionButton>
        </div>
      </DirectorModal>
    </div>
  )
}
