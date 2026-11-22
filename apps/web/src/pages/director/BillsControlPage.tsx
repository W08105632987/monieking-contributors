import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowLeft, ChevronRight, Smartphone, RefreshCw, ShieldAlert } from 'lucide-react'
import toast from '@/lib/notify'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ask } from '@/lib/dialog'
import { withPin } from '@/lib/pin'
import { formatNaira } from '@/lib/utils'
import { api, getErrorMessage } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useBillsConfig, useUpdateBillsConfig, DEFAULT_BILLS_CONFIG, type BillsConfig } from '@/hooks/useBillPayments'
import { NetworkBadge, ALL_NETWORKS } from '@/components/NetworkBadge'

function Switch({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)}
      className="w-full flex items-center gap-3 py-3 text-left">
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-bold text-green-950 dark:text-white">{label}</span>
        {hint && <span className="block text-[11px] text-green-600 dark:text-night-300">{hint}</span>}
      </span>
      <span className={cn('relative h-6 w-11 rounded-full transition-colors', on ? 'bg-green-600' : 'bg-zinc-300 dark:bg-night-500')}>
        <motion.span layout transition={{ type: 'spring', stiffness: 500, damping: 30 }}
          className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow" style={{ left: on ? 22 : 2 }} />
      </span>
    </button>
  )
}

interface Readiness { ready: boolean; checks: { key: string; label: string; status: 'ok' | 'warn' | 'fail'; detail: string }[] }

function GoLiveCheck() {
  const run = useMutation({
    mutationFn: async () => (await api.get<Readiness>('/system-health/monnify-readiness')).data,
    onError: (e) => toast.error(getErrorMessage(e)),
  })
  const dot = { ok: 'bg-green-500', warn: 'bg-amber-400', fail: 'bg-red-500' } as const
  return (
    <div className="space-y-2">
      <p className="text-[11px] font-bold uppercase tracking-wide text-green-700 dark:text-night-200">Monnify go-live check</p>
      <button onClick={() => run.mutate()} disabled={run.isPending}
        className="w-full rounded-2xl border border-green-200 dark:border-night-500 bg-white dark:bg-night-700 py-3 text-sm font-bold text-green-900 dark:text-white">
        {run.isPending ? 'Checking Monnify…' : run.data ? 'Run again' : 'Run check'}
      </button>
      {run.data && (
        <div className="rounded-2xl bg-white dark:bg-night-700 border border-green-100 dark:border-night-500 px-4 divide-y divide-green-50 dark:divide-night-600">
          {run.data.checks.map((c) => (
            <div key={c.key} className="flex gap-3 py-3">
              <span className={cn('mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full', dot[c.status])} />
              <div className="min-w-0"><p className="text-sm font-bold text-green-950 dark:text-white">{c.label}</p><p className="text-[11px] text-green-700 dark:text-night-300">{c.detail}</p></div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const card = 'bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 px-4 divide-y divide-green-50 dark:divide-night-600'

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="flex rounded-xl bg-green-50 dark:bg-night-800 p-1 gap-1">
      {options.map(([k, l]) => (
        <button key={k} type="button" onClick={() => onChange(k)}
          className={cn('flex-1 rounded-lg py-2 text-xs font-bold', value === k ? 'bg-green-700 text-white' : 'text-green-800 dark:text-night-200')}>{l}</button>
      ))}
    </div>
  )
}

interface VtuStatus {
  configured: boolean
  balance_naira: number | null
  plans: number
  last_sync: string | null
  down_now: boolean
  monnify_down_now: boolean
  monnify_down_ttl_seconds?: number | null
  monnify_down_since?: number | null
  monnify_down_duration_seconds?: number | null
  vtu_down_ttl_seconds?: number | null
  vtu_down_since?: number | null
  vtu_down_duration_seconds?: number | null
  airtime_provider?: string
  airtime_active_provider?: string
  auto_failover?: boolean
  success: { completed: number; failed: number; success_rate: number | null; window_minutes: number } | null
}

/** The VTU supplier (GYKDATASUB): is it connected, what is in its wallet, sync plans, and the default markup for new plans. */
function VtuSupplierCard({ cfg, set, data }: { cfg: BillsConfig; set: <K extends keyof BillsConfig>(k: K, v: BillsConfig[K]) => void; data?: VtuStatus }) {
  const qc = useQueryClient()
  const sync = useMutation({
    mutationFn: async () => (await api.post<{ added: number; updated: number; deactivated: number; errors: string[]; below_cost: unknown[] }>('/bill-payments/admin/vtu/sync')).data,
    onSuccess: (r) => {
      r.errors.length ? toast.error(`Sync had problems: ${r.errors[0]}`) : toast.success(`Plans synced: ${r.added} new, ${r.updated} updated${r.deactivated ? `, ${r.deactivated} removed` : ''}`)
      if (r.below_cost.length) toast.error(`${r.below_cost.length} plan(s) now cost more than customers pay. Raise their prices.`)
      qc.invalidateQueries({ queryKey: ['vtu-status'] }); qc.invalidateQueries({ queryKey: ['bill-pricing'] }); qc.invalidateQueries({ queryKey: ['billers'] })
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  })
  const apply = useMutation({
    mutationFn: async (markup: number) => (await api.post<{ updated: number }>('/bill-payments/admin/vtu/apply-markup', { markup_percent: markup, clear_overrides: true })).data,
    onSuccess: (r) => { toast.success(`Markup applied to ${r.updated} VTU plans`); qc.invalidateQueries({ queryKey: ['bill-pricing'] }); qc.invalidateQueries({ queryKey: ['billers'] }); qc.invalidateQueries({ queryKey: ['bills-config'] }) },
    onError: (e) => toast.error(getErrorMessage(e)),
  })
  const low = data?.balance_naira != null && data.balance_naira < 10000
  return (
    <div className="rounded-2xl border border-green-100 dark:border-night-500 bg-white dark:bg-night-700 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className={cn('h-2.5 w-2.5 rounded-full', !data ? 'bg-zinc-300' : !data.configured ? 'bg-zinc-400' : data.down_now ? 'bg-red-500' : 'bg-green-500')} />
        <p className="flex-1 text-sm font-extrabold text-green-950 dark:text-white">VTU supplier (GYKDATASUB)</p>
        <span className="text-[11px] font-bold text-green-700 dark:text-night-200">{!data ? '…' : !data.configured ? 'Not set up' : data.down_now ? 'Down right now' : 'Connected'}</span>
      </div>
      {data && !data.configured && <p className="text-[11px] text-amber-700 dark:text-amber-300">Add GYK_API_KEY on the server to switch this on. Until then no VTU plans are shown to customers.</p>}
      {data?.configured && (
        <div className="grid grid-cols-3 gap-2 text-center">
          {[['Wallet', data.balance_naira != null ? formatNaira(Math.round(data.balance_naira * 100)) : 'unknown'], ['Plans', String(data.plans)], ['Success', data.success?.success_rate != null ? `${data.success.success_rate}%` : 'new']].map(([l, v]) => (
            <div key={l} className="rounded-xl bg-green-50 dark:bg-night-600 py-2"><p className="text-[10px] font-bold uppercase text-green-600 dark:text-night-300">{l}</p><p className={cn('text-sm font-extrabold', l === 'Wallet' && low ? 'text-red-600' : 'text-green-950 dark:text-white')}>{v}</p></div>
          ))}
        </div>
      )}
      {low && <p className="flex items-center gap-1.5 text-[11px] font-semibold text-red-600"><ShieldAlert className="h-3.5 w-3.5" />Wallet is low. Fund it so VTU purchases keep working.</p>}
      <button onClick={() => sync.mutate()} disabled={sync.isPending || !data?.configured}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-green-200 dark:border-night-500 py-2.5 text-xs font-bold text-green-900 dark:text-white disabled:opacity-50">
        <RefreshCw className={cn('h-3.5 w-3.5', sync.isPending && 'animate-spin')} />{sync.isPending ? 'Syncing…' : 'Sync VTU plans now'}
      </button>
      {data?.last_sync && <p className="text-[10px] text-green-600 dark:text-night-300">Plans and costs also sync every night. Last: {new Date(data.last_sync).toLocaleString()}</p>}
      <div>
        <p className="mb-1 text-[11px] font-semibold text-green-700 dark:text-night-200">Markup on VTU plans (% over the supplier's price)</p>
        <div className="flex gap-2">
          <input type="number" inputMode="decimal" min={0} max={100} value={cfg.vtu_default_markup_percent ?? 6} onChange={(e) => set('vtu_default_markup_percent', Number(e.target.value))}
            className="w-24 rounded-xl border border-green-100 dark:border-night-500 bg-white dark:bg-night-800 px-3 py-2 text-sm font-bold text-green-950 dark:text-white" />
          <button disabled={apply.isPending || !data?.plans} onClick={async () => {
            if (await ask(`Set every VTU plan to cost + ${cfg.vtu_default_markup_percent}%? This replaces any price you set by hand on a VTU plan. You can still change single plans afterwards in Prices & profit.`, { title: 'Apply to all VTU plans', confirmLabel: 'Apply to all' })) apply.mutate(cfg.vtu_default_markup_percent ?? 6)
          }} className="flex-1 rounded-xl bg-green-700 py-2 text-xs font-bold text-white disabled:opacity-50">{apply.isPending ? 'Applying…' : 'Apply to all VTU plans'}</button>
        </div>
        <p className="mt-1 text-[10px] text-green-600 dark:text-night-300">New plans start at this markup automatically. Edit any single plan under Prices & profit.</p>
      </div>
    </div>
  )
}

interface A2cRow { id: string; customer_name: string | null; network: string; phone: string; amount_kobo: number; payout_kobo: number; status: string; failure_reason: string | null; created_at: string }

interface PhantomAirtimeRow {
  id: string
  created_at: string | null
  biller_name: string
  phone_masked: string
  amount_naira: number
  status: string
  provider: string
  failed_over_from: string | null
  provider_reference: string | null
  failure_reason: string | null
  already_refunded: boolean
  needs_refund: boolean
}

function PhantomAirtimeReviewList() {
  const qc = useQueryClient()
  const { data = [] } = useQuery({
    queryKey: ['phantom-airtime'],
    refetchInterval: 30_000,
    queryFn: async () => (await api.get<PhantomAirtimeRow[]>('/bill-payments/admin/vtu/phantom-airtime')).data,
  })

  const needsRefund = data.filter((r) => r.needs_refund)
  const refundAll = useMutation({
    mutationFn: async () => (await api.post<{ refunded_count: number; total_amount_naira: number; refunded_ids: string[] }>('/bill-payments/admin/vtu/refund-phantom-airtime')).data,
    onSuccess: (res) => {
      toast.success(`Refunded ${res.refunded_count} airtime purchase(s) (₦${res.total_amount_naira.toFixed(2)})`)
      qc.invalidateQueries({ queryKey: ['phantom-airtime'] })
      qc.invalidateQueries({ queryKey: ['vtu-status'] })
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  if (needsRefund.length === 0) return null

  const totalNaira = needsRefund.reduce((s, r) => s + r.amount_naira, 0)

  const handleRefund = async () => {
    const ok = await ask(
      `Refund ${needsRefund.length} customer(s) a total of ₦${totalNaira.toFixed(2)}? These airtime purchases were debited during VTU provider downtime but were never delivered by the supplier.`,
      { title: 'Refund undelivered airtime?', confirmLabel: 'Yes, refund now', tone: 'danger' }
    )
    if (!ok) return
    refundAll.mutate()
  }

  return (
    <div className="rounded-2xl border border-amber-300 dark:border-amber-500/60 bg-amber-50 dark:bg-amber-500/10 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-extrabold text-amber-900 dark:text-amber-200">
            {needsRefund.length} Undelivered Airtime Purchase{needsRefund.length === 1 ? '' : 's'}
          </p>
          <p className="text-[11px] text-amber-700 dark:text-amber-300">
            Debited via VTU failover without provider confirmation.
          </p>
        </div>
        <button
          onClick={handleRefund}
          disabled={refundAll.isPending}
          className="rounded-xl bg-amber-600 hover:bg-amber-700 py-2 px-3 text-xs font-bold text-white shadow-sm disabled:opacity-50"
        >
          {refundAll.isPending ? 'Refunding…' : `Refund All (₦${totalNaira.toFixed(0)})`}
        </button>
      </div>
      <div className="space-y-2">
        {needsRefund.map((r) => (
          <div key={r.id} className="rounded-xl bg-white dark:bg-night-700 p-2.5 text-xs flex items-center justify-between">
            <div>
              <p className="font-bold text-green-950 dark:text-white">
                {r.biller_name} · ₦{r.amount_naira.toFixed(2)}
              </p>
              <p className="text-[11px] text-green-700 dark:text-night-300">
                To: {r.phone_masked} {r.created_at ? `· ${new Date(r.created_at).toLocaleTimeString()}` : ''}
              </p>
            </div>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300">
              Needs refund
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Airtime to Cash requests where the supplier's reply was unclear. NOTHING is paid until a director decides. */
function A2cReviewList() {
  const qc = useQueryClient()
  const { data = [] } = useQuery({ queryKey: ['a2c-review'], refetchInterval: 60_000, queryFn: async () => (await api.get<A2cRow[]>('/airtime-cash/admin/list', { params: { status: 'pending_review' } })).data })
  if (data.length === 0) return null
  const decide = async (r: A2cRow, approve: boolean) => {
    const ok = await ask(approve
      ? `Only approve if the supplier's own records show ${r.network} airtime of ${formatNaira(r.amount_kobo)} was taken from ${r.phone}. Approving credits ${r.customer_name ?? 'the customer'} ${formatNaira(r.payout_kobo)}.`
      : `Reject this request? ${r.customer_name ?? 'The customer'} will not be credited.`, { title: approve ? 'Pay this customer?' : 'Reject request', confirmLabel: approve ? 'Yes, pay them' : 'Reject', tone: 'danger' })
    if (!ok) return
    try {
      await withPin((pin) => api.post(`/airtime-cash/admin/${r.id}/${approve ? 'approve' : 'reject'}`, { pin }), { title: approve ? 'Approve payout' : 'Reject request', message: 'Enter your PIN to confirm.' })
      toast.success(approve ? 'Customer credited' : 'Rejected')
      qc.invalidateQueries({ queryKey: ['a2c-review'] })
    } catch (e) { toast.error(getErrorMessage(e)) }
  }
  return (
    <div className="rounded-2xl border border-amber-300 dark:border-amber-500/60 bg-amber-50 dark:bg-amber-500/10 p-4 space-y-3">
      <p className="text-sm font-extrabold text-amber-900 dark:text-amber-200">{data.length} Airtime to Cash request{data.length === 1 ? '' : 's'} need your decision</p>
      {data.map((r) => (
        <div key={r.id} className="rounded-xl bg-white dark:bg-night-700 p-3 text-xs space-y-1.5">
          <p className="font-bold text-green-950 dark:text-white">{r.customer_name ?? 'Customer'} · {r.network} {formatNaira(r.amount_kobo)} from {r.phone}</p>
          <p className="text-green-700 dark:text-night-200">Would be paid {formatNaira(r.payout_kobo)}. {r.failure_reason}</p>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => decide(r, false)} className="rounded-lg border border-red-200 py-2 font-bold text-red-600">Reject</button>
            <button onClick={() => decide(r, true)} className="rounded-lg bg-green-700 py-2 font-bold text-white">Pay customer</button>
          </div>
        </div>
      ))}
    </div>
  )
}

export default function BillsControlPage() {
  const nav = useNavigate()
  const { data } = useBillsConfig()
  const save = useUpdateBillsConfig()
  const [cfg, setCfg] = useState<BillsConfig>(DEFAULT_BILLS_CONFIG)
  useEffect(() => { if (data) setCfg(data) }, [data])

  const { data: vtuStatus } = useQuery({
    queryKey: ['vtu-status'],
    refetchInterval: 15_000,
    queryFn: async () => (await api.get<VtuStatus>('/bill-payments/admin/vtu/status')).data,
  })

  const set = <K extends keyof BillsConfig>(k: K, v: BillsConfig[K]) => setCfg((c) => ({ ...c, [k]: v }))
  const dirty = !!data && JSON.stringify(data) !== JSON.stringify(cfg)

  const submit = () => save.mutate(cfg, {
    onSuccess: () => toast.success('Bills settings saved — live now'),
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  return (
    <div className="min-h-dvh bg-green-50 dark:bg-night-800">
      <header className="flex items-center gap-3 px-4 py-3">
        <button onClick={() => nav(-1)} aria-label="Back" className="w-9 h-9 bg-green-100 dark:bg-night-600 rounded-xl flex items-center justify-center">
          <ArrowLeft className="w-4 h-4 text-green-700 dark:text-night-100" />
        </button>
        <div>
          <h1 className="text-green-900 dark:text-white font-bold text-lg">Airtime, Data & Bills</h1>
          <p className="text-[11px] text-green-600 dark:text-night-300">Changes apply to customers immediately</p>
        </div>
      </header>

      <div className="px-4 space-y-4 pb-40">
        <button onClick={() => nav('/director/bills-pricing')}
          className="w-full flex items-center gap-3 rounded-2xl px-4 py-3.5 text-left text-white" style={{ background: 'linear-gradient(135deg,#14532d,#166534)' }}>
          <span className="flex-1">
            <span className="block text-sm font-extrabold">Prices & profit</span>
            <span className="block text-[11px] text-green-100/85">Set what customers pay, see Monnify's commission and your profit</span>
          </span>
          <ChevronRight className="w-4 h-4" />
        </button>
        <p className="text-[11px] font-bold uppercase tracking-wide text-green-700 dark:text-night-200">Services</p>
        <div className={card}>
          <Switch on={cfg.airtime_enabled} onChange={(v) => set('airtime_enabled', v)} label="Airtime" />
          <Switch on={cfg.data_enabled} onChange={(v) => set('data_enabled', v)} label="Data" />
          <Switch on={cfg.data_standard_enabled} onChange={(v) => set('data_standard_enabled', v)} label="Standard data plans" hint="Monnify data bundles (including plans with VTU in their name)" />
          <Switch on={cfg.data_vtu_enabled} onChange={(v) => set('data_vtu_enabled', v)} label="VTU data plans" hint="The cheaper bundles from our VTU supplier" />
          <Switch on={cfg.bills_enabled} onChange={(v) => set('bills_enabled', v)} label="Electricity & cable TV" />
        </div>

        <PhantomAirtimeReviewList />

        <p className="text-[11px] font-bold uppercase tracking-wide text-green-700 dark:text-night-200">Airtime and data suppliers</p>
        <VtuSupplierCard cfg={cfg} set={set} data={vtuStatus} />
        <div className={cn(card, 'py-3 space-y-3 divide-y-0')}>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-sm font-bold text-green-950 dark:text-white">Airtime provider</p>
              {vtuStatus && (
                <span className={cn(
                  'text-[11px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1.5',
                  vtuStatus.airtime_active_provider === 'monnify'
                    ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                    : 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
                )}>
                  <span className={cn(
                    'h-1.5 w-1.5 rounded-full',
                    vtuStatus.airtime_active_provider === 'monnify' ? 'bg-green-500' : 'bg-blue-500 animate-pulse'
                  )} />
                  Active: {vtuStatus.airtime_active_provider === 'monnify' ? 'Monnify' : 'VTU (GYKDATASUB)'}
                </span>
              )}
            </div>
            <Segmented value={cfg.airtime_provider ?? 'monnify'} onChange={(v) => set('airtime_provider', v)} options={[['monnify', 'Monnify (preferred)'], ['vtu', 'VTU (GYKDATASUB)']]} />
            <p className="mt-1 text-[10px] text-green-600 dark:text-night-300">Who serves airtime first. Switch any time, for example during a network outage.</p>
            {vtuStatus?.monnify_down_now && (
              <div className="mt-2 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 p-2.5 text-xs text-amber-900 dark:text-amber-200 space-y-0.5">
                <p className="font-bold flex items-center gap-1.5">
                  <ShieldAlert className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                  Monnify is currently down
                </p>
                <p className="text-[11px] text-amber-800 dark:text-amber-300">
                  {vtuStatus.monnify_down_duration_seconds != null
                    ? `Down for ${Math.floor(vtuStatus.monnify_down_duration_seconds / 60)}m ${vtuStatus.monnify_down_duration_seconds % 60}s. `
                    : ''}
                  Failover to VTU is active. Monnify will be retried in {vtuStatus.monnify_down_ttl_seconds ?? 0}s.
                </p>
              </div>
            )}
            {vtuStatus?.down_now && (
              <div className="mt-2 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 p-2.5 text-xs text-red-900 dark:text-red-200 space-y-0.5">
                <p className="font-bold flex items-center gap-1.5">
                  <ShieldAlert className="h-3.5 w-3.5 text-red-600 shrink-0" />
                  VTU (GYKDATASUB) is currently down
                </p>
                <p className="text-[11px] text-red-800 dark:text-red-300">
                  {vtuStatus.vtu_down_duration_seconds != null
                    ? `Down for ${Math.floor(vtuStatus.vtu_down_duration_seconds / 60)}m ${vtuStatus.vtu_down_duration_seconds % 60}s. `
                    : ''}
                  Retry in {vtuStatus.vtu_down_ttl_seconds ?? 0}s.
                </p>
              </div>
            )}
          </div>
          <Switch on={cfg.provider_auto_failover ?? true} onChange={(v) => set('provider_auto_failover', v)} label="Switch automatically when one is down" hint="Airtime moves to the other supplier if the first one cannot serve it. It never retries something that might have been delivered." />
          <div>
            <p className="mb-1.5 text-sm font-bold text-green-950 dark:text-white">Data tab that opens first</p>
            <Segmented value={cfg.data_default_kind ?? 'vtu'} onChange={(v) => set('data_default_kind', v)} options={[['vtu', 'VTU plans'], ['standard', 'Standard plans']]} />
            <p className="mt-1 text-[10px] text-green-600 dark:text-night-300">If a supplier is down, customers automatically see the other tab.</p>
          </div>
        </div>

        <p className="text-[11px] font-bold uppercase tracking-wide text-green-700 dark:text-night-200">Airtime to Cash</p>
        <A2cReviewList />
        <div className={card}>
          <Switch on={cfg.a2c_enabled ?? false} onChange={(v) => set('a2c_enabled', v)} label="Let customers sell airtime for wallet cash" hint="Off by default. Web only: never shown in the Play Store app. Needs a verified account. The customer's SIM PIN passes through to the supplier and is never stored." />
        </div>
        {cfg.a2c_enabled && (
          <div className="grid grid-cols-2 gap-3">
            {([['a2c_margin_percent', 'Our cut (%)'], ['a2c_min_account_age_days', 'Account age (days)'], ['a2c_min_naira', 'Minimum (₦)'], ['a2c_max_naira', 'Per request max (₦)'], ['a2c_daily_max_naira', 'Per day max (₦)']] as const).map(([k, l]) => (
              <label key={k} className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 px-4 py-3">
                <span className="block text-[11px] font-semibold text-green-600 dark:text-night-300">{l}</span>
                <input type="number" inputMode="numeric" value={cfg[k] ?? 0} onChange={(e) => set(k, Number(e.target.value) || 0)} className="w-full bg-transparent outline-none font-bold text-green-950 dark:text-white" />
              </label>
            ))}
          </div>
        )}

        <p className="text-[11px] font-bold uppercase tracking-wide text-green-700 dark:text-night-200">Networks</p>
        <div className={card}>
          {ALL_NETWORKS.map((n) => (
            <div key={n} className="flex items-center gap-3">
              <NetworkBadge network={n} size={30} />
              <div className="flex-1"><Switch on={cfg.networks[n] !== false} onChange={(v) => set('networks', { ...cfg.networks, [n]: v })} label={n} /></div>
            </div>
          ))}
        </div>

        <p className="text-[11px] font-bold uppercase tracking-wide text-green-700 dark:text-night-200">Airtime limits (₦)</p>
        <div className="grid grid-cols-2 gap-3">
          {([['min_airtime_naira', 'Minimum'], ['max_airtime_naira', 'Maximum']] as const).map(([k, label]) => (
            <label key={k} className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 px-4 py-3">
              <span className="block text-[11px] font-semibold text-green-600 dark:text-night-300">{label}</span>
              <input type="number" inputMode="numeric" value={cfg[k]} onChange={(e) => set(k, Number(e.target.value) || 0)}
                className="w-full bg-transparent outline-none font-bold text-green-950 dark:text-white" />
            </label>
          ))}
        </div>

        <p className="text-[11px] font-bold uppercase tracking-wide text-green-700 dark:text-night-200">Notice banner</p>
        <label className="block bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 px-4 py-3">
          <textarea rows={2} maxLength={300} value={cfg.notice} onChange={(e) => set('notice', e.target.value)}
            placeholder="Optional message shown above the Airtime & Data forms (e.g. “MTN data is slow today”)"
            className="w-full bg-transparent outline-none text-sm text-green-950 dark:text-white resize-none" />
        </label>
        <GoLiveCheck />
        <p className="flex items-center gap-1.5 text-[11px] text-green-600 dark:text-night-300"><Smartphone className="w-3.5 h-3.5" />Phone number and network checks always run — they can't be turned off.</p>
      </div>

      <div className="fixed inset-x-0 z-30 bg-white/95 dark:bg-night-900/95 backdrop-blur border-t border-green-50 dark:border-night-700 px-4 py-3" style={{ bottom: 'var(--bottom-nav-height, 4.5rem)' }}>
        <button onClick={submit} disabled={!dirty || save.isPending}
          className="w-full rounded-2xl bg-green-900 py-3.5 font-bold text-white disabled:opacity-50">
          {save.isPending ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
        </button>
      </div>
    </div>
  )
}
