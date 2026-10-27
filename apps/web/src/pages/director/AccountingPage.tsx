import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { AlertTriangle, ArrowLeft, Download, Pencil, Plus, Trash2 } from 'lucide-react'
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import toast from '@/lib/notify'
import { api, getErrorMessage } from '@/lib/api'
import { formatNaira } from '@/lib/utils'
import { Period, SOURCE_TEXT, parseAmount, presetPeriod, ymd } from '@/lib/accounting'

interface Totals { revenue_kobo: number; provider_cost_kobo: number; gross_profit_kobo: number; expenses_kobo: number; net_profit_kobo: number }
interface Service { key: string; label: string; group: string; count: number; volume_kobo: number; revenue_kobo: number; cost_kobo: number; margin_kobo: number; cost_source: string; unpriced_events: number; note?: string | null }
interface Report {
  start: string; end: string; totals: Totals; services: Service[]
  expenses: { total_kobo: number; by_category: { category: string; total_kobo: number; count: number }[] }
  warnings: { key: string; label: string; events: number }[]
  series?: (Totals & { label: string })[]
}
interface RateRow { id: string; mode: 'flat' | 'percent'; value: number; cap_kobo: number | null; effective_from: string; note: string | null }
interface Rate { key: string; label: string; group: string; provider: string; mode: 'flat' | 'percent'; hint: string; current: RateRow | null; history: RateRow[] }
interface Expense { id: string; spent_on: string; category: string; description: string; amount_kobo: number }
interface Holdings { wallet_balances_kobo: number; pending_payouts_kobo: number; avg_daily_outgoings_kobo: number; buffer_days: number; buffer_kobo: number; should_hold_kobo: number }

const card = 'rounded-2xl border border-green-100 bg-white p-4 shadow-card dark:border-night-500 dark:bg-night-700'
const input = 'w-full rounded-xl border border-green-200 bg-white px-3 py-2 text-sm text-green-950 outline-none focus:border-green-500 dark:border-night-500 dark:bg-night-600 dark:text-white'
const btn = 'rounded-xl bg-green-600 px-4 py-2 text-sm font-bold text-white transition-transform active:scale-95 disabled:opacity-50'
const TABS = ['Overview', 'Services', 'Prices', 'Expenses', 'Cash'] as const
type Tab = typeof TABS[number]
const PRESETS = [['today', 'Today'], ['7d', '7 days'], ['month', 'This month'], ['lastmonth', 'Last month'], ['90d', '90 days']] as const

function Tile({ label, value, tone = '', sub }: { label: string; value: string; tone?: string; sub?: string }) {
  return (
    <div className="rounded-xl bg-green-50 p-3 dark:bg-night-600">
      <p className="text-[10px] font-bold uppercase tracking-wide text-green-600 dark:text-night-300">{label}</p>
      <p className={`mt-0.5 text-lg font-extrabold text-green-950 dark:text-white ${tone}`}>{value}</p>
      {sub && <p className="text-[10px] text-green-600 dark:text-night-300">{sub}</p>}
    </div>
  )
}
const money = (k: number) => formatNaira(k)
const tone = (k: number) => (k < 0 ? 'text-red-600 dark:text-red-400' : k > 0 ? 'text-green-700 dark:text-green-300' : '')

export default function AccountingPage() {
  const nav = useNavigate()
  const qc = useQueryClient()
  const [tab, setTab] = useState<Tab>('Overview')
  const [period, setPeriod] = useState<Period>(() => presetPeriod('month'))
  const [custom, setCustom] = useState(false)

  const { data: rep, isLoading } = useQuery({
    queryKey: ['acct-report', period.start, period.end],
    queryFn: async () => (await api.get<Report>('/director/accounting/report', { params: { start: period.start, end: period.end } })).data,
  })
  const refresh = () => { qc.invalidateQueries({ queryKey: ['acct-report'] }); qc.invalidateQueries({ queryKey: ['acct-expenses'] }); qc.invalidateQueries({ queryKey: ['acct-holdings'] }) }

  async function exportCsv() {
    try {
      const res = await api.get('/director/accounting/export.csv', { params: { start: period.start, end: period.end }, responseType: 'blob' })
      const url = URL.createObjectURL(res.data as Blob)
      const a = document.createElement('a'); a.href = url; a.download = `monieking-accounts-${period.start}-${period.end}.csv`
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch (e) { toast.error(getErrorMessage(e)) }
  }

  return (
    <div className="min-h-dvh bg-green-50/40 px-4 pb-28 pt-6 dark:bg-night-800">
      <div className="mx-auto max-w-3xl">
        <button onClick={() => nav(-1)} aria-label="Back" className="mb-3 flex h-9 w-9 items-center justify-center rounded-full bg-green-100 dark:bg-night-600"><ArrowLeft className="h-4 w-4 text-green-800 dark:text-white" /></button>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-extrabold text-green-950 dark:text-white">Accounting Center</h1>
            <p className="mb-3 mt-1 text-xs text-green-600 dark:text-night-300">Every naira in and out, what each provider costs us, and what is left. Prices come from the Prices tab, so nothing is guessed.</p>
          </div>
          <button onClick={exportCsv} className="mt-1 flex shrink-0 items-center gap-1 rounded-xl border border-green-200 px-3 py-2 text-xs font-bold text-green-800 dark:border-night-500 dark:text-white"><Download className="h-3.5 w-3.5" />CSV</button>
        </div>

        {/* period */}
        <div className="mb-3 flex flex-wrap gap-1.5">
          {PRESETS.map(([id, l]) => (
            <button key={id} onClick={() => { setPeriod(presetPeriod(id)); setCustom(false) }}
              className={`rounded-full px-3 py-1.5 text-xs font-bold ${!custom && period.label === presetPeriod(id).label ? 'bg-green-600 text-white' : 'bg-white text-green-800 dark:bg-night-600 dark:text-white'}`}>{l}</button>
          ))}
          <button onClick={() => setCustom(true)} className={`rounded-full px-3 py-1.5 text-xs font-bold ${custom ? 'bg-green-600 text-white' : 'bg-white text-green-800 dark:bg-night-600 dark:text-white'}`}>Custom</button>
        </div>
        {custom && (
          <div className="mb-3 flex items-center gap-2">
            <input type="date" className={input} value={period.start} max={period.end} onChange={(e) => setPeriod({ label: 'Custom', start: e.target.value, end: period.end })} aria-label="From" />
            <span className="text-xs text-green-600">to</span>
            <input type="date" className={input} value={period.end} min={period.start} max={ymd(new Date())} onChange={(e) => setPeriod({ label: 'Custom', start: period.start, end: e.target.value })} aria-label="To" />
          </div>
        )}

        <div className="mb-4 flex gap-1 overflow-x-auto rounded-xl bg-green-100 p-1 dark:bg-night-600" role="tablist">
          {TABS.map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
              className={`flex-1 whitespace-nowrap rounded-lg px-3 py-2 text-xs font-bold ${tab === t ? 'bg-white text-green-900 shadow dark:bg-night-800 dark:text-white' : 'text-green-700 dark:text-night-200'}`}>{t}</button>
          ))}
        </div>

        {tab === 'Overview' && <Overview rep={rep} loading={isLoading} goPrices={() => setTab('Prices')} />}
        {tab === 'Services' && <Services rep={rep} loading={isLoading} />}
        {tab === 'Prices' && <Prices onChange={refresh} />}
        {tab === 'Expenses' && <Expenses period={period} onChange={refresh} />}
        {tab === 'Cash' && <Cash />}
      </div>
    </div>
  )
}

function Overview({ rep, loading, goPrices }: { rep?: Report; loading: boolean; goPrices: () => void }) {
  if (loading || !rep) return <p className="py-10 text-center text-sm text-green-600">Calculating…</p>
  const t = rep.totals
  const groups = useMemo(() => {
    const m = new Map<string, { revenue: number; cost: number }>()
    rep.services.forEach((s) => { const g = m.get(s.group) ?? { revenue: 0, cost: 0 }; g.revenue += s.revenue_kobo; g.cost += s.cost_kobo; m.set(s.group, g) })
    return [...m.entries()].sort((a, b) => b[1].revenue - a[1].revenue)
  }, [rep])
  const chart = (rep.series ?? []).map((p) => ({ name: p.label, Revenue: p.revenue_kobo / 100, 'Provider cost': p.provider_cost_kobo / 100, Expenses: p.expenses_kobo / 100, Net: p.net_profit_kobo / 100 }))
  return (
    <div className="space-y-4">
      {rep.warnings.length > 0 && (
        <button onClick={goPrices} className="flex w-full items-start gap-2 rounded-2xl border border-amber-300 bg-amber-50 p-3 text-left dark:border-amber-700 dark:bg-amber-950/30">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <span className="text-xs text-amber-900 dark:text-amber-200"><b>{rep.warnings.length} cost{rep.warnings.length > 1 ? 's' : ''} have no price entered</b> ({rep.warnings.slice(0, 3).map((w) => w.label).join(', ')}{rep.warnings.length > 3 ? '…' : ''}). Their cost is counted as ₦0, so profit may look higher than it is. Tap to enter prices.</span>
        </button>
      )}
      <div className={card}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Tile label="Revenue" value={money(t.revenue_kobo)} sub="what customers paid us in charges" />
          <Tile label="Provider costs" value={money(t.provider_cost_kobo)} sub="Monnify, Techhub, Termii, workers" />
          <Tile label="Gross profit" value={money(t.gross_profit_kobo)} tone={tone(t.gross_profit_kobo)} sub="revenue minus provider costs" />
          <Tile label="Expenses" value={money(t.expenses_kobo)} sub="entered by directors" />
          <Tile label="Net profit" value={money(t.net_profit_kobo)} tone={tone(t.net_profit_kobo)} sub="after expenses" />
        </div>
      </div>
      {chart.length > 0 && (
        <div className={card}>
          <p className="mb-2 text-sm font-extrabold text-green-950 dark:text-white">Over the period (₦)</p>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chart}>
                <CartesianGrid strokeDasharray="3 3" stroke="#d1fae5" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} width={48} />
                <Tooltip formatter={(v: number) => `₦${v.toLocaleString('en-NG', { maximumFractionDigits: 2 })}`} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="Revenue" fill="#16a34a" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Provider cost" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Expenses" fill="#94a3b8" radius={[4, 4, 0, 0]} />
                <Line type="monotone" dataKey="Net" stroke="#1d4ed8" strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
      <div className={card}>
        <p className="mb-1 text-sm font-extrabold text-green-950 dark:text-white">Where the profit comes from</p>
        <p className="mb-2 text-xs text-green-600 dark:text-night-300">Revenue is what we charged customers. Cost is what the provider charged us for the same activity.</p>
        <table className="w-full text-xs">
          <thead><tr className="text-left text-green-600 dark:text-night-300"><th className="py-1">Area</th><th className="text-right">Revenue</th><th className="text-right">Cost</th><th className="text-right">Profit</th></tr></thead>
          <tbody>
            {groups.map(([g, v]) => (
              <tr key={g} className="border-t border-green-100 dark:border-night-500">
                <td className="py-1.5 font-semibold text-green-950 dark:text-white">{g}</td>
                <td className="text-right">{money(v.revenue)}</td><td className="text-right">{money(v.cost)}</td>
                <td className={`text-right font-bold ${tone(v.revenue - v.cost)}`}>{money(v.revenue - v.cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rep.expenses.by_category.length > 0 && (
        <div className={card}>
          <p className="mb-2 text-sm font-extrabold text-green-950 dark:text-white">Expenses by category</p>
          {rep.expenses.by_category.map((c) => (
            <div key={c.category} className="flex justify-between border-t border-green-100 py-1.5 text-xs first:border-0 dark:border-night-500"><span>{c.category} ({c.count})</span><b>{money(c.total_kobo)}</b></div>
          ))}
        </div>
      )}
    </div>
  )
}

function Services({ rep, loading }: { rep?: Report; loading: boolean }) {
  if (loading || !rep) return <p className="py-10 text-center text-sm text-green-600">Calculating…</p>
  const groups = [...new Set(rep.services.map((s) => s.group))]
  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <div key={g} className={card}>
          <p className="mb-2 text-sm font-extrabold text-green-950 dark:text-white">{g}</p>
          {rep.services.filter((s) => s.group === g).map((s) => (
            <div key={s.key} className="border-t border-green-100 py-2 first:border-0 dark:border-night-500">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-semibold text-green-950 dark:text-white">{s.label}</span>
                <span className={`text-sm font-extrabold ${tone(s.margin_kobo)}`}>{money(s.margin_kobo)}</span>
              </div>
              <p className="text-[11px] text-green-600 dark:text-night-300">
                {s.count.toLocaleString()} done · charged {money(s.revenue_kobo)} · our cost {money(s.cost_kobo)}
                {s.volume_kobo > 0 && <> · volume {money(s.volume_kobo)}</>}
              </p>
              <p className={`text-[10px] ${s.cost_source === 'missing' ? 'font-bold text-amber-600' : 'text-green-500 dark:text-night-400'}`}>
                {SOURCE_TEXT[s.cost_source] ?? s.cost_source}{s.unpriced_events > 0 && ` (${s.unpriced_events} without a price)`}
              </p>
              {s.margin_kobo < 0 && <p className="text-[10px] font-bold text-red-600">We lose money on this service in this period.</p>}
              {s.note && <p className="text-[10px] italic text-green-500 dark:text-night-400">{s.note}</p>}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function Prices({ onChange }: { onChange: () => void }) {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['acct-rates'], queryFn: async () => (await api.get<{ rates: Rate[] }>('/director/accounting/rates')).data.rates })
  const [editing, setEditing] = useState<string | null>(null)
  const [mode, setMode] = useState<'flat' | 'percent'>('flat')
  const [val, setVal] = useState('')
  const [cap, setCap] = useState('')
  const [from, setFrom] = useState('')
  const [note, setNote] = useState('')
  const open = (r: Rate) => { setEditing(r.key); setMode(r.current?.mode ?? r.mode); setVal(r.current ? String(r.current.value) : ''); setCap(r.current?.cap_kobo ? String(r.current.cap_kobo / 100) : ''); setFrom(''); setNote('') }
  const save = useMutation({
    mutationFn: (r: Rate) => api.post('/director/accounting/rates', { rate_key: r.key, mode, value: parseAmount(val) ?? 0, cap_kobo: mode === 'percent' && cap ? Math.round((parseAmount(cap) ?? 0) * 100) : null, effective_from: from || null, note: note || null }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['acct-rates'] }); onChange(); setEditing(null); toast.success('Price saved') },
    onError: (e) => toast.error(getErrorMessage(e)),
  })
  if (!data) return <p className="py-10 text-center text-sm text-green-600">Loading…</p>
  const groups = [...new Set(data.map((r) => r.group))]
  return (
    <div className="space-y-4">
      <div className={card}>
        <p className="text-xs text-green-700 dark:text-night-200">Type what each provider charges <b>us</b>. The system uses these to work out our costs and profit. <b>The first price you enter counts for all past activity</b>; when a provider changes its price, add the new one with the date it started and older periods keep the old price. Anything with no price is flagged, never guessed.</p>
      </div>
      {groups.map((g) => (
        <div key={g} className={card}>
          <p className="mb-2 text-sm font-extrabold text-green-950 dark:text-white">{g}</p>
          {data.filter((r) => r.group === g).map((r) => (
            <div key={r.key} className="border-t border-green-100 py-2 first:border-0 dark:border-night-500">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-green-950 dark:text-white">{r.label}</p>
                  <p className={`text-xs ${r.current ? 'text-green-600 dark:text-night-300' : 'font-bold text-amber-600'}`}>
                    {r.current ? (r.current.mode === 'percent' ? `${r.current.value}% of the amount${r.current.cap_kobo ? `, max ${money(r.current.cap_kobo)}` : ''}` : `₦${r.current.value.toLocaleString('en-NG')} each`) : 'No price entered'}
                  </p>
                </div>
                <button onClick={() => (editing === r.key ? setEditing(null) : open(r))} className="shrink-0 rounded-lg bg-green-100 px-3 py-1.5 text-xs font-bold text-green-800 dark:bg-night-600 dark:text-white">{editing === r.key ? 'Close' : r.current ? 'Change' : 'Set price'}</button>
              </div>
              {editing === r.key && (
                <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="mt-2 space-y-2 rounded-xl bg-green-50 p-3 dark:bg-night-600">
                  <p className="text-[11px] text-green-700 dark:text-night-200">{r.hint}</p>
                  <div className="flex gap-1">
                    {(['flat', 'percent'] as const).map((m) => <button key={m} onClick={() => setMode(m)} className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-bold ${mode === m ? 'bg-green-600 text-white' : 'bg-white text-green-800 dark:bg-night-700 dark:text-white'}`}>{m === 'flat' ? 'Fixed ₦ each' : '% of amount'}</button>)}
                  </div>
                  <input className={input} inputMode="decimal" placeholder={mode === 'flat' ? 'Price in ₦ (e.g. 30 or 3.5)' : 'Percent (e.g. 1.5)'} value={val} onChange={(e) => setVal(e.target.value)} />
                  {mode === 'percent' && <input className={input} inputMode="decimal" placeholder="Maximum per transaction in ₦ (optional)" value={cap} onChange={(e) => setCap(e.target.value)} />}
                  {r.current && <label className="block text-[11px] text-green-700 dark:text-night-200">Starts on (leave empty for today)<input type="date" className={`${input} mt-1`} value={from} onChange={(e) => setFrom(e.target.value)} /></label>}
                  <input className={input} placeholder="Note (optional)" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
                  <button className={btn} disabled={parseAmount(val) === null || save.isPending} onClick={() => save.mutate(r)}>Save price</button>
                  {r.history.length > 1 && (
                    <div className="pt-1 text-[10px] text-green-600 dark:text-night-300">
                      History: {r.history.map((h) => `${h.mode === 'percent' ? `${h.value}%` : `₦${h.value}`} from ${h.effective_from.slice(0, 10)}`).join(' · ')}
                    </div>
                  )}
                </motion.div>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function Expenses({ period, onChange }: { period: Period; onChange: () => void }) {
  const qc = useQueryClient()
  const { data } = useQuery({
    queryKey: ['acct-expenses', period.start, period.end],
    queryFn: async () => (await api.get<{ expenses: Expense[]; total_kobo: number; categories: string[] }>('/director/accounting/expenses', { params: { start: period.start, end: period.end } })).data,
  })
  const blank = { spent_on: ymd(new Date()), category: 'Other', description: '', amount: '' }
  const [form, setForm] = useState(blank)
  const [editId, setEditId] = useState<string | null>(null)
  useEffect(() => { if (data && !data.categories.includes(form.category)) setForm((f) => ({ ...f, category: data.categories[0] })) }, [data]) // eslint-disable-line react-hooks/exhaustive-deps
  const amount = parseAmount(form.amount)
  const valid = !!form.description.trim() && !!form.category.trim() && amount !== null && amount > 0
  const done = () => { qc.invalidateQueries({ queryKey: ['acct-expenses'] }); onChange(); setForm(blank); setEditId(null) }
  const body = () => ({ spent_on: form.spent_on, category: form.category, description: form.description, amount_naira: amount })
  const add = useMutation({ mutationFn: () => (editId ? api.put(`/director/accounting/expenses/${editId}`, body()) : api.post('/director/accounting/expenses', body())), onSuccess: () => { toast.success(editId ? 'Expense updated' : 'Expense added'); done() }, onError: (e) => toast.error(getErrorMessage(e)) })
  const del = useMutation({ mutationFn: (id: string) => api.delete(`/director/accounting/expenses/${id}`), onSuccess: () => { toast.success('Expense removed'); done() }, onError: (e) => toast.error(getErrorMessage(e)) })
  const edit = (x: Expense) => { setEditId(x.id); setForm({ spent_on: x.spent_on, category: x.category, description: x.description, amount: String(x.amount_kobo / 100) }) }
  return (
    <div className="space-y-4">
      <div className={card}>
        <p className="mb-2 text-sm font-extrabold text-green-950 dark:text-white">{editId ? 'Edit expense' : 'Add an expense'}</p>
        <p className="mb-2 text-[11px] text-green-600 dark:text-night-300">Any date works, including past months. You can edit or remove an expense at any time.</p>
        <div className="grid grid-cols-2 gap-2">
          <input type="date" className={input} value={form.spent_on} onChange={(e) => setForm({ ...form, spent_on: e.target.value })} aria-label="Date spent" />
          <input className={input} inputMode="decimal" placeholder="Amount ₦" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} aria-label="Amount" />
          <input className={`${input} col-span-2`} list="acct-cats" placeholder="Category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} aria-label="Category" />
          <datalist id="acct-cats">{(data?.categories ?? []).map((c) => <option key={c} value={c} />)}</datalist>
          <input className={`${input} col-span-2`} placeholder="What was it for?" maxLength={300} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} aria-label="Description" />
        </div>
        <div className="mt-3 flex gap-2">
          <button className={`${btn} flex items-center gap-1`} disabled={!valid || add.isPending} onClick={() => add.mutate()}><Plus className="h-4 w-4" />{editId ? 'Save changes' : 'Add expense'}</button>
          {editId && <button className="rounded-xl bg-gray-100 px-4 py-2 text-sm font-bold dark:bg-night-600 dark:text-white" onClick={() => { setEditId(null); setForm(blank) }}>Cancel</button>}
        </div>
      </div>
      <div className={card}>
        <div className="mb-2 flex justify-between"><p className="text-sm font-extrabold text-green-950 dark:text-white">Expenses in this period</p><b className="text-sm">{money(data?.total_kobo ?? 0)}</b></div>
        {data && data.expenses.length === 0 && <p className="py-4 text-center text-xs text-green-600">No expenses recorded for these dates.</p>}
        {data?.expenses.map((x) => (
          <div key={x.id} className="flex items-center gap-2 border-t border-green-100 py-2 first:border-0 dark:border-night-500">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-green-950 dark:text-white">{x.description}</p>
              <p className="text-[11px] text-green-600 dark:text-night-300">{x.spent_on} · {x.category}</p>
            </div>
            <b className="text-sm">{money(x.amount_kobo)}</b>
            <button aria-label="Edit expense" onClick={() => edit(x)} className="rounded-lg p-1.5 text-green-700 hover:bg-green-100 dark:text-night-200"><Pencil className="h-4 w-4" /></button>
            <button aria-label="Delete expense" onClick={() => { if (window.confirm(`Remove "${x.description}" (${money(x.amount_kobo)})?`)) del.mutate(x.id) }} className="rounded-lg p-1.5 text-red-500 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button>
          </div>
        ))}
      </div>
    </div>
  )
}

function Cash() {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['acct-holdings'], queryFn: async () => (await api.get<Holdings>('/director/accounting/holdings')).data })
  const [days, setDays] = useState('')
  useEffect(() => { if (data) setDays(String(data.buffer_days)) }, [data?.buffer_days]) // eslint-disable-line react-hooks/exhaustive-deps
  const save = useMutation({
    mutationFn: () => api.put('/director/accounting/settings', { buffer_days: Math.max(0, Math.min(365, Math.floor(parseAmount(days) ?? 0))) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['acct-holdings'] }); toast.success('Saved') },
    onError: (e) => toast.error(getErrorMessage(e)),
  })
  if (!data) return <p className="py-10 text-center text-sm text-green-600">Loading…</p>
  return (
    <div className="space-y-4">
      <div className={card}>
        <p className="mb-1 text-sm font-extrabold text-green-950 dark:text-white">How much the company should hold right now</p>
        <p className="mb-3 text-xs text-green-600 dark:text-night-300">Customer money is not ours: it must stay available. On top of that, keep enough to cover provider costs and expenses for the buffer period.</p>
        <div className="grid grid-cols-2 gap-2">
          <Tile label="Customer & worker wallets" value={money(data.wallet_balances_kobo)} sub="owed to wallet holders" />
          <Tile label="Withdrawals waiting" value={money(data.pending_payouts_kobo)} sub="requested, not yet paid" />
          <Tile label={`Buffer (${data.buffer_days} days)`} value={money(data.buffer_kobo)} sub={`about ${money(data.avg_daily_outgoings_kobo)} a day (last 30 days)`} />
          <Tile label="Should hold" value={money(data.should_hold_kobo)} tone="text-green-700 dark:text-green-300" sub="total of the three" />
        </div>
      </div>
      <div className={card}>
        <label className="text-xs font-bold text-green-800 dark:text-night-200">Buffer days (how many days of costs and expenses to keep spare)</label>
        <div className="mt-2 flex gap-2">
          <input className={input} inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} />
          <button className={btn} disabled={parseAmount(days) === null || save.isPending} onClick={() => save.mutate()}>Save</button>
        </div>
        <p className="mt-2 text-[11px] text-green-600 dark:text-night-300">Compare "Should hold" with your real Monnify and bank balances. Profit you can safely take out is shown on the Overview as net profit.</p>
      </div>
    </div>
  )
}
