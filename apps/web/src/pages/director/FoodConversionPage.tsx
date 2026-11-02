import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Bell, CalendarClock, Check, Search, Send, X } from 'lucide-react'
import toast from '@/lib/notify'
import { ask } from '@/lib/dialog'
import { api, getErrorMessage } from '@/lib/api'
import { cn, formatDateTime } from '@/lib/utils'
import { sheetMotion, overlayMotion } from '@/lib/motion'
import type { Zone } from '@/types'

interface Summary { deadline: string; today: string; days_left: number; passed: boolean; unfinished_cards: number; unfinished_customers: number; buckets: Record<string, number>; auto_converted_total: number; reminded_today: number; template: string; total_days: number }
interface Row { customer_id: string; customer_number: number; full_name: string; phone_number: string; zone_name: string | null; last_reminded_at: string | null; lowest_percent: number; cards: { id: string; card_number: number; days_done: number; percent: number }[] }
interface List { total: number; items: Row[] }
const PAGE = 40
const PLACEHOLDERS = ['{name}', '{card_number}', '{days_done}', '{total_days}', '{days_left}', '{deadline}', '{cards}']

export default function FoodConversionPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [q, setQ] = useState(''); const [dq, setDq] = useState('')
  const [maxPct, setMaxPct] = useState<number | ''>('')
  const [reminded, setReminded] = useState<'' | 'never' | 'reminded'>('')
  const [zone, setZone] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [compose, setCompose] = useState<null | { ids: string[] | 'all'; label: string }>(null)
  const [deadline, setDeadline] = useState('')
  const [showConverted, setShowConverted] = useState(false)
  useEffect(() => { const t = setTimeout(() => setDq(q), 300); return () => clearTimeout(t) }, [q])

  const sum = useQuery({ queryKey: ['food-conv-summary'], queryFn: async () => (await api.get<Summary>('/food-conversion/summary')).data })
  useEffect(() => { if (sum.data && !deadline) setDeadline(sum.data.deadline) }, [sum.data]) // eslint-disable-line react-hooks/exhaustive-deps
  const { data: zones = [] } = useQuery({ queryKey: ['zones'], queryFn: async () => (await api.get<Zone[]>('/zones')).data })
  const filters = { q: dq.trim() || undefined, zone_id: zone || undefined, max_percent: maxPct === '' ? undefined : maxPct, reminded: reminded || undefined }
  const list = useInfiniteQuery({
    queryKey: ['food-conv-list', filters], initialPageParam: 0,
    queryFn: async ({ pageParam }) => (await api.get<List>('/food-conversion/customers', { params: { ...filters, limit: PAGE, offset: pageParam } })).data,
    getNextPageParam: (last, all) => { const n = all.reduce((a, p) => a + p.items.length, 0); return n < last.total ? n : undefined },
  })
  const rows = list.data?.pages.flatMap((p) => p.items) ?? []
  const total = list.data?.pages[0]?.total ?? 0
  const converted = useQuery({ queryKey: ['food-conv-converted'], enabled: showConverted, queryFn: async () => (await api.get<{ card_number: number; customer: string; days_done: number; converted_at: string }[]>('/food-conversion/converted')).data })

  const saveDeadline = useMutation({
    mutationFn: () => api.put('/food-conversion/deadline', { deadline }),
    onSuccess: () => { toast.success('Deadline saved'); qc.invalidateQueries({ queryKey: ['food-conv-summary'] }) },
    onError: (e) => toast.error(getErrorMessage(e)),
  })
  const convertNow = useMutation({
    mutationFn: () => api.post('/food-conversion/convert-now'),
    onSuccess: (r: any) => { toast.success(`${r.data.converted} food card(s) converted to Regular`); qc.invalidateQueries({ queryKey: ['food-conv-summary'] }); qc.invalidateQueries({ queryKey: ['food-conv-list'] }) },
    onError: (e) => toast.error(getErrorMessage(e)),
  })
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const s = sum.data

  return (
    <div className="flex min-h-dvh flex-col bg-green-50 dark:bg-night-800">
      <header className="flex items-center gap-3 px-4 py-3">
        <button onClick={() => navigate(-1)} aria-label="Back" className="flex h-9 w-9 items-center justify-center rounded-xl border border-green-200 bg-white dark:border-night-500 dark:bg-night-700"><ArrowLeft className="h-5 w-5 text-green-700 dark:text-night-100" /></button>
        <div><h1 className="text-lg font-extrabold text-green-900 dark:text-white">Food Conversion</h1><p className="text-xs text-green-500 dark:text-night-300">Food Collection Center</p></div>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-safe-nav">
        {/* Deadline */}
        <div className="rounded-2xl border border-green-100 bg-white p-4 dark:border-night-500 dark:bg-night-700">
          <div className="mb-2 flex items-center gap-2"><CalendarClock className="h-5 w-5 text-amber-500" /><p className="text-sm font-extrabold text-green-900 dark:text-white">Completion deadline</p>
            {s && <span className={cn('ml-auto rounded-full px-2.5 py-1 text-[11px] font-extrabold', s.passed ? 'bg-red-100 text-red-700' : s.days_left <= 14 ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700')}>{s.passed ? 'Deadline passed' : s.days_left === 0 ? 'Last day' : `${s.days_left} days left`}</span>}</div>
          <p className="mb-3 text-xs leading-relaxed text-green-600 dark:text-night-200">Every Food Card that is not complete after this day becomes a Regular Card automatically (the customer loses the food package for it, and the money becomes withdrawable). A nightly job does this just after midnight, Lagos time.</p>
          <div className="flex gap-2">
            <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} className="min-w-0 flex-1 rounded-xl border border-green-200 bg-white px-3 py-2.5 text-sm font-semibold text-green-900 dark:border-night-500 dark:bg-night-700 dark:text-white" />
            <button disabled={!deadline || deadline === s?.deadline || saveDeadline.isPending} onClick={() => saveDeadline.mutate()} className="rounded-xl bg-green-900 px-5 text-sm font-bold text-white disabled:opacity-40 dark:bg-night-100 dark:text-night-900">{saveDeadline.isPending ? '…' : 'Save'}</button>
          </div>
          {s?.passed && s.unfinished_cards > 0 && (
            <button disabled={convertNow.isPending} onClick={async () => { if (await ask(`${s.unfinished_cards} unfinished Food Card(s) will become Regular Cards right now. This cannot be undone.`, { title: 'Convert now?', tone: 'danger', confirmLabel: 'Convert now' })) convertNow.mutate() }} className="mt-3 w-full rounded-xl bg-red-600 py-2.5 text-sm font-bold text-white disabled:opacity-50">{convertNow.isPending ? 'Converting…' : `Convert ${s.unfinished_cards} card(s) now`}</button>
          )}
        </div>

        {/* Numbers */}
        <div className="grid grid-cols-3 gap-2">
          {[['Customers behind', s?.unfinished_customers], ['Unfinished cards', s?.unfinished_cards], ['Reminded today', s?.reminded_today]].map(([l, v]) => (
            <div key={l as string} className="rounded-2xl border border-green-100 bg-white p-3 dark:border-night-500 dark:bg-night-700"><p className="text-xl font-extrabold text-green-900 dark:text-white">{v ?? '–'}</p><p className="text-[11px] font-semibold text-green-500 dark:text-night-300">{l as string}</p></div>
          ))}
        </div>
        {s && (
          <div className="rounded-2xl border border-green-100 bg-white p-3 dark:border-night-500 dark:bg-night-700">
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-green-500 dark:text-night-300">How far behind (unfinished cards)</p>
            {[['Under 25%', 'under_25', 'bg-red-500'], ['25–50%', '25_to_50', 'bg-orange-400'], ['50–75%', '50_to_75', 'bg-amber-400'], ['75% and over', 'over_75', 'bg-green-500']].map(([l, k, c]) => {
              const n = s.buckets[k as string] ?? 0
              return <div key={k} className="mb-1.5 flex items-center gap-2 text-xs"><span className="w-24 shrink-0 font-semibold text-green-700 dark:text-night-100">{l}</span><span className="h-2.5 flex-1 overflow-hidden rounded-full bg-green-50 dark:bg-night-600"><span className={cn('block h-full rounded-full', c as string)} style={{ width: `${s.unfinished_cards ? (n / s.unfinished_cards) * 100 : 0}%` }} /></span><span className="w-8 text-right font-bold text-green-900 dark:text-white">{n}</span></div>
            })}
          </div>
        )}

        {/* Filters + bulk actions */}
        <div className="space-y-2">
          <div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-green-400" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, phone or customer number" className="w-full rounded-2xl border border-green-200 bg-white py-2.5 pl-10 pr-3 text-sm dark:border-night-500 dark:bg-night-700 dark:text-white" /></div>
          <div className="flex gap-2 overflow-x-auto no-scrollbar">
            <select value={maxPct} onChange={(e) => setMaxPct(e.target.value === '' ? '' : Number(e.target.value))} className="shrink-0 rounded-xl border border-green-200 bg-white px-3 py-2 text-xs font-bold text-green-800 dark:border-night-500 dark:bg-night-700 dark:text-white"><option value="">Any progress</option><option value="25">Under 25% done</option><option value="50">Under 50% done</option><option value="75">Under 75% done</option><option value="99">Not complete</option></select>
            <select value={reminded} onChange={(e) => setReminded(e.target.value as typeof reminded)} className="shrink-0 rounded-xl border border-green-200 bg-white px-3 py-2 text-xs font-bold text-green-800 dark:border-night-500 dark:bg-night-700 dark:text-white"><option value="">Reminded or not</option><option value="never">Never reminded</option><option value="reminded">Already reminded</option></select>
            <select value={zone} onChange={(e) => setZone(e.target.value)} className="shrink-0 rounded-xl border border-green-200 bg-white px-3 py-2 text-xs font-bold text-green-800 dark:border-night-500 dark:bg-night-700 dark:text-white"><option value="">All zones</option>{zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}</select>
          </div>
          <button disabled={total === 0} onClick={() => setCompose({ ids: 'all', label: `all ${total} customer${total === 1 ? '' : 's'} shown by these filters` })} className="flex w-full items-center justify-center gap-2 rounded-full bg-green-900 py-3 text-sm font-bold text-white disabled:opacity-40 dark:bg-night-100 dark:text-night-900"><Send className="h-4 w-4" />Remind everyone in this list ({total})</button>
        </div>

        {/* List */}
        <div className="overflow-hidden rounded-2xl border border-green-100 bg-white dark:border-night-500 dark:bg-night-700">
          {list.isLoading && <div className="h-24 animate-pulse bg-green-50 dark:bg-night-600" />}
          {list.isError && <p className="py-6 text-center text-sm text-red-600">Could not load. <button className="font-bold underline" onClick={() => list.refetch()}>Try again</button></p>}
          {!list.isLoading && !list.isError && rows.length === 0 && <p className="py-10 text-center text-sm text-green-500 dark:text-night-300">Nobody matches. Every food contributor here has finished, or the filters are too narrow.</p>}
          {rows.map((r) => (
            <div key={r.customer_id} className="flex items-start gap-3 border-b border-green-50 px-3 py-3 last:border-0 dark:border-night-600">
              <button onClick={() => toggle(r.customer_id)} aria-label={`Select ${r.full_name}`} aria-pressed={picked.has(r.customer_id)} className={cn('mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2', picked.has(r.customer_id) ? 'border-green-900 bg-green-900 text-white' : 'border-green-300 dark:border-night-400')}>{picked.has(r.customer_id) && <Check className="h-4 w-4" />}</button>
              <div className="min-w-0 flex-1">
                <button onClick={() => navigate(`/director/customers/${r.customer_number}`)} className="block max-w-full truncate text-left text-sm font-bold text-green-900 dark:text-white">{r.full_name} <span className="text-[11px] font-semibold text-green-400">#{r.customer_number}</span></button>
                <p className="text-xs text-green-500 dark:text-night-300">{r.phone_number}{r.zone_name ? ` · ${r.zone_name}` : ''}</p>
                {r.cards.map((c) => (
                  <div key={c.id} className="mt-1.5 flex items-center gap-2 text-[11px]"><span className="w-16 shrink-0 font-semibold text-green-700 dark:text-night-100">Card #{c.card_number}</span><span className="h-2 flex-1 overflow-hidden rounded-full bg-green-50 dark:bg-night-600"><span className={cn('block h-full rounded-full', c.percent < 25 ? 'bg-red-500' : c.percent < 50 ? 'bg-orange-400' : c.percent < 75 ? 'bg-amber-400' : 'bg-green-500')} style={{ width: `${c.percent}%` }} /></span><span className="w-20 shrink-0 text-right font-bold text-green-900 dark:text-white">{c.days_done}/{s?.total_days ?? 372}</span></div>
                ))}
                <p className="mt-1 text-[10px] text-green-400 dark:text-night-400">{r.last_reminded_at ? `Last reminded ${formatDateTime(r.last_reminded_at)}` : 'Never reminded'}</p>
              </div>
              <button onClick={() => setCompose({ ids: [r.customer_id], label: r.full_name })} aria-label={`Remind ${r.full_name}`} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600 active:scale-95 dark:bg-amber-900/30 dark:text-amber-400"><Bell className="h-4 w-4" /></button>
            </div>
          ))}
        </div>
        {list.hasNextPage && <button disabled={list.isFetchingNextPage} onClick={() => list.fetchNextPage()} className="w-full rounded-full border border-green-200 py-3 text-sm font-bold text-green-700 dark:border-night-500 dark:text-night-100">{list.isFetchingNextPage ? 'Loading…' : `Show more (${total - rows.length} left)`}</button>}

        {/* Already converted */}
        <button onClick={() => setShowConverted((v) => !v)} className="w-full py-2 text-xs font-bold text-green-600 underline dark:text-night-200">{showConverted ? 'Hide' : 'Show'} cards already converted automatically ({s?.auto_converted_total ?? 0})</button>
        {showConverted && (
          <div className="rounded-2xl border border-green-100 bg-white p-3 dark:border-night-500 dark:bg-night-700">
            {converted.isLoading && <p className="text-xs text-green-500">Loading…</p>}
            {converted.data?.length === 0 && <p className="text-xs text-green-500">Nothing has been converted automatically yet.</p>}
            {converted.data?.map((c) => <p key={c.card_number} className="border-b border-green-50 py-1.5 text-xs text-green-800 last:border-0 dark:border-night-600 dark:text-night-100"><b>{c.customer}</b> · Card #{c.card_number} · {c.days_done}/372 · {formatDateTime(c.converted_at)}</p>)}
          </div>
        )}
        <div className="h-20" />
      </div>

      <AnimatePresence>
        {picked.size > 0 && (
          <motion.div initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 80, opacity: 0 }} className="fixed inset-x-0 bottom-[calc(var(--bottom-nav-height,64px)+8px)] z-40 mx-auto flex w-[calc(100%-2rem)] max-w-lg items-center gap-2 rounded-2xl bg-green-950 p-3 shadow-2xl">
            <p className="flex-1 text-sm font-extrabold text-white">{picked.size} selected</p>
            <button onClick={() => setPicked(new Set())} className="px-2 text-xs font-bold text-green-200">Clear</button>
            <button onClick={() => setCompose({ ids: [...picked], label: `${picked.size} selected customer${picked.size > 1 ? 's' : ''}` })} className="flex items-center gap-1.5 rounded-full bg-amber-400 px-4 py-2.5 text-xs font-extrabold text-green-950"><Send className="h-4 w-4" />Remind selected</button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {compose && s && <ComposeSheet target={compose} template={s.template} filters={filters} onClose={() => setCompose(null)} onSent={() => { setCompose(null); setPicked(new Set()); qc.invalidateQueries({ queryKey: ['food-conv-summary'] }); qc.invalidateQueries({ queryKey: ['food-conv-list'] }) }} />}
      </AnimatePresence>
    </div>
  )
}

function ComposeSheet({ target, template, filters, onClose, onSent }: { target: { ids: string[] | 'all'; label: string }; template: string; filters: Record<string, unknown>; onClose: () => void; onSent: () => void }) {
  const [msg, setMsg] = useState(template)
  const [keep, setKeep] = useState(false)
  const [sample, setSample] = useState<{ sent: number; sample: string | null } | null>(null)
  const body = (dry: boolean) => ({ message: msg, dry_run: dry, save_as_default: !dry && keep, ...(target.ids === 'all' ? { everyone_matching: true, ...filters } : { customer_ids: target.ids }) })
  const preview = useMutation({ mutationFn: async () => (await api.post('/food-conversion/remind', body(true))).data, onSuccess: setSample, onError: (e) => toast.error(getErrorMessage(e)) })
  const send = useMutation({
    mutationFn: async () => (await api.post('/food-conversion/remind', body(false))).data,
    onSuccess: (r) => { toast.success(`Reminder sent to ${r.sent} customer(s)`); onSent() }, onError: (e) => toast.error(getErrorMessage(e)),
  })
  const valid = msg.trim().length >= 10
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={() => !send.isPending && onClose()}>
      <motion.div {...overlayMotion} className="absolute inset-0 bg-green-950/60" />
      <motion.div {...sheetMotion} role="dialog" aria-label="Write the reminder" className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-5 pb-8 dark:bg-night-700" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between"><p className="text-base font-extrabold text-green-900 dark:text-white">Warn food contributors</p><button onClick={onClose} aria-label="Close"><X className="h-5 w-5 text-green-400" /></button></div>
        <p className="mb-3 text-xs text-green-600 dark:text-night-200">To: {target.label}. They get this as a notification and a push. Edit it however you like.</p>
        <textarea value={msg} onChange={(e) => { setMsg(e.target.value); setSample(null) }} rows={7} maxLength={800} className="w-full rounded-xl border-2 border-green-100 bg-transparent px-3 py-2 text-sm text-green-900 dark:border-night-500 dark:text-white" />
        <div className="mt-2 flex flex-wrap gap-1.5">{PLACEHOLDERS.map((p) => <button key={p} onClick={() => setMsg((m) => m + p)} className="rounded-full bg-green-50 px-2.5 py-1 font-mono text-[11px] font-bold text-green-700 dark:bg-night-600 dark:text-night-100">{p}</button>)}</div>
        <p className="mt-1 text-[11px] text-green-500 dark:text-night-300">The tags fill in each customer’s own numbers.</p>
        {sample?.sample && <div className="mt-3 rounded-xl bg-amber-50 p-3 text-xs leading-relaxed text-amber-900 dark:bg-amber-950/30 dark:text-amber-200"><p className="mb-1 font-bold">Example of what one customer receives ({sample.sent} will get one):</p>{sample.sample}</div>}
        <label className="mt-3 flex items-center gap-2 text-xs font-semibold text-green-700 dark:text-night-100"><input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />Use this wording next time too</label>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button disabled={!valid || preview.isPending} onClick={() => preview.mutate()} className="rounded-full border-2 border-green-200 py-3 text-sm font-bold text-green-800 disabled:opacity-40 dark:border-night-500 dark:text-night-100">{preview.isPending ? '…' : 'Preview'}</button>
          <button disabled={!valid || send.isPending} onClick={async () => { if (target.ids !== 'all' || await ask(`Send this warning to ${target.label}?`, { title: 'Send to everyone?', confirmLabel: 'Send' })) send.mutate() }} className="rounded-full bg-green-900 py-3 text-sm font-bold text-white disabled:opacity-40 dark:bg-night-100 dark:text-night-900">{send.isPending ? 'Sending…' : 'Send'}</button>
        </div>
      </motion.div>
    </div>
  )
}
