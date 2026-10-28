import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, Search, TrendingUp, X } from 'lucide-react'
import toast from '@/lib/notify'
import { getErrorMessage } from '@/lib/api'
import { cn, formatNaira } from '@/lib/utils'
import {
  usePriceList, useUpdatePrice, useBulkPrice, useProfitReport,
  type PriceRow, type PricingCategory, type ProfitPeriod,
} from '@/hooks/useBillPricing'

const CATEGORIES: { key: PricingCategory; label: string }[] = [
  { key: 'airtime', label: 'Airtime' }, { key: 'data', label: 'Data' }, { key: 'electricity', label: 'Electricity' },
  { key: 'cable_tv', label: 'Cable TV' }, { key: 'education', label: 'Education' },
]
const PERIODS: { key: ProfitPeriod; label: string }[] = [
  { key: 'today', label: 'Today' }, { key: 'week', label: 'This week' }, { key: 'month', label: 'This month' }, { key: 'custom', label: 'Custom' },
]
const label = (c: PricingCategory) => CATEGORIES.find(x => x.key === c)?.label ?? c
const pct = (n: number) => `${Number(n.toFixed(3))}%`
const card = 'bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500'
const money = (k: number) => formatNaira(k)

function ProfitPanel() {
  const [period, setPeriod] = useState<ProfitPeriod>('today')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const { data, isFetching, isError, error } = useProfitReport(period, start || undefined, end || undefined)
  const byCat = useMemo(() => Object.fromEntries((data?.rows ?? []).map(r => [r.category, r])), [data])
  const airtime = byCat.airtime, dataRow = byCat.data
  const others = (['electricity', 'cable_tv', 'education'] as PricingCategory[]).map(c => byCat[c]).filter(Boolean)

  return (
    <section className="space-y-3">
      <div className="flex gap-1.5 overflow-x-auto">
        {PERIODS.map(p => (
          <button key={p.key} onClick={() => setPeriod(p.key)}
            className={cn('shrink-0 px-3.5 py-1.5 rounded-full text-xs font-bold border', period === p.key ? 'bg-green-700 text-white border-transparent' : 'bg-white dark:bg-night-700 text-green-800 dark:text-night-100 border-green-100 dark:border-night-500')}>
            {p.label}
          </button>
        ))}
      </div>
      {period === 'custom' && (
        <div className="grid grid-cols-2 gap-2">
          {[{ v: start, set: setStart, l: 'From' }, { v: end, set: setEnd, l: 'To' }].map(f => (
            <label key={f.l} className="text-[11px] font-semibold text-green-700 dark:text-night-200">{f.l}
              <input type="date" value={f.v} onChange={e => f.set(e.target.value)} className="mt-1 w-full rounded-xl border border-green-100 dark:border-night-500 bg-white dark:bg-night-700 px-3 py-2 text-sm text-green-950 dark:text-white" />
            </label>
          ))}
        </div>
      )}
      {isError && <p className="text-xs font-semibold text-red-600">{getErrorMessage(error)}</p>}

      <div className={cn(card, 'p-4 relative overflow-hidden')} style={{ background: 'linear-gradient(135deg,#14532d,#166534)' }}>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-green-100/80">{data?.label ?? '…'} · total profit</p>
        <p className={cn('mt-1 text-3xl font-extrabold text-white transition-opacity', isFetching && 'opacity-60')}>{money(data?.total.profit_kobo ?? 0)}</p>
        <p className="mt-1 text-[11px] text-green-100/80">
          {data?.total.count ?? 0} sales · {money(data?.total.sales_kobo ?? 0)} sold · {money(data?.total.commission_kobo ?? 0)} Monnify commission · {money(data?.total.markup_kobo ?? 0)} from your prices
        </p>
        <TrendingUp className="absolute right-4 top-4 w-8 h-8 text-white/20" />
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        {[{ t: 'Airtime profit', r: airtime }, { t: 'Data profit', r: dataRow }].map(({ t, r }) => (
          <div key={t} className={cn(card, 'p-3.5')}>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-green-600 dark:text-night-300">{t}</p>
            <p className="mt-1 text-xl font-extrabold text-green-950 dark:text-white">{money(r?.profit_kobo ?? 0)}</p>
            <p className="mt-1 text-[11px] text-green-600 dark:text-night-300">{r?.count ?? 0} sales · {money(r?.sales_kobo ?? 0)} sold</p>
            <p className="text-[11px] text-green-600 dark:text-night-300">Commission {money(r?.commission_kobo ?? 0)} · Pricing {money(r?.markup_kobo ?? 0)}</p>
          </div>
        ))}
      </div>

      {others.length > 0 && (
        <div className={cn(card, 'px-4 divide-y divide-green-50 dark:divide-night-600')}>
          {others.map(r => (
            <div key={r.category} className="flex items-center gap-3 py-2.5">
              <span className="flex-1 text-sm font-bold text-green-950 dark:text-white">{label(r.category)}</span>
              <span className="text-[11px] text-green-600 dark:text-night-300">{r.count} sales</span>
              <span className="text-sm font-extrabold text-green-800 dark:text-night-100 w-24 text-right">{money(r.profit_kobo)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function EditSheet({ row, onClose }: { row: PriceRow; onClose: () => void }) {
  const update = useUpdatePrice()
  const [markup, setMarkup] = useState(String(row.markup_percent))
  const [commission, setCommission] = useState(String(row.commission_percent))
  const [price, setPrice] = useState(row.override_price_kobo != null ? String(row.override_price_kobo / 100) : '')
  const [active, setActive] = useState(row.is_active)

  function save() {
    const patch: Record<string, unknown> = { markup_percent: Number(markup || 0), commission_percent: Number(commission || 0), is_active: active }
    if (row.fixed_price) patch.customer_price_kobo = price.trim() === '' ? null : Math.round(Number(price) * 100)
    update.mutate({ id: row.id, patch }, { onSuccess: () => { toast.success('Price saved'); onClose() }, onError: (e) => toast.error(getErrorMessage(e)) })
  }
  const input = 'mt-1 w-full rounded-xl border border-green-100 dark:border-night-500 bg-white dark:bg-night-800 px-3 py-2.5 text-sm font-semibold text-green-950 dark:text-white'

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-green-950/60" onClick={onClose} />
      <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        className="relative w-full max-w-lg bg-white dark:bg-night-800 rounded-t-3xl p-5 pb-8 max-h-[90dvh] overflow-y-auto">
        <div className="flex items-start gap-3 mb-4">
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-green-600 dark:text-night-300">{row.provider}</p>
            <p className="text-base font-extrabold text-green-950 dark:text-white break-words">{row.product_name}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="w-8 h-8 rounded-full bg-green-50 dark:bg-night-600 flex items-center justify-center"><X className="w-4 h-4" /></button>
        </div>

        <div className="grid grid-cols-2 gap-3 text-[11px] font-semibold text-green-700 dark:text-night-200">
          <div className="rounded-xl bg-green-50 dark:bg-night-700 px-3 py-2.5">Monnify price<p className="text-sm font-extrabold text-green-950 dark:text-white">{row.monnify_price_kobo != null ? money(row.monnify_price_kobo) : 'Customer types it'}</p></div>
          <div className="rounded-xl bg-green-50 dark:bg-night-700 px-3 py-2.5">Customers pay<p className="text-sm font-extrabold text-green-950 dark:text-white">{row.customer_price_kobo != null ? money(row.customer_price_kobo) : `face value${row.markup_percent ? ` ${row.markup_percent > 0 ? '+' : ''}${pct(row.markup_percent)}` : ''}`}</p></div>
        </div>

        <div className="grid grid-cols-2 gap-3 mt-4">
          <label className="text-[11px] font-semibold text-green-700 dark:text-night-200">Monnify commission %
            <input inputMode="decimal" value={commission} onChange={e => setCommission(e.target.value)} className={input} />
          </label>
          <label className="text-[11px] font-semibold text-green-700 dark:text-night-200">Your markup % <span className="font-normal">(− = discount)</span>
            <input inputMode="decimal" value={markup} onChange={e => setMarkup(e.target.value)} className={input} />
          </label>
        </div>
        {row.fixed_price && (
          <label className="block mt-3 text-[11px] font-semibold text-green-700 dark:text-night-200">Or set the customer price in ₦ (overrides the markup; leave empty to use the markup)
            <input inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} placeholder={String((row.monnify_price_kobo ?? 0) / 100)} className={input} />
          </label>
        )}
        <button type="button" onClick={() => setActive(a => !a)} className="mt-4 w-full flex items-center justify-between rounded-xl bg-green-50 dark:bg-night-700 px-3 py-3 text-sm font-bold text-green-950 dark:text-white">
          Visible to customers <span className={cn('text-xs font-extrabold', active ? 'text-green-600' : 'text-red-500')}>{active ? 'Yes' : 'Hidden'}</span>
        </button>
        <button onClick={save} disabled={update.isPending} className="mt-5 w-full rounded-2xl bg-green-700 text-white font-bold py-3.5 disabled:opacity-60">{update.isPending ? 'Saving…' : 'Save'}</button>
      </motion.div>
    </div>
  )
}

function PriceList() {
  const [category, setCategory] = useState<PricingCategory>('airtime')
  const [query, setQuery] = useState('')
  const [provider, setProvider] = useState<string | null>(null)
  const [editing, setEditing] = useState<PriceRow | null>(null)
  const [bulkMarkup, setBulkMarkup] = useState('')
  const [bulkCommission, setBulkCommission] = useState('')
  const { data = [], isLoading } = usePriceList(category)
  const bulk = useBulkPrice()

  const providers = useMemo(() => [...new Set(data.map(r => r.provider))].sort(), [data])
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return data.filter(r => (!provider || r.provider === provider) && (!q || `${r.provider} ${r.product_name}`.toLowerCase().includes(q)))
  }, [data, provider, query])

  function applyBulk() {
    const body: Parameters<typeof bulk.mutate>[0] = { category, name_contains: provider ?? undefined }
    if (bulkMarkup.trim() !== '') body.markup_percent = Number(bulkMarkup)
    if (bulkCommission.trim() !== '') body.commission_percent = Number(bulkCommission)
    if (body.markup_percent === undefined && body.commission_percent === undefined) { toast.error('Enter a markup % or a commission %.'); return }
    bulk.mutate(body, { onSuccess: (r) => { toast.success(`Updated ${r.updated} products`); setBulkMarkup(''); setBulkCommission('') }, onError: (e) => toast.error(getErrorMessage(e)) })
  }

  return (
    <section className="space-y-3">
      <div className="flex gap-1.5 overflow-x-auto">
        {CATEGORIES.map(c => (
          <button key={c.key} onClick={() => { setCategory(c.key); setProvider(null); setQuery('') }}
            className={cn('shrink-0 px-3.5 py-1.5 rounded-full text-xs font-bold border', category === c.key ? 'bg-green-700 text-white border-transparent' : 'bg-white dark:bg-night-700 text-green-800 dark:text-night-100 border-green-100 dark:border-night-500')}>
            {c.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 bg-white dark:bg-night-700 border border-green-100 dark:border-night-500 rounded-xl px-3 py-2.5">
        <Search className="w-4 h-4 text-green-500" />
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search products" className="flex-1 bg-transparent outline-none text-sm font-semibold text-green-950 dark:text-white" />
      </div>
      {providers.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto">
          {[null, ...providers].map(p => (
            <button key={p ?? 'all'} onClick={() => setProvider(p)}
              className={cn('shrink-0 px-3 py-1 rounded-full text-[11px] font-bold border', provider === p ? 'bg-green-100 dark:bg-night-500 border-green-600 text-green-900 dark:text-white' : 'bg-white dark:bg-night-700 border-green-100 dark:border-night-500 text-green-700 dark:text-night-200')}>
              {p ?? 'All'}
            </button>
          ))}
        </div>
      )}

      <div className={cn(card, 'p-3.5 space-y-2')}>
        <p className="text-[11px] font-bold uppercase tracking-wide text-green-700 dark:text-night-200">Change all {provider ?? label(category)} at once</p>
        <div className="grid grid-cols-2 gap-2">
          <input inputMode="decimal" value={bulkCommission} onChange={e => setBulkCommission(e.target.value)} placeholder="Commission %" className="rounded-xl border border-green-100 dark:border-night-500 bg-white dark:bg-night-800 px-3 py-2 text-sm font-semibold text-green-950 dark:text-white" />
          <input inputMode="decimal" value={bulkMarkup} onChange={e => setBulkMarkup(e.target.value)} placeholder="Your markup %" className="rounded-xl border border-green-100 dark:border-night-500 bg-white dark:bg-night-800 px-3 py-2 text-sm font-semibold text-green-950 dark:text-white" />
        </div>
        <button onClick={applyBulk} disabled={bulk.isPending} className="w-full rounded-xl bg-green-700 text-white text-sm font-bold py-2.5 disabled:opacity-60">{bulk.isPending ? 'Applying…' : `Apply to ${provider ?? `all ${label(category)}`}`}</button>
        <p className="text-[10px] text-green-600 dark:text-night-300">A markup here replaces any hand-set customer prices for those products.</p>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[1, 2, 3].map(i => <div key={i} className="h-16 rounded-2xl bg-white dark:bg-night-700 animate-pulse" />)}</div>
      ) : shown.length === 0 ? (
        <p className="text-sm text-center text-green-600 dark:text-night-300 py-6">{data.length === 0 ? 'Nothing here yet — run the catalogue sync.' : 'No products match.'}</p>
      ) : (
        <div className={cn(card, 'divide-y divide-green-50 dark:divide-night-600 overflow-hidden')}>
          {shown.map(r => (
            <button key={r.id} onClick={() => setEditing(r)} className={cn('w-full text-left px-4 py-3 flex items-start gap-3', !r.is_active && 'opacity-50')}>
              <span className="flex-1 min-w-0">
                <span className="block text-[13px] font-bold text-green-950 dark:text-white break-words">{r.product_name}</span>
                <span className="block text-[11px] text-green-600 dark:text-night-300">{r.provider}{!r.is_active ? ' · hidden' : ''}</span>
                <span className="block text-[11px] text-green-600 dark:text-night-300 mt-0.5">
                  Monnify {r.monnify_price_kobo != null ? money(r.monnify_price_kobo) : 'open amount'} · commission {pct(r.commission_percent)} · markup {pct(r.markup_percent)}
                </span>
              </span>
              <span className="text-right shrink-0">
                <span className="block text-[13px] font-extrabold text-green-950 dark:text-white">{r.customer_price_kobo != null ? money(r.customer_price_kobo) : 'Face value'}</span>
                <span className={cn('block text-[11px] font-bold', r.profit_kobo >= 0 ? 'text-green-600' : 'text-red-500')}>
                  {r.profit_kobo >= 0 ? '+' : ''}{money(r.profit_kobo)}{r.fixed_price ? '/sale' : ` per ${money(r.profit_basis_kobo)}`}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}

      <AnimatePresence>{editing && <EditSheet key={editing.id} row={editing} onClose={() => setEditing(null)} />}</AnimatePresence>
    </section>
  )
}

export default function BillsPricingPage() {
  const nav = useNavigate()
  return (
    <div className="min-h-dvh bg-green-50 dark:bg-night-800 flex flex-col">
      <header className="flex items-center gap-3 px-4 py-3">
        <button onClick={() => nav(-1)} aria-label="Back" className="w-9 h-9 bg-white dark:bg-night-600 rounded-xl flex items-center justify-center"><ArrowLeft className="w-4 h-4 text-green-700 dark:text-night-100" /></button>
        <div>
          <h1 className="text-green-900 dark:text-white font-bold text-lg leading-tight">Prices & profit</h1>
          <p className="text-[11px] text-green-600 dark:text-night-300">What customers pay, what Monnify pays you, what you keep</p>
        </div>
      </header>
      <div className="flex-1 overflow-y-auto px-4 pb-24 space-y-6">
        <ProfitPanel />
        <PriceList />
      </div>
    </div>
  )
}
