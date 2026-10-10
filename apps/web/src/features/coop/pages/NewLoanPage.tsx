import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { formatNaira } from '@/lib/utils'
import { post, useCoopAction, useCoopStatus } from '../api'
import { BigButton, Card, CoopPage, Field, MoneyInput, inputCls, pctText, toKobo } from '../ui'

export default function NewLoanPage() {
  const nav = useNavigate()
  const { data: s } = useCoopStatus()
  const r = s?.rules
  const [amt, setAmt] = useState('')
  const [term, setTerm] = useState(3)
  const [purpose, setPurpose] = useState('')
  const k = toKobo(amt)
  const { data: pv } = useQuery({
    queryKey: ['coop', 'newloan-preview', k, term], enabled: k > 0,
    queryFn: async () => (await api.get('/coop/loans/preview', { params: { amount_kobo: k, term_months: term } })).data,
    placeholderData: (p) => p, retry: false,
  })
  const create = useCoopAction((v: any) => post('/coop/loans', v), { success: 'Loan request created', onSuccess: (l) => nav(`/coop/loans/${l.id}`, { replace: true }) })
  if (!r) return <CoopPage title="Request a loan" back="/coop/loans"><div /></CoopPage>
  const ok = k >= r.loan_min_kobo && k <= r.loan_max_kobo
  return (
    <CoopPage title="Request a loan" back="/coop/loans">
      <div className="space-y-4">
        <Field label="How much do you need?" hint={`Between ${formatNaira(r.loan_min_kobo)} and ${formatNaira(r.loan_max_kobo)}`}><MoneyInput value={amt} onChange={setAmt} autoFocus /></Field>
        <div>
          <p className="mb-1 text-xs font-bold text-green-800 dark:text-night-100">Repay over</p>
          <div className="flex gap-2">{Array.from({ length: r.loan_term_months }, (_, i) => i + 1).map((n) => (
            <button key={n} onClick={() => setTerm(n)} className={`flex-1 rounded-xl py-2.5 text-sm font-bold ${term === n ? 'bg-green-700 text-white dark:bg-green-600' : 'border border-green-200 bg-white text-green-800 dark:border-night-400 dark:bg-night-700 dark:text-night-100'}`}>{n} month{n > 1 ? 's' : ''}</button>))}</div>
        </div>
        <Field label="What is it for? (optional)"><input value={purpose} onChange={(e) => setPurpose(e.target.value)} maxLength={200} className={inputCls} placeholder="e.g. Stock for my shop" /></Field>
        {pv && ok && (
          <Card>
            <p className="mb-2 text-sm font-bold text-green-900 dark:text-white">What this means</p>
            <div className="space-y-1.5 text-sm text-green-800 dark:text-night-100">
              <div className="flex justify-between"><span>Monthly payment</span><b>{formatNaira(pv.instalment_kobo)}</b></div>
              <div className="flex justify-between"><span>Interest ({pctText(r.loan_rate_bps)}, paid in full)</span><b>{formatNaira(pv.interest_kobo)}</b></div>
              <div className="flex justify-between"><span>Total to repay</span><b>{formatNaira(pv.total_kobo)}</b></div>
              <div className="flex justify-between border-t border-green-100 pt-1.5 dark:border-night-500"><span>Guarantees you will need</span><b>{formatNaira(pv.cover_needed_kobo)}</b></div>
            </div>
            <p className="mt-2 text-xs text-green-600 dark:text-night-300">Your own money does not count as a guarantee. Two directors must approve, even when fully guaranteed. The request stays open {r.loan_request_expiry_days} days.</p>
          </Card>
        )}
        <BigButton loading={create.isPending} disabled={!ok} onClick={() => create.mutate({ amount_kobo: k, term_months: term, purpose })}>Create request</BigButton>
      </div>
    </CoopPage>
  )
}
