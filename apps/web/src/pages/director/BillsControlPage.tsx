import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowLeft, Smartphone } from 'lucide-react'
import toast from 'react-hot-toast'
import { useMutation } from '@tanstack/react-query'
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

export default function BillsControlPage() {
  const nav = useNavigate()
  const { data } = useBillsConfig()
  const save = useUpdateBillsConfig()
  const [cfg, setCfg] = useState<BillsConfig>(DEFAULT_BILLS_CONFIG)
  useEffect(() => { if (data) setCfg(data) }, [data])

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
        <p className="text-[11px] font-bold uppercase tracking-wide text-green-700 dark:text-night-200">Services</p>
        <div className={card}>
          <Switch on={cfg.airtime_enabled} onChange={(v) => set('airtime_enabled', v)} label="Airtime" />
          <Switch on={cfg.data_enabled} onChange={(v) => set('data_enabled', v)} label="Data" />
          <Switch on={cfg.data_standard_enabled} onChange={(v) => set('data_standard_enabled', v)} label="Standard data plans" hint="Regular data bundles" />
          <Switch on={cfg.data_vtu_enabled} onChange={(v) => set('data_vtu_enabled', v)} label="VTU data plans" hint="Plans with VTU in their name" />
          <Switch on={cfg.bills_enabled} onChange={(v) => set('bills_enabled', v)} label="Electricity & cable TV" />
        </div>

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
