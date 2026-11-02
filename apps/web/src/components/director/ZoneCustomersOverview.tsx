import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRightLeft, Check, MapPinOff, Search, Users, X } from 'lucide-react'
import toast from '@/lib/notify'
import { ask } from '@/lib/dialog'
import { api, getErrorMessage } from '@/lib/api'
import { cn, formatDate, formatNaira } from '@/lib/utils'
import { sheetMotion, overlayMotion } from '@/lib/motion'
import type { Zone } from '@/types'

interface Item { id: string; customer_number: number; full_name: string; phone_number: string; joined_at: string; zone_id: string | null; zone_name: string | null; food_cards: number; regular_cards: number; saved_kobo: number; last_contribution_at: string | null; inactive: boolean }
interface Res {
  officer_name?: string; zone_name: string | null; zone_id: string | null; officer_type?: string | null; total: number; items: Item[]
  analytics: { total: number; food: number; regular: number; no_cards: number; inactive_30d: number; new_in_range: number; new_by_day: { day: string; count: number }[] }
}
const lagos = (offset = 0) => { const d = new Date(Date.now() + offset * 86400000); return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(d) }
const PAGE = 40

/** Customer Overview for one officer's zone (affiliated or salary): analytics, filters, and moving customers between zones. */
export function ZoneCustomersOverview({ officerId, affiliated }: { officerId: string; affiliated: boolean }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [card, setCard] = useState<'' | 'food' | 'regular' | 'none'>('')
  const [status, setStatus] = useState<'' | 'active' | 'inactive'>('')
  const [sort, setSort] = useState<'newest' | 'oldest' | 'name'>('newest')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [q, setQ] = useState('')
  const [dq, setDq] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [moving, setMoving] = useState(false)
  useEffect(() => { const t = setTimeout(() => setDq(q), 300); return () => clearTimeout(t) }, [q])

  const params = { start_date: from || undefined, end_date: to || undefined, card_type: card || undefined, status: status || undefined, q: dq.trim() || undefined, sort }
  const list = useInfiniteQuery({
    queryKey: ['zone-customers', officerId, params],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => (await api.get<Res>(`/director-zones/officers/${officerId}/customers`, { params: { ...params, limit: PAGE, offset: pageParam } })).data,
    getNextPageParam: (last, all) => { const n = all.reduce((a, p) => a + p.items.length, 0); return n < last.total ? n : undefined },
  })
  const head = list.data?.pages[0]
  const items = list.data?.pages.flatMap((p) => p.items) ?? []
  const a = head?.analytics
  const maxDay = Math.max(1, ...(a?.new_by_day.map((d) => d.count) ?? [1]))
  const preset = (label: string, f: string, t: string) => (
    <button key={label} onClick={() => { setFrom(f); setTo(t) }} className={cn('shrink-0 rounded-full border px-3 py-1.5 text-[11px] font-bold', from === f && to === t ? 'border-green-900 bg-green-900 text-white dark:border-night-100 dark:bg-night-100 dark:text-night-900' : 'border-green-200 text-green-700 dark:border-night-500 dark:text-night-100')}>{label}</button>
  )
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const allOnScreen = items.length > 0 && items.every((i) => picked.has(i.id))

  const refresh = () => { qc.invalidateQueries({ queryKey: ['zone-customers'] }); qc.invalidateQueries({ queryKey: ['customer-stats'] }); setPicked(new Set()) }
  const move = useMutation({
    mutationFn: (b: { zone_id: string | null; clear_commission: boolean }) => api.post('/director-zones/customers/move', { customer_ids: [...picked], ...b }),
    onSuccess: (r: any) => { toast.success(r.data.zone_name ? `${r.data.moved} customer(s) moved to ${r.data.zone_name}` : `${r.data.moved} customer(s) taken out of the zone`); setMoving(false); refresh() },
    onError: (e) => toast.error(getErrorMessage(e)),
  })
  const removeFromZone = async () => {
    const ok = await ask(`${picked.size} customer(s) will have no zone and no officer. They can still use the app, but nobody will mark their cards until you move them to a zone.`, { title: 'Remove from this zone?', tone: 'danger', confirmLabel: 'Remove' })
    if (ok) move.mutate({ zone_id: null, clear_commission: affiliated })
  }
  const tile = (label: string, value: number | undefined, on: boolean, onClick: () => void) => (
    <button onClick={onClick} className={cn('rounded-2xl border p-3 text-left transition active:scale-95', on ? 'border-green-900 bg-green-900 text-white dark:border-night-100 dark:bg-night-100 dark:text-night-900' : 'border-green-100 bg-white dark:border-night-500 dark:bg-night-700')}>
      <p className={cn('text-xl font-extrabold', on ? '' : 'text-green-900 dark:text-white')}>{value ?? '–'}</p><p className={cn('text-[11px] font-semibold', on ? 'opacity-80' : 'text-green-500 dark:text-night-300')}>{label}</p>
    </button>
  )

  return (
    <section className="mt-6 pb-24">
      <div className="mb-3 flex items-center gap-2"><Users className="h-5 w-5 text-green-700 dark:text-night-100" /><h2 className="text-base font-extrabold text-green-900 dark:text-white">Customer overview</h2>
        <span className="ml-auto text-xs font-semibold text-green-500 dark:text-night-300">{head?.zone_name ?? 'No zone'}</span></div>

      <div className="grid grid-cols-3 gap-2">
        {tile('Customers', a?.total, !card && !status, () => { setCard(''); setStatus('') })}
        {tile('Food', a?.food, card === 'food', () => setCard(card === 'food' ? '' : 'food'))}
        {tile('Regular only', a?.regular, card === 'regular', () => setCard(card === 'regular' ? '' : 'regular'))}
        {tile('No card yet', a?.no_cards, card === 'none', () => setCard(card === 'none' ? '' : 'none'))}
        {tile('Inactive 30d', a?.inactive_30d, status === 'inactive', () => setStatus(status === 'inactive' ? '' : 'inactive'))}
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-500/30 dark:bg-amber-950/30"><p className="text-xl font-extrabold text-amber-700 dark:text-amber-300">{a?.new_in_range ?? '–'}</p><p className="text-[11px] font-semibold text-amber-700/80 dark:text-amber-300/80">{from || to ? 'New in range' : 'New (all time)'}</p></div>
      </div>

      {/* New customers per day */}
      {a && a.new_by_day.length > 0 && (
        <div className="mt-3 rounded-2xl border border-green-100 bg-white p-3 dark:border-night-500 dark:bg-night-700">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-green-500 dark:text-night-300">New customers per day {from || to ? '' : '(last 30 days)'}</p>
          <div className="flex h-16 items-end gap-1 overflow-x-auto no-scrollbar">
            {a.new_by_day.map((d) => (
              <button key={d.day} onClick={() => { setFrom(d.day); setTo(d.day) }} title={`${d.day}: ${d.count}`} className="flex min-w-[14px] flex-1 flex-col items-center justify-end">
                <span className="text-[9px] font-bold text-green-700 dark:text-night-100">{d.count}</span>
                <span className="w-full rounded-t bg-green-600" style={{ height: `${Math.max(6, (d.count / maxDay) * 40)}px` }} />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="mt-3 space-y-2">
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
          {preset('All time', '', '')}{preset('Today', lagos(), lagos())}{preset('Yesterday', lagos(-1), lagos(-1))}{preset('Last 7 days', lagos(-6), lagos())}{preset('Last 30 days', lagos(-29), lagos())}
        </div>
        <div className="grid grid-cols-2 gap-2">
          {[['From', from, setFrom], ['To', to, setTo]].map(([l, v, set]) => (
            <label key={l as string} className="text-[10px] font-bold uppercase text-green-500 dark:text-night-300">{l as string}
              <input type="date" max={lagos()} value={v as string} onChange={(e) => (set as (x: string) => void)(e.target.value)} className="mt-0.5 w-full rounded-xl border border-green-200 bg-white px-2 py-2 text-sm font-semibold text-green-900 dark:border-night-500 dark:bg-night-700 dark:text-white" /></label>
          ))}
        </div>
        <div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-green-400" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, phone or customer number" className="w-full rounded-2xl border border-green-200 bg-white py-2.5 pl-10 pr-3 text-sm dark:border-night-500 dark:bg-night-700 dark:text-white" /></div>
        <div className="flex items-center gap-2">
          <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="rounded-xl border border-green-200 bg-white px-3 py-2 text-xs font-bold text-green-800 dark:border-night-500 dark:bg-night-700 dark:text-white"><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="name">Name A–Z</option></select>
          <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="rounded-xl border border-green-200 bg-white px-3 py-2 text-xs font-bold text-green-800 dark:border-night-500 dark:bg-night-700 dark:text-white"><option value="">Any activity</option><option value="active">Paid in last 30 days</option><option value="inactive">No payment in 30 days</option></select>
          <button onClick={() => (allOnScreen ? setPicked(new Set()) : setPicked(new Set(items.map((i) => i.id))))} className="ml-auto text-xs font-bold text-green-700 underline dark:text-night-100">{allOnScreen ? 'Clear' : 'Select all shown'}</button>
        </div>
      </div>

      {/* List */}
      <div className="mt-3 overflow-hidden rounded-2xl border border-green-100 bg-white dark:border-night-500 dark:bg-night-700">
        {list.isLoading && <div className="h-24 animate-pulse bg-green-50 dark:bg-night-600" />}
        {list.isError && <p className="py-6 text-center text-sm text-red-600">Could not load customers. <button className="font-bold underline" onClick={() => list.refetch()}>Try again</button></p>}
        {!list.isLoading && !list.isError && items.length === 0 && <p className="py-10 text-center text-sm text-green-500 dark:text-night-300">No customers match these filters.</p>}
        {items.map((c) => (
          <div key={c.id} className="flex items-center gap-3 border-b border-green-50 px-3 py-3 last:border-0 dark:border-night-600">
            <button onClick={() => toggle(c.id)} aria-label={`Select ${c.full_name}`} aria-pressed={picked.has(c.id)}
              className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2', picked.has(c.id) ? 'border-green-900 bg-green-900 text-white dark:border-night-100 dark:bg-night-100 dark:text-night-900' : 'border-green-300 dark:border-night-400')}>{picked.has(c.id) && <Check className="h-4 w-4" />}</button>
            <button onClick={() => navigate(`/director/customers/${c.customer_number}`)} className="min-w-0 flex-1 text-left">
              <p className="truncate text-sm font-bold text-green-900 dark:text-white">{c.full_name} <span className="text-[11px] font-semibold text-green-400">#{c.customer_number}</span></p>
              <p className="text-xs text-green-500 dark:text-night-300">{c.phone_number} · joined {formatDate(c.joined_at)}</p>
              <p className="mt-0.5 flex flex-wrap gap-1 text-[10px] font-bold">
                {c.food_cards > 0 && <span className="rounded-full bg-orange-100 px-2 py-0.5 text-orange-700">🍱 {c.food_cards} food</span>}
                {c.regular_cards > 0 && <span className="rounded-full bg-green-100 px-2 py-0.5 text-green-700">📋 {c.regular_cards} regular</span>}
                {c.food_cards + c.regular_cards === 0 && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-600">no card</span>}
                {c.inactive && <span className="rounded-full bg-red-50 px-2 py-0.5 text-red-600">inactive</span>}
                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-700">{formatNaira(c.saved_kobo)} saved</span>
              </p>
            </button>
          </div>
        ))}
      </div>
      {list.hasNextPage && <button disabled={list.isFetchingNextPage} onClick={() => list.fetchNextPage()} className="mt-3 w-full rounded-full border border-green-200 py-3 text-sm font-bold text-green-700 dark:border-night-500 dark:text-night-100">{list.isFetchingNextPage ? 'Loading…' : `Show more (${(head?.total ?? 0) - items.length} left)`}</button>}

      {/* Action bar when customers are ticked */}
      <AnimatePresence>
        {picked.size > 0 && (
          <motion.div initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 80, opacity: 0 }} className="fixed inset-x-0 bottom-[calc(var(--bottom-nav-height,64px)+8px)] z-40 mx-auto flex w-[calc(100%-2rem)] max-w-lg items-center gap-2 rounded-2xl bg-green-950 p-3 shadow-2xl">
            <p className="flex-1 text-sm font-extrabold text-white">{picked.size} selected</p>
            <button onClick={() => setMoving(true)} className="flex items-center gap-1.5 rounded-full bg-amber-400 px-4 py-2.5 text-xs font-extrabold text-green-950"><ArrowRightLeft className="h-4 w-4" />Move to a zone</button>
            <button onClick={removeFromZone} disabled={move.isPending} className="flex items-center gap-1.5 rounded-full bg-red-500 px-4 py-2.5 text-xs font-extrabold text-white disabled:opacity-60"><MapPinOff className="h-4 w-4" />Remove</button>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>{moving && <MoveSheet count={picked.size} currentZoneId={head?.zone_id ?? null} affiliated={affiliated} busy={move.isPending} onClose={() => setMoving(false)} onMove={(zone_id, clear_commission) => move.mutate({ zone_id, clear_commission })} />}</AnimatePresence>
    </section>
  )
}

function MoveSheet({ count, currentZoneId, affiliated, busy, onClose, onMove }: { count: number; currentZoneId: string | null; affiliated: boolean; busy: boolean; onClose: () => void; onMove: (zone: string, clear: boolean) => void }) {
  const { data: zones = [], isLoading } = useQuery({ queryKey: ['zones'], queryFn: async () => (await api.get<Zone[]>('/zones')).data })
  const [pick, setPick] = useState<string | null>(null)
  const [clear, setClear] = useState(false)
  const chosen = useMemo(() => zones.find((z) => z.id === pick), [zones, pick])
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={onClose}>
      <motion.div {...overlayMotion} className="absolute inset-0 bg-green-950/60" />
      <motion.div {...sheetMotion} role="dialog" aria-label="Move customers" className="relative max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-5 pb-8 dark:bg-night-700" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between"><p className="text-base font-extrabold text-green-900 dark:text-white">Move {count} customer{count > 1 ? 's' : ''} to…</p><button onClick={onClose} aria-label="Close"><X className="h-5 w-5 text-green-400" /></button></div>
        {isLoading && <div className="h-16 animate-pulse rounded-xl bg-green-50 dark:bg-night-600" />}
        <div className="space-y-2">
          {zones.map((z) => (
            <button key={z.id} onClick={() => setPick(z.id)} className={cn('flex w-full items-center justify-between rounded-xl border-2 px-3 py-3 text-left', pick === z.id ? 'border-green-900 bg-green-50 dark:border-night-100 dark:bg-night-600' : 'border-transparent bg-green-50 dark:bg-night-600')}>
              <span><span className="block text-sm font-bold text-green-900 dark:text-white">{z.name}{z.id === currentZoneId ? ' (this zone)' : ''}</span><span className="text-xs text-green-500 dark:text-night-300">{z.current_officer_name ? `Officer: ${z.current_officer_name}` : 'No officer yet'}</span></span>
              {pick === z.id && <Check className="h-5 w-5 text-green-700" />}
            </button>
          ))}
        </div>
        {affiliated && <label className="mt-3 flex items-start gap-2 text-xs font-semibold text-green-700 dark:text-night-100"><input type="checkbox" checked={clear} onChange={(e) => setClear(e.target.checked)} className="mt-0.5" />Also stop this officer earning commission on these customers</label>}
        <button disabled={!chosen || busy} onClick={() => chosen && onMove(chosen.id, clear)} className="mt-4 w-full rounded-full bg-green-900 py-3.5 text-sm font-bold text-white disabled:opacity-40 dark:bg-night-100 dark:text-night-900">{busy ? 'Moving…' : chosen ? `Move to ${chosen.name}` : 'Choose a zone'}</button>
        <p className="mt-2 text-center text-[11px] text-green-500 dark:text-night-300">Cards, money and history stay exactly as they are. The customer is told.</p>
      </motion.div>
    </div>
  )
}
