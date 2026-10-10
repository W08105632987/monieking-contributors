import { useState } from 'react'
import { AlertTriangle, Check, X } from 'lucide-react'
import { formatNaira } from '@/lib/utils'
import { post, useCoopAction } from '../api'
import { Bar, BigButton, Card, Empty, Pill, SectionTitle, Sheet, Skel, dShort, inputCls, loanTone, pctText } from '../ui'
import { useAdmin } from './dapi'

const FLAG: Record<string, string> = { above_first_loan_limit: 'Above the first-loan limit', nin_not_linked: 'Joined without a linked NIN' }

export default function ApprovalsTab() {
  const [status, setStatus] = useState('awaiting_approval')
  const { data } = useAdmin<any[]>('loans', '/coop/admin/loans', { status: status || undefined })
  const [rej, setRej] = useState<any>(null)
  const [note, setNote] = useState('')
  const vote = useCoopAction((v: { id: string; decision: string; note?: string }) => post(`/coop/admin/loans/${v.id}/decision`, { decision: v.decision, note: v.note }), {
    success: 'Vote recorded', onSuccess: () => { setRej(null); setNote('') },
  })
  const filters = [['awaiting_approval', 'To approve'], ['repaying', 'Repaying'], ['seeking_guarantors', 'Seeking guarantors'], ['', 'All']]
  return (
    <>
      <div className="no-scrollbar -mx-4 mb-3 flex gap-2 overflow-x-auto px-4">{filters.map(([k, l]) => <button key={k} onClick={() => setStatus(k)} className={`flex-shrink-0 rounded-full px-3 py-1.5 text-xs font-bold ${status === k ? 'bg-green-700 text-white' : 'border border-green-200 bg-white text-green-800 dark:border-night-400 dark:bg-night-700 dark:text-night-100'}`}>{l}</button>)}</div>
      {!data ? <Skel h="h-40" /> : !data.length ? <Empty icon={<Check className="h-7 w-7" />} title="Nothing here" text="No loans in this stage." /> : (
        <div className="space-y-3">{data.map((l) => { const t = loanTone(l.status); return (
          <Card key={l.id}>
            <div className="flex items-start justify-between"><div><p className="text-xs font-semibold text-green-500 dark:text-night-300">{l.loan_no} · {dShort(l.created_at)}</p><p className="text-2xl font-extrabold text-green-900 dark:text-white">{formatNaira(l.principal_kobo)}</p>
              <p className="text-xs text-green-700 dark:text-night-200">{l.term_months} months · {pctText(l.rate_bps)} · total {formatNaira(l.total_kobo)}</p></div><Pill tone={t.tone}>{t.label}</Pill></div>
            {l.purpose && <p className="mt-1 text-sm italic text-green-700 dark:text-night-200">"{l.purpose}"</p>}
            <div className="mt-3 rounded-xl bg-green-100/70 p-3 text-sm dark:bg-night-600">
              <p className="font-bold text-green-900 dark:text-white">{l.borrower.name} <span className="font-normal text-green-600">· {l.borrower.card_no} · {l.borrower.phone}</span></p>
              <p className="text-green-700 dark:text-night-200">Member {l.borrower.months_member} months · {l.borrower.loans_taken} loans · {l.borrower.reliability_pct === null ? 'no history' : `${l.borrower.reliability_pct}% on time`} · holds {formatNaira(l.borrower.contribution_kobo)}</p></div>
            {l.flags.map((f: string) => <p key={f} className="mt-2 flex items-center gap-1.5 text-xs font-bold text-amber-700 dark:text-amber-300"><AlertTriangle className="h-3.5 w-3.5" />{FLAG[f] ?? f}</p>)}
            <div className="mt-3"><div className="mb-1 flex justify-between text-xs font-semibold text-green-800 dark:text-night-100"><span>Guaranteed {formatNaira(l.guaranteed_kobo)}</span><span>needed {formatNaira(l.cover_needed_kobo)}</span></div><Bar value={l.guaranteed_kobo} max={l.cover_needed_kobo} tone="amber" />
              <div className="mt-2 space-y-1">{l.guarantors.map((g: any) => <p key={g.member_id} className="flex justify-between text-xs text-green-800 dark:text-night-100"><span>{g.name}</span><span>{formatNaira(g.amount_kobo)} · {g.status}</span></p>)}</div></div>
            {l.status === 'repaying' && <p className="mt-2 text-sm text-green-800 dark:text-night-100">Still owed {formatNaira(l.total_due_kobo)}{l.overdue_days > 0 && <b className="ml-2 text-red-600">{l.overdue_days} days overdue · charge {formatNaira(l.accrued_charge_kobo)} accrued</b>}</p>}
            {l.decision_note && <p className="mt-2 text-xs text-green-600 dark:text-night-300">{l.decision_note}</p>}
            {l.status === 'awaiting_approval' && (
              <div className="mt-3">
                <p className="mb-2 text-xs font-bold text-green-700 dark:text-night-200">{l.approvals} of {l.approvals_required} approvals{l.you_voted ? ' · you have voted' : ''}</p>
                {!l.you_voted && <div className="grid grid-cols-2 gap-2"><BigButton loading={vote.isPending} onClick={() => vote.mutate({ id: l.id, decision: 'approve' })}><Check className="h-4 w-4" />Approve</BigButton><BigButton tone="ghost" onClick={() => setRej(l)}><X className="h-4 w-4" />Reject</BigButton></div>}
              </div>)}
          </Card>) })}</div>)}
      <Sheet open={!!rej} onClose={() => setRej(null)} title={`Reject ${rej?.loan_no ?? ''}`}>
        <p className="mb-2 text-sm text-green-700 dark:text-night-200">The borrower and guarantors are told. Locked guarantees are released straight away. A reason is required and kept in the record.</p>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={300} className={inputCls} placeholder="Reason" />
        <div className="mt-3"><BigButton tone="red" disabled={!note.trim()} loading={vote.isPending} onClick={() => vote.mutate({ id: rej.id, decision: 'reject', note })}>Reject loan</BigButton></div>
      </Sheet>
      <SectionTitle>{''}</SectionTitle>
    </>
  )
}
