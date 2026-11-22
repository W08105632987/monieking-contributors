import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ArrowLeft, CheckCircle2 } from 'lucide-react'
import toast from '@/lib/notify'
import { api, getErrorMessage } from '@/lib/api'
import { formatNaira } from '@/lib/utils'
import { Period, parseAmount, presetPeriod, ymd } from '@/lib/accounting'

const card = 'rounded-2xl border border-green-100 bg-white p-4 shadow-card dark:border-night-500 dark:bg-night-700'
const input = 'w-full rounded-xl border border-green-200 bg-white px-3 py-2 text-sm text-green-950 outline-none focus:border-green-500 dark:border-night-500 dark:bg-night-600 dark:text-white'
const btn = 'rounded-xl bg-green-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50'
const h = 'text-sm font-extrabold text-green-950 dark:text-white'
const sub = 'text-[11px] text-green-600 dark:text-night-300'
const money = (k: number | null | undefined) => (k == null ? '—' : formatNaira(k))
const PRESETS: ['today' | '7d' | 'month' | 'lastmonth' | '90d', string][] = [['today', 'Today'], ['7d', '7 days'], ['month', 'This month'], ['lastmonth', 'Last month'], ['90d', '90 days']]

interface Section { label: string; count: number; amount_kobo: number; fees_kobo: number; commission_kobo: number }
interface Center {
  wallet: { reachable: boolean; available_kobo: number | null; ledger_kobo: number | null; status: 'ok' | 'warning' | 'critical' | 'unreachable' }
  thresholds: { warning_naira: number; critical_naira: number }
  settlement: { pending_kobo: number; pending_count: number; due_today_kobo: number; due_today_count: number; late_kobo: number; late_count: number; settlement_days: number; unknown_fee_count: number; note: string; pending_by_settlement_day: { day: string; amount_kobo: number }[]; late_items: { reference: string; amount_kobo: number; paid_on: string; expected_on: string }[] }
  sections: Record<string, Section>; late_alerts_enabled: boolean; available_plus_pending_kobo: number
}
interface Tx { section: string; reference: string; at: string; who: string | null; amount_kobo: number; fee_kobo: number | null; status: string; settles_on: string | null; detail: string }

export default function MonnifyCenterPage() {
  const nav = useNavigate(); const qc = useQueryClient()
  const [period, setPeriod] = useState<Period>(presetPeriod('7d'))
  const [section, setSection] = useState(''); const [status, setStatus] = useState(''); const [q, setQ] = useState(''); const [page, setPage] = useState(0)
  const { data, isError, error } = useQuery({ queryKey: ['monnify-center', period.start, period.end], queryFn: async () => (await api.get<Center>('/director/monnify/center', { params: { start: period.start, end: period.end } })).data, refetchInterval: 120_000 })
  const tx = useQuery({ queryKey: ['monnify-tx', period.start, period.end, section, status, q, page], queryFn: async () => (await api.get<{ total: number; items: Tx[] }>('/director/monnify/transactions', { params: { start: period.start, end: period.end, section: section || undefined, status: status || undefined, q: q || undefined, limit: 50, offset: page * 50 } })).data })
  const [form, setForm] = useState<{ warning: string; critical: string; days: string } | null>(null)
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.put('/director/monnify/settings', body),
    onSuccess: () => { setForm(null); qc.invalidateQueries({ queryKey: ['monnify-center'] }); toast.success('Saved') }, onError: (e) => toast.error(getErrorMessage(e)),
  })
  const tone = { ok: 'text-green-700 dark:text-green-300', warning: 'text-amber-600', critical: 'text-red-600', unreachable: 'text-red-600' }

  return (
    <div className="min-h-dvh bg-green-50/40 px-4 pb-28 pt-6 dark:bg-night-800">
      <div className="mx-auto max-w-3xl space-y-4">
        <button onClick={() => nav(-1)} aria-label="Back" className="flex h-9 w-9 items-center justify-center rounded-full bg-green-100 dark:bg-night-600"><ArrowLeft className="h-4 w-4" /></button>
        <div><h1 className="text-2xl font-extrabold text-green-950 dark:text-white">Monnify center</h1><p className={sub}>What Monnify holds for us, what it still owes us, and everything that went through it. No need to log in to Monnify.</p></div>

        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map(([id, l]) => <button key={id} onClick={() => { setPeriod(presetPeriod(id)); setPage(0) }} className={`rounded-full px-3 py-1.5 text-xs font-bold ${period.label === presetPeriod(id).label ? 'bg-green-600 text-white' : 'bg-white text-green-800 dark:bg-night-600 dark:text-white'}`}>{l}</button>)}
          <input type="date" className="rounded-full border border-green-200 bg-white px-3 py-1 text-xs dark:border-night-500 dark:bg-night-600 dark:text-white" value={period.start} max={period.end} onChange={(e) => { setPeriod({ label: 'Custom', start: e.target.value, end: period.end }); setPage(0) }} aria-label="From" />
          <input type="date" className="rounded-full border border-green-200 bg-white px-3 py-1 text-xs dark:border-night-500 dark:bg-night-600 dark:text-white" value={period.end} min={period.start} max={ymd(new Date())} onChange={(e) => { setPeriod({ label: 'Custom', start: period.start, end: e.target.value }); setPage(0) }} aria-label="To" />
        </div>

        {isError && <p className="text-sm text-red-600">{getErrorMessage(error)}</p>}
        {!data && !isError && <p className="py-10 text-center text-sm text-green-600">Loading…</p>}
        {data && (<>
          <div className="grid grid-cols-2 gap-2">
            <div className={card}><p className={sub}>Monnify wallet (available)</p><p className={`text-xl font-extrabold tabular-nums ${tone[data.wallet.status]}`}>{data.wallet.reachable ? money(data.wallet.available_kobo) : 'Unreachable'}</p>
              <p className={sub}>{data.wallet.status === 'ok' ? <><CheckCircle2 className="mr-1 inline h-3 w-3" />Above the warning level</> : data.wallet.status === 'unreachable' ? 'Could not reach Monnify' : <><AlertTriangle className="mr-1 inline h-3 w-3" />{data.wallet.status === 'critical' ? 'Critical: fund it now' : 'Running low: top it up soon'}</>}</p></div>
            <div className={card}><p className={sub}>Pending settlement</p><p className="text-xl font-extrabold tabular-nums text-green-950 dark:text-white">{money(data.settlement.pending_kobo)}</p><p className={sub}>{data.settlement.pending_count} payments on the way</p></div>
            <div className={card}><p className={sub}>Wallet + pending</p><p className="text-lg font-extrabold tabular-nums text-green-950 dark:text-white">{money(data.available_plus_pending_kobo)}</p></div>
            <div className={card}><p className={sub}>Late settlements</p><p className={`text-lg font-extrabold tabular-nums ${data.settlement.late_count ? 'text-red-600' : 'text-green-950 dark:text-white'}`}>{money(data.settlement.late_kobo)}</p><p className={sub}>{data.settlement.late_count} past their settlement day</p></div>
          </div>
          <p className={sub}>Pending and late are estimated from our records, not read from Monnify. Ledger balance: {money(data.wallet.ledger_kobo)}. {data.settlement.note}</p>

          {data.settlement.pending_by_settlement_day.length > 0 && <div className={card}><p className={`${h} mb-1`}>Arriving</p>{data.settlement.pending_by_settlement_day.map((d) => <div key={d.day} className="flex justify-between py-0.5 text-xs text-green-900 dark:text-night-100"><span>{d.day}</span><span className="tabular-nums">{money(d.amount_kobo)}</span></div>)}</div>}
          {data.settlement.late_items.length > 0 && <div className={`${card} border-red-300`}><p className={`${h} mb-1`}>Late: ask Monnify about these</p>{data.settlement.late_items.map((d) => <div key={d.reference} className="flex justify-between gap-2 py-0.5 text-xs text-green-900 dark:text-night-100"><span className="truncate">{d.reference} · paid {d.paid_on}, due {d.expected_on}</span><span className="tabular-nums">{money(d.amount_kobo)}</span></div>)}</div>}

          <div className={card}>
            <p className={`${h} mb-2`}>By section ({period.start} to {period.end})</p>
            {Object.entries(data.sections).map(([k, s]) => (
              <button key={k} onClick={() => { setSection(section === k ? '' : k); setPage(0) }} className={`mb-1 flex w-full items-center justify-between gap-2 rounded-xl p-2 text-left text-xs ${section === k ? 'bg-green-200 dark:bg-night-500' : 'bg-green-50 dark:bg-night-600'}`}>
                <span className="min-w-0"><span className="block font-bold text-green-950 dark:text-white">{s.label}</span><span className={sub}>{s.count} transactions{s.fees_kobo ? ` · Monnify fees ${money(s.fees_kobo)}` : ''}{s.commission_kobo ? ` · commission ${money(s.commission_kobo)}` : ''}</span></span>
                <span className="shrink-0 font-extrabold tabular-nums">{money(s.amount_kobo)}</span>
              </button>))}
            <p className={sub}>Tap a section to filter the list below.</p>
          </div>

          <div className={card}>
            <p className={`${h} mb-2`}>Transactions</p>
            <div className="grid grid-cols-2 gap-2">
              <input className={input} placeholder="Search reference or customer" value={q} onChange={(e) => { setQ(e.target.value); setPage(0) }} />
              <input className={input} placeholder="Status (e.g. completed, failed)" value={status} onChange={(e) => { setStatus(e.target.value); setPage(0) }} />
            </div>
            <div className="mt-2 space-y-1">
              {(tx.data?.items ?? []).map((t) => (
                <div key={t.section + t.reference + t.at} className="rounded-xl bg-green-50 p-2 text-xs dark:bg-night-600">
                  <div className="flex justify-between gap-2"><span className="truncate font-bold text-green-950 dark:text-white">{t.who ?? 'Customer'} · {t.reference}</span><span className="tabular-nums">{money(t.amount_kobo)}</span></div>
                  <p className={sub}>{t.at.slice(0, 16).replace('T', ' ')} · {data.sections[t.section]?.label.split(' (')[0]} · {t.status}{t.settles_on ? ` · settles ${t.settles_on}` : ''}{t.fee_kobo != null ? ` · Monnify fee ${money(t.fee_kobo)}` : ''} · {t.detail}</p>
                </div>))}
              {tx.data && tx.data.items.length === 0 && <p className={sub}>No transactions match.</p>}
            </div>
            {tx.data && tx.data.total > 50 && <div className="mt-2 flex items-center justify-between text-xs"><button className="font-bold text-green-700 disabled:opacity-40" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button><span>{page * 50 + 1}–{Math.min(tx.data.total, page * 50 + 50)} of {tx.data.total}</span><button className="font-bold text-green-700 disabled:opacity-40" disabled={(page + 1) * 50 >= tx.data.total} onClick={() => setPage(page + 1)}>Next</button></div>}
          </div>

          <div className={card}>
            <p className={`${h} mb-1`}>Alerts and settings</p>
            <p className={`${sub} mb-2`}>You are warned when the available wallet falls below the warning level, and alerted as critical below the critical level (alerts appear on the alerts page; email follows the email switch there).</p>
            {(() => { const f = form ?? { warning: String(data.thresholds.warning_naira), critical: String(data.thresholds.critical_naira), days: String(data.settlement.settlement_days) }; return (
              <div className="grid grid-cols-3 gap-2">
                <label className={sub}>Warning below (₦)<input className={input} inputMode="decimal" value={f.warning} onChange={(e) => setForm({ ...f, warning: e.target.value })} /></label>
                <label className={sub}>Critical below (₦)<input className={input} inputMode="decimal" value={f.critical} onChange={(e) => setForm({ ...f, critical: e.target.value })} /></label>
                <label className={sub}>Settles in (business days)<input className={input} inputMode="numeric" value={f.days} onChange={(e) => setForm({ ...f, days: e.target.value })} /></label>
                <button className={`${btn} col-span-3`} disabled={save.isPending || parseAmount(f.warning) === null || parseAmount(f.critical) === null || parseAmount(f.days) === null}
                  onClick={() => save.mutate({ warning_naira: parseAmount(f.warning), critical_naira: parseAmount(f.critical), settlement_days: Math.floor(parseAmount(f.days) ?? 1) })}>Save</button>
              </div>) })()}
            <label className="mt-3 flex items-center gap-2 text-xs text-green-900 dark:text-night-100"><input type="checkbox" checked={data.late_alerts_enabled} onChange={(e) => save.mutate({ late_alerts_enabled: e.target.checked })} />Alert me when a payment is still unsettled after its settlement day</label>
          </div>
        </>)}
      </div>
    </div>
  )
}
