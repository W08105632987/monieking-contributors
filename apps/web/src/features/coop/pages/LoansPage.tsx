import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Calculator, Coins, Plus } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { formatNaira } from '@/lib/utils'
import { useCoopStatus, useLoans } from '../api'
import { Bar, BigButton, Card, CoopPage, Empty, Field, MoneyInput, Pill, SectionTitle, Skel, dShort, loanTone, toKobo } from '../ui'

export function LoanCalculator() {
  const { data: s } = useCoopStatus()
  const [amt, setAmt] = useState('100000')
  const [term, setTerm] = useState(3)
  const k = toKobo(amt)
  const max = s?.rules?.loan_term_months ?? 6
  const { data } = useQuery({
    queryKey: ['coop', 'calc', k, term], enabled: k > 0,
    queryFn: async () => (await api.get('/coop/loans/preview', { params: { amount_kobo: k, term_months: term } })).data,
    placeholderData: (p) => p,
  })
  return (
    <Card>
      <div className="mb-3 flex items-center gap-2"><Calculator className="h-5 w-5 text-green-600" /><p className="font-bold text-green-900 dark:text-white">Loan calculator</p></div>
      <Field label="How much?"><MoneyInput value={amt} onChange={setAmt} /></Field>
      <p className="mb-1 mt-3 text-xs font-bold text-green-800 dark:text-night-100">For how long?</p>
      <div className="flex gap-2">{Array.from({ length: max }, (_, i) => i + 1).map((n) => (
        <button key={n} onClick={() => setTerm(n)} className={`flex-1 rounded-xl py-2 text-sm font-bold ${term === n ? 'bg-green-700 text-white dark:bg-green-600' : 'border border-green-200 text-green-800 dark:border-night-400 dark:text-night-100'}`}>{n}m</button>))}</div>
      {data && (
        <div className="mt-4 space-y-1.5 rounded-xl bg-green-100/70 p-3 text-sm dark:bg-night-600">
          <div className="flex justify-between"><span>Monthly payment</span><b>{formatNaira(data.instalment_kobo)}</b></div>
          <div className="flex justify-between"><span>Interest (always paid in full)</span><b>{formatNaira(data.interest_kobo)}</b></div>
          <div className="flex justify-between"><span>Total to repay</span><b>{formatNaira(data.total_kobo)}</b></div>
          <div className="flex justify-between"><span>Guarantees needed</span><b>{formatNaira(data.cover_needed_kobo)}</b></div>
        </div>
      )}
    </Card>
  )
}

export default function LoansPage() {
  const nav = useNavigate()
  const { data: loans, isLoading } = useLoans()
  const hasActive = loans?.some((l) => ['seeking_guarantors', 'awaiting_approval', 'repaying'].includes(l.status))
  return (
    <CoopPage title="Loans" subtitle="Request, track and repay">
      {!hasActive && <div className="mb-3"><BigButton onClick={() => nav('/coop/loans/new')}><Plus className="h-4 w-4" />Request a loan</BigButton></div>}
      {isLoading ? <Skel /> : !loans?.length ? (
        <Empty icon={<Coins className="h-7 w-7" />} title="No loans yet" text="When you request a loan you can follow every step here." />
      ) : (
        <div className="space-y-2">
          {loans.map((l) => { const t = loanTone(l.status); return (
            <Card key={l.id} onClick={() => nav(`/coop/loans/${l.id}`)}>
              <div className="flex items-start justify-between"><div><p className="text-xs font-semibold text-green-500 dark:text-night-300">{l.loan_no} · {dShort(l.created_at)}</p>
                <p className="text-lg font-extrabold text-green-900 dark:text-white">{formatNaira(l.principal_kobo)}</p></div><Pill tone={t.tone}>{t.label}</Pill></div>
              {l.status === 'seeking_guarantors' && <div className="mt-2"><Bar value={l.guaranteed_kobo} max={l.cover_needed_kobo} tone="amber" /></div>}
              {l.status === 'repaying' && <p className="mt-1 text-sm text-green-700 dark:text-night-200">Still to pay {formatNaira(l.total_due_kobo)}{l.overdue && <b className="ml-2 text-red-600">Overdue</b>}</p>}
              {l.decision_note && <p className="mt-1 text-xs text-green-600 dark:text-night-300">{l.decision_note}</p>}
            </Card>) })}
        </div>
      )}
      <SectionTitle>Before you ask</SectionTitle>
      <LoanCalculator />
    </CoopPage>
  )
}
