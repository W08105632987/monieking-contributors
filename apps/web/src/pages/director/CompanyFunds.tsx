import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, Info } from 'lucide-react'
import toast from '@/lib/notify'
import { api, getErrorMessage } from '@/lib/api'
import { formatNaira } from '@/lib/utils'
import { Period, parseAmount, ymd } from '@/lib/accounting'

const card = 'rounded-2xl border border-green-100 bg-white p-4 shadow-card dark:border-night-500 dark:bg-night-700'
const input = 'w-full rounded-xl border border-green-200 bg-white px-3 py-2 text-sm text-green-950 outline-none focus:border-green-500 dark:border-night-500 dark:bg-night-600 dark:text-white'
const btn = 'rounded-xl bg-green-600 px-4 py-2 text-sm font-bold text-white transition-transform active:scale-95 disabled:opacity-50'
const btn2 = 'rounded-xl bg-green-100 px-3 py-2 text-xs font-bold text-green-800 disabled:opacity-50 dark:bg-night-600 dark:text-white'
const money = (k: number | null | undefined) => (k == null ? '—' : formatNaira(k))
const signed = (k: number) => (k > 0 ? '+ ' : k < 0 ? '− ' : '') + formatNaira(Math.abs(k))
const h = 'text-sm font-extrabold text-green-950 dark:text-white'
const sub = 'text-[11px] text-green-600 dark:text-night-300'

interface Account { kobo: number | null; expected_kobo?: number | null; ok: boolean; label: string; auto: boolean; source: string; counted_at?: string | null; movement?: { in: number; out: number; manual_funding: number } | null }
interface Closing { day: string; closed_at: string; auto_closed: boolean; opening_capital_kobo: number; profit_kobo: number; closing_capital_kobo: number; obligations_kobo: number; expected_total_kobo: number; actual_total_kobo: number; difference_kobo: number; note: string | null }
interface Overview {
  start: string; end: string; as_of: string; needs_baseline: boolean; opening_origin: string | null
  opening_capital_kobo: number | null; closing_capital_kobo: number | null
  flows: { profit: number; revenue: number; provider_cost: number; expenses: number; other_income: number; injections: number; drawings: number; goodwill: number; fees: number }
  obligations: { wallets: number; pending_payouts: number; jobs: number; jobs_count: number; owed: number; total: number }
  expected_total_kobo: number | null; actual_total_kobo: number; difference_kobo: number; complete: boolean; unreadable_accounts: string[]
  accounts: Record<string, Account>
  settlement: { pending_kobo: number; pending_count: number; due_today_kobo: number; due_today_count: number; late_kobo: number; late_count: number; settlement_days: number; includes_due_today: boolean; unknown_fee_count: number; note: string }
  money_in: { monnify_funding_kobo: number; monnify_fees_kobo: number; monnify_count: number; manual_funding_kobo: number; manual_funding_count: number }
  closings: Closing[]; last_closed: string | null
  questions: { level: 'critical' | 'warning' | 'info'; text: string }[]
}
interface Meta { accounts: { key: string; label: string; auto: boolean }[]; kinds: Record<string, string>; auto_close_enabled: boolean; auto_close_time: string }
interface Transfer { id: string; occurred_on: string; kind: string; kind_label: string; from: string | null; to: string | null; amount_kobo: number; fee_kobo: number; reference: string | null; note: string | null; voided: boolean; void_reason: string | null }

function Row({ label, value, strong = false, note }: { label: string; value: string; strong?: boolean; note?: string }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 py-1.5 ${strong ? 'border-t border-green-200 font-extrabold dark:border-night-400' : ''}`}>
      <div className="min-w-0"><p className="text-xs text-green-900 dark:text-night-100">{label}</p>{note && <p className={sub}>{note}</p>}</div>
      <p className="shrink-0 text-sm tabular-nums text-green-950 dark:text-white">{value}</p>
    </div>
  )
}

export default function CompanyFunds({ period }: { period: Period }) {
  const qc = useQueryClient()
  const [dueToday, setDueToday] = useState(false)
  const key = ['funds-overview', period.start, period.end, dueToday]
  const { data, isError, error } = useQuery({ queryKey: key, queryFn: async () => (await api.get<Overview>('/director/funds/overview', { params: { start: period.start, end: period.end, include_due_today: dueToday } })).data })
  const { data: meta } = useQuery({ queryKey: ['funds-meta'], queryFn: async () => (await api.get<Meta>('/director/funds/meta')).data })
  const { data: transfers } = useQuery({ queryKey: ['funds-transfers', period.start, period.end], queryFn: async () => (await api.get<{ items: Transfer[] }>('/director/funds/transfers', { params: { start: period.start, end: period.end } })).data.items })
  const refresh = () => { qc.invalidateQueries({ queryKey: ['funds-overview'] }); qc.invalidateQueries({ queryKey: ['funds-transfers'] }); qc.invalidateQueries({ queryKey: ['funds-meta'] }) }
  const fail = (e: unknown) => toast.error(getErrorMessage(e))

  const [base, setBase] = useState({ capital: '', as_of: ymd(new Date()) })
  const setBaseline = useMutation({ mutationFn: () => api.put('/director/funds/baseline', { capital_naira: parseAmount(base.capital) ?? 0, as_of: base.as_of }), onSuccess: () => { refresh(); toast.success('Opening capital saved') }, onError: fail })

  const [count, setCount] = useState<Record<string, string>>({})
  const countAcc = useMutation({ mutationFn: (acc: string) => api.put(`/director/funds/accounts/${acc}`, { balance_naira: parseAmount(count[acc] ?? '') ?? 0 }), onSuccess: (_r, acc) => { setCount((c) => ({ ...c, [acc]: '' })); refresh(); toast.success('Balance saved') }, onError: fail })

  const [closeDay, setCloseDay] = useState(ymd(new Date())); const [closeNote, setCloseNote] = useState('')
  const close = useMutation({ mutationFn: () => api.post('/director/funds/close', { day: closeDay, note: closeNote || null, include_due_today: dueToday }), onSuccess: () => { setCloseNote(''); refresh(); toast.success('Day closed') }, onError: fail })
  const reopen = useMutation({ mutationFn: (day: string) => api.post('/director/funds/reopen', { day }), onSuccess: () => { refresh(); toast.success('Day re-opened') }, onError: fail })

  const [auto, setAuto] = useState<{ enabled: boolean; time: string } | null>(null)
  const autoNow = auto ?? (meta ? { enabled: meta.auto_close_enabled, time: meta.auto_close_time } : null)
  const saveAuto = useMutation({ mutationFn: (v: { enabled: boolean; time: string }) => api.put('/director/funds/auto-close', v), onSuccess: (_r, v) => { setAuto(v); refresh(); toast.success(v.enabled ? `Auto-close on at ${v.time}` : 'Auto-close off') }, onError: fail })

  const blank = { occurred_on: ymd(new Date()), kind: 'transfer', from_account: 'central', to_account: 'monnify_wallet', amount: '', fee: '', reference: '', note: '' }
  const [tf, setTf] = useState(blank)
  const addTf = useMutation({
    mutationFn: () => api.post('/director/funds/transfers', { occurred_on: tf.occurred_on, kind: tf.kind, from_account: tf.kind === 'injection' ? null : tf.from_account, to_account: tf.kind === 'transfer' || tf.kind === 'injection' ? tf.to_account : null, amount_naira: parseAmount(tf.amount) ?? 0, fee_naira: parseAmount(tf.fee) ?? 0, reference: tf.reference || null, note: tf.note || null }),
    onSuccess: () => { setTf({ ...blank, kind: tf.kind, from_account: tf.from_account, to_account: tf.to_account }); refresh(); toast.success('Logged') }, onError: fail,
  })
  const voidTf = useMutation({ mutationFn: (v: { id: string; reason: string }) => api.post(`/director/funds/transfers/${v.id}/void`, { reason: v.reason }), onSuccess: () => { refresh(); toast.success('Voided') }, onError: fail })

  if (isError) return <p className="py-10 text-center text-sm text-red-600">{getErrorMessage(error)}</p>
  if (!data) return <p className="py-10 text-center text-sm text-green-600">Loading…</p>
  const accLabel = (k: string | null) => (k && meta?.accounts.find((a) => a.key === k)?.label) || k || '—'
  const balanced = data.expected_total_kobo != null && data.complete && Math.abs(data.difference_kobo) < 100
  const f = data.flows
  const mustCount = (k: string) => !data.accounts[k]?.auto

  return (
    <div className="space-y-4">
      <div className={card}>
        <p className={h}>Company funds balance</p>
        <p className={`${sub} mt-1`}>{period.start === period.end ? period.start : `${period.start} to ${period.end}`} (follows the period you picked above). Capital plus what the company holds for others should equal what the accounts really hold. Any gap is money to question.</p>
        <p className={`${sub} mt-1`}>Position measured: {data.as_of}.{' '}<Link to="/director/monnify" className="font-bold underline">Open Monnify center</Link></p>
      </div>

      {data.needs_baseline && (
        <div className={`${card} border-amber-300`}>
          <p className={h}>First, tell the system the company's capital</p>
          <p className={`${sub} mb-2`}>One time only: how much the company owned (its own money, not customers') at the start of the day you pick. Every day after that is worked out from it. If you are unsure, use total money in all accounts minus what is owed to customers, workers and officers.</p>
          <div className="grid grid-cols-2 gap-2">
            <input className={input} inputMode="decimal" placeholder="Capital in ₦" value={base.capital} onChange={(e) => setBase({ ...base, capital: e.target.value })} />
            <input type="date" className={input} value={base.as_of} max={ymd(new Date())} onChange={(e) => setBase({ ...base, as_of: e.target.value })} aria-label="Capital as of the start of" />
          </div>
          <button className={`${btn} mt-2`} disabled={parseAmount(base.capital) === null || setBaseline.isPending} onClick={() => setBaseline.mutate()}>Save opening capital</button>
        </div>
      )}

      {!data.needs_baseline && (
        <div className={`${card} ${balanced ? 'border-green-400' : data.complete ? 'border-red-400' : 'border-amber-400'}`}>
          <div className="mb-2 flex items-center gap-2">
            {balanced ? <CheckCircle2 className="h-5 w-5 text-green-600" /> : <AlertTriangle className={`h-5 w-5 ${data.complete ? 'text-red-600' : 'text-amber-600'}`} />}
            <p className={h}>{balanced ? 'Balanced: every naira is accounted for' : data.complete ? `${data.difference_kobo < 0 ? 'Missing' : 'Extra'} ${money(Math.abs(data.difference_kobo))}` : 'Cannot be fully checked yet'}</p>
          </div>
          <p className={`${sub} mb-2`}>Opening capital comes from {data.opening_origin}.</p>
          <Row label="Opening capital" value={money(data.opening_capital_kobo)} />
          <Row label="Profit in the period" value={signed(f.profit)} note={`Revenue ${money(f.revenue)} − provider costs ${money(f.provider_cost)} − expenses ${money(f.expenses)} + other income ${money(f.other_income)}`} />
          {f.injections > 0 && <Row label="Money put into the company" value={signed(f.injections)} />}
          {f.drawings > 0 && <Row label="Money taken out (drawings)" value={signed(-f.drawings)} />}
          {f.goodwill > 0 && <Row label="Goodwill credits to customers" value={signed(-f.goodwill)} note="credited without money received" />}
          {f.fees > 0 && <Row label="Transfer fees" value={signed(-f.fees)} />}
          <Row strong label="Closing capital" value={money(data.closing_capital_kobo)} />
          <Row label="Customer wallets" value={money(data.obligations.wallets)} note="owed to wallet holders" />
          <Row label="Withdrawals waiting" value={money(data.obligations.pending_payouts)} />
          <Row label="Held for jobs in progress" value={money(data.obligations.jobs)} note={`${data.obligations.jobs_count} jobs paid for, not finished`} />
          <Row label="Commissions owed" value={money(data.obligations.owed)} note="workers and officers not yet paid" />
          <Row strong label="Total the company should hold" value={money(data.expected_total_kobo)} />
          <Row strong label="Total the accounts really hold" value={money(data.actual_total_kobo)} />
          <Row strong label="Difference" value={data.complete ? signed(data.difference_kobo) : 'not reliable'} note={data.complete ? undefined : 'an account could not be read or was never counted'} />
        </div>
      )}

      {data.questions.length > 0 && (
        <div className={card}>
          <p className={`${h} mb-2`}>Questions for the directors</p>
          <ul className="space-y-2">
            {data.questions.map((q, i) => (
              <li key={i} className={`flex gap-2 rounded-xl p-2 text-xs ${q.level === 'critical' ? 'bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-200' : q.level === 'warning' ? 'bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200' : 'bg-green-50 text-green-900 dark:bg-night-600 dark:text-night-100'}`}>
                {q.level === 'info' ? <Info className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}<span>{q.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className={card}>
        <p className={`${h} mb-1`}>Where the money sits</p>
        <p className={`${sub} mb-2`}>Monnify and GYKDATASUB are read live. The central account and other funds are what a director counted; the app cannot see them.</p>
        {Object.entries(data.accounts).map(([k, a]) => (
          <div key={k} className="border-t border-green-100 py-2 first:border-0 dark:border-night-500">
            <Row label={a.label} value={a.ok ? money(a.kobo) : 'unavailable'} note={a.source + (a.counted_at ? ` · counted ${a.counted_at.slice(0, 16).replace('T', ' ')}` : '')} />
            {mustCount(k) && a.expected_kobo != null && a.movement && (a.movement.in > 0 || a.movement.out > 0 || a.movement.manual_funding > 0) && (
              <p className={sub}>Should now hold {money(a.expected_kobo)} (counted + {money(a.movement.manual_funding)} manual funding + {money(a.movement.in)} logged in − {money(a.movement.out)} logged out).</p>
            )}
            {mustCount(k) && (
              <div className="mt-1 flex gap-2">
                <input className={input} inputMode="decimal" placeholder="Count it now: balance in ₦" value={count[k] ?? ''} onChange={(e) => setCount({ ...count, [k]: e.target.value })} />
                <button className={btn2} disabled={parseAmount(count[k] ?? '') === null || countAcc.isPending} onClick={() => countAcc.mutate(k)}>Save count</button>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className={card}>
        <p className={`${h} mb-1`}>Monnify settlement</p>
        <Row label="Pending (still to arrive in the Monnify wallet)" value={money(data.settlement.pending_kobo)} note={`${data.settlement.pending_count} payments, ${data.settlement.settlement_days} business day(s) to settle`} />
        <Row label="Due from Monnify today" value={money(data.settlement.due_today_kobo)} note={`${data.settlement.due_today_count} payments`} />
        <Row label="Late (past the settlement day)" value={money(data.settlement.late_kobo)} note={`${data.settlement.late_count} payments, not counted as pending`} />
        <label className="mt-2 flex items-center gap-2 text-xs text-green-900 dark:text-night-100"><input type="checkbox" checked={dueToday} onChange={(e) => setDueToday(e.target.checked)} />Treat today's settlements as pending (tick if they have not reached the Monnify wallet yet)</label>
        <p className={`${sub} mt-1`}>{data.settlement.note}</p>
      </div>

      <div className={card}>
        <p className={`${h} mb-1`}>Money received in the period</p>
        <Row label="Monnify payments (customers funding wallets)" value={money(data.money_in.monnify_funding_kobo)} note={`${data.money_in.monnify_count} payments; Monnify kept ${money(data.money_in.monnify_fees_kobo)}`} />
        <Row label="Manual funding (sent to the central account)" value={money(data.money_in.manual_funding_kobo)} note={`${data.money_in.manual_funding_count} wallet credits by directors: this money should be in the central account`} />
      </div>

      <div className={card}>
        <p className={`${h} mb-1`}>Close the day</p>
        <p className={`${sub} mb-2`}>Closing saves the day's figures and makes its closing capital the next day's opening. Entries dated on or before a closed day are locked. {data.last_closed ? `Last closed day: ${data.last_closed}.` : 'No day has been closed yet.'}</p>
        <div className="grid grid-cols-2 gap-2">
          <input type="date" className={input} value={closeDay} max={ymd(new Date())} onChange={(e) => setCloseDay(e.target.value)} aria-label="Day to close" />
          <input className={input} placeholder="Note (optional)" maxLength={300} value={closeNote} onChange={(e) => setCloseNote(e.target.value)} />
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <button className={btn} disabled={close.isPending || data.needs_baseline} onClick={() => close.mutate()}>Close this day</button>
          {data.last_closed && <button className={btn2} disabled={reopen.isPending} onClick={() => { if (window.confirm(`Re-open ${data.last_closed}? Its saved figures are removed and it can be closed again.`)) reopen.mutate(data.last_closed as string) }}>Re-open {data.last_closed}</button>}
        </div>
        {autoNow && (
          <div className="mt-3 rounded-xl bg-green-50 p-3 dark:bg-night-600">
            <label className="flex items-center gap-2 text-xs font-bold text-green-900 dark:text-white"><input type="checkbox" checked={autoNow.enabled} onChange={(e) => saveAuto.mutate({ ...autoNow, enabled: e.target.checked })} />Close each day automatically</label>
            <div className="mt-2 flex items-center gap-2"><span className="text-xs text-green-700 dark:text-night-200">at (Nigeria time)</span><input type="time" className={`${input} max-w-[8rem]`} value={autoNow.time} onChange={(e) => setAuto({ ...autoNow, time: e.target.value })} /><button className={btn2} disabled={saveAuto.isPending} onClick={() => saveAuto.mutate(autoNow)}>Save time</button></div>
            <p className={`${sub} mt-1`}>Auto-close uses the last balances a director counted, so count the central account before that time.</p>
          </div>
        )}
        {data.closings.length > 0 && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-[11px]"><thead className="text-green-600 dark:text-night-300"><tr><th className="py-1 pr-2">Day</th><th className="pr-2">Closing capital</th><th className="pr-2">Should hold</th><th className="pr-2">Held</th><th>Difference</th></tr></thead>
              <tbody>{data.closings.map((c) => (
                <tr key={c.day} className="border-t border-green-100 dark:border-night-500"><td className="py-1 pr-2">{c.day}{c.auto_closed ? ' (auto)' : ''}</td><td className="pr-2">{money(c.closing_capital_kobo)}</td><td className="pr-2">{money(c.expected_total_kobo)}</td><td className="pr-2">{money(c.actual_total_kobo)}</td>
                  <td className={Math.abs(c.difference_kobo) >= 100 ? 'font-bold text-red-600' : 'text-green-700'}>{Math.abs(c.difference_kobo) < 100 ? 'balanced' : signed(c.difference_kobo)}</td></tr>))}</tbody></table>
          </div>
        )}
      </div>

      <div className={card}>
        <p className={`${h} mb-1`}>Transfer log</p>
        <p className={`${sub} mb-2`}>Record every time money moves between our accounts, comes in from outside, leaves the company, or is credited to a customer without payment. An entry is never edited: if it is wrong, void it with a reason and enter it again.</p>
        <div className="grid grid-cols-2 gap-2">
          <select className={input} value={tf.kind} onChange={(e) => setTf({ ...tf, kind: e.target.value })} aria-label="Kind">{Object.entries(meta?.kinds ?? {}).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <input type="date" className={input} value={tf.occurred_on} max={ymd(new Date())} onChange={(e) => setTf({ ...tf, occurred_on: e.target.value })} aria-label="Date" />
          {tf.kind !== 'injection' && <select className={input} value={tf.from_account} onChange={(e) => setTf({ ...tf, from_account: e.target.value })} aria-label="From">{(meta?.accounts ?? []).filter((a) => a.key !== 'monnify_pending').map((a) => <option key={a.key} value={a.key}>{tf.kind === 'transfer' ? 'From: ' : tf.kind === 'goodwill' ? 'Money was expected in: ' : 'Out of: '}{a.label}</option>)}</select>}
          {(tf.kind === 'transfer' || tf.kind === 'injection') && <select className={input} value={tf.to_account} onChange={(e) => setTf({ ...tf, to_account: e.target.value })} aria-label="To">{(meta?.accounts ?? []).filter((a) => a.key !== 'monnify_pending').map((a) => <option key={a.key} value={a.key}>To: {a.label}</option>)}</select>}
          <input className={input} inputMode="decimal" placeholder="Amount in ₦" value={tf.amount} onChange={(e) => setTf({ ...tf, amount: e.target.value })} />
          <input className={input} inputMode="decimal" placeholder="Fee charged in ₦ (if any)" value={tf.fee} onChange={(e) => setTf({ ...tf, fee: e.target.value })} />
          <input className={input} placeholder="Bank reference (optional)" maxLength={120} value={tf.reference} onChange={(e) => setTf({ ...tf, reference: e.target.value })} />
          <input className={input} placeholder="Note (optional)" maxLength={300} value={tf.note} onChange={(e) => setTf({ ...tf, note: e.target.value })} />
        </div>
        <button className={`${btn} mt-2`} disabled={parseAmount(tf.amount) === null || addTf.isPending} onClick={() => addTf.mutate()}>Add to the log</button>
        <div className="mt-3 space-y-1">
          {(transfers ?? []).map((t) => (
            <div key={t.id} className={`rounded-xl bg-green-50 p-2 text-xs dark:bg-night-600 ${t.voided ? 'opacity-50 line-through' : ''}`}>
              <div className="flex justify-between gap-2"><span className="font-bold text-green-950 dark:text-white">{t.occurred_on} · {t.kind_label}</span><span className="tabular-nums">{money(t.amount_kobo)}</span></div>
              <p className={sub}>{t.kind === 'transfer' ? `${accLabel(t.from)} → ${accLabel(t.to)}` : t.kind === 'injection' ? `into ${accLabel(t.to)}` : t.kind === 'drawing' ? `out of ${accLabel(t.from)}` : 'credited without payment'}{t.fee_kobo ? ` · fee ${money(t.fee_kobo)}` : ''}{t.reference ? ` · ref ${t.reference}` : ''}{t.note ? ` · ${t.note}` : ''}{t.void_reason ? ` · voided: ${t.void_reason}` : ''}</p>
              {!t.voided && <button className="mt-1 text-[11px] font-bold text-red-600" onClick={() => { const reason = window.prompt('Why is this entry being voided?'); if (reason && reason.trim().length >= 3) voidTf.mutate({ id: t.id, reason: reason.trim() }) }}>Void</button>}
            </div>
          ))}
          {transfers && transfers.length === 0 && <p className={sub}>Nothing logged in this period.</p>}
        </div>
      </div>
    </div>
  )
}
