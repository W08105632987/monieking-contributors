import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, ArrowLeft, CheckCircle2, Plus, RotateCcw, Trash2, Wand2 } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import toast from '@/lib/notify'
import { api, getErrorMessage } from '@/lib/api'
import { formatNaira, formatNairaAmount } from '@/lib/utils'
import { DEFAULT_TIERS, FeeTier, closeGaps, validateTiers } from '@/lib/fundingFees'

interface Settings { charge_customers: boolean; pass_monnify_fee: boolean; fee_label?: string; tiers: FeeTier[] }
interface Summary {
  fundings: number; total_funded_kobo: number; monnify_fees_kobo: number; fee_unknown_count: number
  absorbed: { count: number; lost_kobo: number }
  charged: { count: number; collected_kobo: number; monnify_fee_kobo: number; profit_kobo: number }
  by_monnify_fee: { monnify_fee_kobo: number; count: number; lost_kobo: number }[]
}
interface Stats {
  monthly: { month: string; fundings: number; total_kobo: number; average_kobo: number; customers: number }[]
  overall: { fundings: number; total_kobo: number; average_kobo: number; largest_kobo: number; customers: number; median_kobo: number; avg_per_customer_kobo: number }
  distribution: { label: string; count: number }[]
}

const RANGES = [{ l: '7 days', d: 7 }, { l: '30 days', d: 30 }, { l: '90 days', d: 90 }, { l: 'Custom', d: 0 }]
const iso = (d: Date) => d.toISOString().slice(0, 10)
const card = 'rounded-2xl border border-green-100 bg-white p-4 shadow-card dark:border-night-500 dark:bg-night-700'

function Tile({ label, value, tone = '' }: { label: string; value: string; tone?: string }) {
  return (
    <motion.div layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl bg-green-50 p-3 dark:bg-night-600">
      <p className="text-[10px] font-bold uppercase tracking-wide text-green-600 dark:text-night-300">{label}</p>
      <p className={`mt-0.5 text-lg font-extrabold text-green-950 dark:text-white ${tone}`}>{value}</p>
    </motion.div>
  )
}

export default function FundingFeesPage() {
  const nav = useNavigate()
  const qc = useQueryClient()
  const { data: saved } = useQuery({ queryKey: ['funding-fees'], queryFn: async () => (await api.get<Settings>('/director/funding-fees')).data })
  const [charge, setCharge] = useState(false)
  const [pass, setPass] = useState(false)
  const [label, setLabel] = useState('NIPPS charge')   // the name customers see on the fee line
  const [tiers, setTiers] = useState<FeeTier[]>(DEFAULT_TIERS)
  // Unsaved edits are kept on this device so they survive leaving the page; they are offered back when you return.
  const DRAFT_KEY = 'monieking.fundingFeesDraft'
  const [restored, setRestored] = useState(false)
  const loaded = useRef(false)
  useEffect(() => {
    if (!saved) return
    let draft: Settings | null = null
    if (!loaded.current) { try { draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null') } catch { draft = null } }
    if (draft && Array.isArray(draft.tiers) && JSON.stringify(draft) !== JSON.stringify({ charge_customers: saved.charge_customers, pass_monnify_fee: !!saved.pass_monnify_fee, tiers: saved.tiers })) {
      setCharge(!!draft.charge_customers); setPass(!!draft.pass_monnify_fee); setTiers(draft.tiers); setRestored(true)
    } else { setCharge(saved.charge_customers); setPass(!!saved.pass_monnify_fee); setTiers(saved.tiers) }
    setLabel(saved.fee_label || 'NIPPS charge')
    loaded.current = true
  }, [saved])

  const problems = useMemo(() => validateTiers(tiers), [tiers])
  const dirty = !!saved && (saved.charge_customers !== charge || !!saved.pass_monnify_fee !== pass || JSON.stringify(saved.tiers) !== JSON.stringify(tiers) || (saved.fee_label || 'NIPPS charge') !== label)
  useEffect(() => {
    if (!loaded.current) return
    try { if (dirty) localStorage.setItem(DRAFT_KEY, JSON.stringify({ charge_customers: charge, pass_monnify_fee: pass, tiers })); else localStorage.removeItem(DRAFT_KEY) } catch { /* private mode: no draft */ }
  }, [dirty, charge, pass, tiers])
  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  const [days, setDays] = useState(30)
  const [from, setFrom] = useState(iso(new Date(Date.now() - 30 * 864e5)))
  const [to, setTo] = useState(iso(new Date()))
  const params = days ? { start: new Date(Date.now() - days * 864e5).toISOString(), end: new Date().toISOString() }
                      : { start: `${from}T00:00:00Z`, end: `${to}T23:59:59Z` }
  const { data: sum } = useQuery({ queryKey: ['funding-summary', params.start.slice(0, 10), params.end.slice(0, 10)], queryFn: async () => (await api.get<Summary>('/director/funding-fees/summary', { params })).data })
  const { data: stats } = useQuery({ queryKey: ['funding-stats'], queryFn: async () => (await api.get<Stats>('/director/funding-fees/stats', { params: { months: 3 } })).data })

  const save = useMutation({
    mutationFn: () => api.put('/director/funding-fees', { charge_customers: charge, pass_monnify_fee: pass, fee_label: label.trim() || 'NIPPS charge', tiers }),
    onSuccess: () => { try { localStorage.removeItem(DRAFT_KEY) } catch { /* ignore */ } setRestored(false); qc.invalidateQueries({ queryKey: ['funding-fees'] }); toast.success(pass ? 'Saved. Customers pay Monnify’s charge and see what remains.' : charge ? 'Saved. Customers are now charged when they fund.' : 'Saved. Customers see the full amount they send.') },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const setTier = (i: number, patch: Partial<FeeTier>) => setTiers((t) => t.map((x, k) => (k === i ? { ...x, ...patch } : x)))
  const num = (v: string) => (v === '' ? 0 : Math.max(0, Math.floor(Number(v) || 0)))
  const addRange = () => setTiers((t) => {
    const last = t[t.length - 1]
    const split = (last?.from ?? 0) + 5000
    return [...t.slice(0, -1), { ...last, to: split }, { from: split + 1, to: null, fee: last?.fee ?? 0 }]
  })
  const removeRange = (i: number) => setTiers((t) => {
    const next = t.filter((_, k) => k !== i)
    if (next.length && i === t.length - 1) next[next.length - 1] = { ...next[next.length - 1], to: null }
    return next
  })

  return (
    <div className="min-h-dvh bg-green-50/40 px-4 pb-48 pt-6 dark:bg-night-800">
      <div className="mx-auto max-w-2xl">
        <button onClick={() => nav(-1)} aria-label="Back" className="mb-3 flex h-9 w-9 items-center justify-center rounded-full bg-green-100 dark:bg-night-600"><ArrowLeft className="h-4 w-4 text-green-800 dark:text-white" /></button>
        <h1 className="text-2xl font-extrabold text-green-950 dark:text-white">Wallet funding fee</h1>
        <p className="mb-4 mt-1 text-xs text-green-600 dark:text-night-300">Monnify charges us a small fee every time a customer funds their wallet. You decide whether the customer pays it.</p>

        {/* on / off */}
        <div className={`${card} mb-4`}>
          <button onClick={() => setCharge((c) => !c)} className="flex w-full items-center justify-between gap-3 text-left" aria-pressed={charge}>
            <span>
              <span className="block text-sm font-extrabold text-green-950 dark:text-white">Charge customers a funding fee</span>
              <span className="block text-xs text-green-600 dark:text-night-300">{charge ? 'ON: customers see the full amount they sent, then the fee as a separate line.' : 'OFF: a customer who sends ₦100 sees ₦100. MonieKing pays Monnify’s fee.'}</span>
            </span>
            <span className={`relative h-8 w-14 shrink-0 rounded-full transition-colors duration-200 ${charge ? 'bg-green-600' : 'bg-gray-300 dark:bg-night-500'}`}>
              <motion.span layout transition={{ type: 'spring', stiffness: 600, damping: 34 }} className="absolute top-1 h-6 w-6 rounded-full bg-white shadow" style={{ left: charge ? 28 : 4 }} />
            </span>
          </button>
        </div>

        {/* pass Monnify's own charge on */}
        <div className={`${card} mb-4`}>
          <button onClick={() => setPass((v) => !v)} className="flex w-full items-center justify-between gap-3 text-left" aria-pressed={pass}>
            <span>
              <span className="block text-sm font-extrabold text-green-950 dark:text-white">Show customers Monnify’s charge</span>
              <span className="block text-xs text-green-600 dark:text-night-300">{pass ? 'ON: the customer pays Monnify’s exact charge and sees how much of what they sent actually arrived (e.g. ₦100 sent, ₦1.61 Monnify charge, ₦98.39 credited). This replaces the price ranges below.' : 'OFF: customers are not shown Monnify’s charge.'}</span>
            </span>
            <span className={`relative h-8 w-14 shrink-0 rounded-full transition-colors duration-200 ${pass ? 'bg-green-600' : 'bg-gray-300 dark:bg-night-500'}`}>
              <motion.span layout transition={{ type: 'spring', stiffness: 600, damping: 34 }} className="absolute top-1 h-6 w-6 rounded-full bg-white shadow" style={{ left: pass ? 28 : 4 }} />
            </span>
          </button>
        </div>

        {/* the name customers see on the fee line */}
        <div className={`${card} mb-4`}>
          <label className="block text-sm font-extrabold text-green-950 dark:text-white" htmlFor="fee-label">What customers see this charge called</label>
          <p className="mb-2 mt-1 text-xs text-green-600 dark:text-night-300">When a customer funds their wallet, their history shows the full amount they sent, then this charge as a separate line, for example “+₦1,500.00 Wallet funded” followed by “−₦40.00 {label.trim() || 'NIPPS charge'}”.</p>
          <input id="fee-label" maxLength={40} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="NIPPS charge" className="w-full rounded-xl border border-green-200 bg-white px-3 py-2 text-sm text-green-950 outline-none focus:border-green-500 dark:border-night-500 dark:bg-night-600 dark:text-white" />
        </div>

        {/* ranges */}
        <AnimatePresence initial={false}>
          {charge && !pass && (
            <motion.div key="ranges" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.22, ease: 'easeOut' }} className="overflow-hidden">
              <div className={`${card} mb-4`}>
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm font-extrabold text-green-950 dark:text-white">Price ranges (₦)</p>
                  <div className="flex gap-2">
                    <button onClick={() => setTiers(DEFAULT_TIERS)} className="flex items-center gap-1 rounded-full bg-green-50 px-2.5 py-1 text-[11px] font-bold text-green-700 dark:bg-night-600 dark:text-night-100"><RotateCcw className="h-3 w-3" /> Defaults</button>
                    <button onClick={() => setTiers(closeGaps(tiers))} className="flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-700 dark:bg-amber-500/10 dark:text-amber-300"><Wand2 className="h-3 w-3" /> Close gaps</button>
                  </div>
                </div>
                <div className="grid grid-cols-[1fr_1fr_1fr_28px] gap-2 px-1 text-[10px] font-bold uppercase text-green-500 dark:text-night-300"><span>From</span><span>To</span><span>Fee</span><span /></div>
                <AnimatePresence initial={false}>
                  {tiers.map((t, i) => (
                    <motion.div key={i} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} className="mt-2 grid grid-cols-[1fr_1fr_1fr_28px] items-center gap-2">
                      <input inputMode="numeric" value={t.from} onChange={(e) => setTier(i, { from: num(e.target.value) })} className="w-full rounded-xl border border-green-200 bg-white px-2 py-2 text-sm font-bold dark:border-night-500 dark:bg-night-800 dark:text-white" />
                      {t.to === null
                        ? <button onClick={() => i === tiers.length - 1 || setTier(i, { to: t.from + 4999 })} className="rounded-xl bg-green-50 px-2 py-2 text-left text-sm font-bold text-green-700 dark:bg-night-600 dark:text-night-100">and above</button>
                        : <input inputMode="numeric" value={t.to} onChange={(e) => setTier(i, { to: num(e.target.value) })} className="w-full rounded-xl border border-green-200 bg-white px-2 py-2 text-sm font-bold dark:border-night-500 dark:bg-night-800 dark:text-white" />}
                      <input inputMode="decimal" value={t.fee} onChange={(e) => setTier(i, { fee: Number(e.target.value.replace(/[^\d.]/g, '')) || 0 })} className="w-full rounded-xl border border-green-200 bg-white px-2 py-2 text-sm font-bold dark:border-night-500 dark:bg-night-800 dark:text-white" />
                      <button onClick={() => removeRange(i)} disabled={tiers.length < 2} aria-label="Remove range" className="text-red-500 disabled:opacity-20"><Trash2 className="h-4 w-4" /></button>
                    </motion.div>
                  ))}
                </AnimatePresence>
                <button onClick={addRange} className="mt-3 flex items-center gap-1 text-xs font-bold text-green-700 dark:text-night-100"><Plus className="h-3.5 w-3.5" /> Add a range</button>

                <AnimatePresence initial={false}>
                  {problems.map((p) => (
                    <motion.p key={p} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} role="alert" className="mt-2 flex items-start gap-2 overflow-hidden rounded-xl bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 dark:bg-red-900/20 dark:text-red-300">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {p}
                    </motion.p>
                  ))}
                </AnimatePresence>
                {!problems.length && <p className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-green-700 dark:text-green-300"><CheckCircle2 className="h-4 w-4" /> Every payment amount is covered. No gaps.</p>}
                <p className="mt-2 text-[11px] text-green-600 dark:text-night-300">If a fee would be as large as the payment itself, it is waived.</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* money: lost / earned */}
        <div className={`${card} mb-4`}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-extrabold text-green-950 dark:text-white">{charge ? 'What funding fees did' : 'What funding is costing MonieKing'}</p>
            <div className="flex gap-1">
              {RANGES.map((r) => (
                <button key={r.l} onClick={() => setDays(r.d)} className={`rounded-full px-2.5 py-1 text-[11px] font-bold transition-colors ${days === r.d ? 'bg-green-900 text-white dark:bg-night-100 dark:text-night-900' : 'bg-green-50 text-green-700 dark:bg-night-600 dark:text-night-100'}`}>{r.l}</button>
              ))}
            </div>
          </div>
          {days === 0 && (
            <div className="mb-3 flex gap-2"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="flex-1 rounded-xl border border-green-200 px-2 py-1.5 text-sm dark:border-night-500 dark:bg-night-800 dark:text-white" /><input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="flex-1 rounded-xl border border-green-200 px-2 py-1.5 text-sm dark:border-night-500 dark:bg-night-800 dark:text-white" /></div>
          )}
          {sum ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Tile label="Fundings" value={String(sum.fundings)} />
                <Tile label="Total funded" value={formatNaira(sum.total_funded_kobo)} />
                <Tile label="Lost: fees MonieKing absorbed" value={formatNaira(sum.absorbed.lost_kobo)} tone="text-red-600" />
                <Tile label="Collected from customers" value={formatNaira(sum.charged.collected_kobo)} tone="text-green-700" />
                <Tile label="Monnify fees in total" value={formatNaira(sum.monnify_fees_kobo)} />
                <Tile label="Profit on charged fundings" value={formatNaira(sum.charged.profit_kobo)} tone={sum.charged.profit_kobo < 0 ? 'text-red-600' : 'text-green-700'} />
              </div>
              {sum.by_monnify_fee.length > 0 && (
                <div className="mt-3">
                  <p className="mb-1 text-[11px] font-bold uppercase text-green-600 dark:text-night-300">Losses by Monnify charge (while charging was off)</p>
                  {sum.by_monnify_fee.map((b) => (
                    <div key={b.monnify_fee_kobo} className="flex justify-between border-b border-green-50 py-1.5 text-sm dark:border-night-600">
                      <span className="text-green-900 dark:text-white">{formatNaira(b.monnify_fee_kobo)} per funding × {b.count}</span>
                      <b className="text-red-600">{formatNaira(b.lost_kobo)}</b>
                    </div>
                  ))}
                </div>
              )}
              {sum.fee_unknown_count > 0 && <p className="mt-2 text-[11px] text-amber-600">{sum.fee_unknown_count} funding(s) did not report Monnify's fee, so they are not counted above.</p>}
            </>
          ) : <p className="text-xs text-green-600">Loading…</p>}
        </div>

        {/* how customers fund */}
        <div className={`${card} mb-4`}>
          <p className="mb-3 text-sm font-extrabold text-green-950 dark:text-white">How customers fund their wallets (last 3 months)</p>
          {stats && stats.overall.fundings > 0 ? (
            <>
              <div className="mb-4 grid grid-cols-2 gap-2">
                <Tile label="Average funding" value={formatNaira(stats.overall.average_kobo)} />
                <Tile label="Typical (median)" value={formatNaira(stats.overall.median_kobo)} />
                <Tile label="Largest" value={formatNaira(stats.overall.largest_kobo)} />
                <Tile label="Avg per customer" value={formatNaira(stats.overall.avg_per_customer_kobo)} />
              </div>
              <p className="mb-1 text-[11px] font-bold uppercase text-green-600 dark:text-night-300">Total funded per month</p>
              <div className="h-44"><ResponsiveContainer width="100%" height="100%"><BarChart data={stats.monthly.map((m) => ({ ...m, total: m.total_kobo / 100 }))}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="month" fontSize={11} /><YAxis fontSize={11} width={48} tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : v)} /><Tooltip formatter={(v: number) => formatNairaAmount(v)} /><Bar dataKey="total" fill="#16a34a" radius={[6, 6, 0, 0]} isAnimationActive={false} /></BarChart></ResponsiveContainer></div>
              <p className="mb-1 mt-3 text-[11px] font-bold uppercase text-green-600 dark:text-night-300">How big the fundings are</p>
              <div className="h-44"><ResponsiveContainer width="100%" height="100%"><BarChart data={stats.distribution}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="label" fontSize={10} interval={0} /><YAxis fontSize={11} width={30} allowDecimals={false} /><Tooltip /><Bar dataKey="count" fill="#d97706" radius={[6, 6, 0, 0]} isAnimationActive={false} /></BarChart></ResponsiveContainer></div>
            </>
          ) : <p className="text-xs text-green-600 dark:text-night-300">No fundings recorded yet. This fills in as customers fund their wallets.</p>}
        </div>
      </div>

      <AnimatePresence>
        {dirty && (
          <motion.div initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 80, opacity: 0 }} transition={{ duration: 0.2 }} style={{ bottom: 'var(--bottom-nav-height, 0px)' }} className="fixed inset-x-0 z-[60] border-t border-green-100 bg-white p-3 shadow-[0_-4px_16px_rgba(0,0,0,0.08)] dark:border-night-500 dark:bg-night-700">
            <div className="mx-auto flex max-w-2xl items-center gap-3">
              <p className="flex-1 text-xs font-semibold text-green-800 dark:text-night-100">{charge && !pass && problems.length ? 'Fix the ranges above to save.' : restored ? 'Unsaved changes from earlier are back. Save them to apply.' : 'You have unsaved changes. They only take effect once you save.'}</p>
              <button onClick={() => { if (saved) { setCharge(saved.charge_customers); setPass(!!saved.pass_monnify_fee); setTiers(saved.tiers) } setRestored(false) }} className="px-3 py-2 text-xs font-bold text-green-700 dark:text-night-200">Discard</button>
              <button onClick={() => save.mutate()} disabled={save.isPending || (charge && !pass && problems.length > 0)} className="rounded-full bg-green-900 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-40 dark:bg-night-100 dark:text-night-900">{save.isPending ? 'Saving…' : 'Save'}</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
