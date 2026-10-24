import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ArrowLeft, Power, Wrench } from 'lucide-react'
import toast from '@/lib/notify'
import { api, getErrorMessage } from '@/lib/api'
import { useMaintenanceStore } from '@/store/maintenance.store'

const PRESETS = [{ l: '15 min', m: 15 }, { l: '30 min', m: 30 }, { l: '1 hour', m: 60 }, { l: '2 hours', m: 120 }]

export default function MaintenanceSwitchPage() {
  const nav = useNavigate()
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['maintenance'], queryFn: async () => (await api.get('/maintenance')).data })
  const [msg, setMsg] = useState('')
  const [mins, setMins] = useState<number | null>(null)
  const [sure, setSure] = useState(false)
  const on = !!data?.on
  const save = useMutation({
    mutationFn: (turnOn: boolean) => api.put('/maintenance', { on: turnOn, message: msg || undefined, eta: turnOn && mins ? new Date(Date.now() + mins * 60000).toISOString() : undefined }),
    onSuccess: (r) => {
      useMaintenanceStore.getState().set({ on: r.data.on, message: r.data.message, eta: r.data.eta, startedAt: r.data.started_at })
      qc.invalidateQueries({ queryKey: ['maintenance'] }); setSure(false)
      toast.success(r.data.on ? 'Maintenance is ON. Customers, officers and workers are paused.' : 'The app is open again.')
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  })
  return (
    <div className="flex min-h-dvh flex-col bg-green-50 dark:bg-night-800">
      <header className="flex items-center gap-3 px-4 py-3">
        <button onClick={() => nav(-1)} className="flex h-9 w-9 items-center justify-center rounded-full border border-green-100 bg-white dark:border-night-500 dark:bg-night-700" aria-label="Back"><ArrowLeft className="h-4 w-4 text-green-700 dark:text-night-100" /></button>
        <h1 className="text-lg font-extrabold text-green-900 dark:text-white">Maintenance</h1>
      </header>
      <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-safe-nav">
        <div className={`rounded-3xl p-5 text-white ${on ? 'bg-gradient-to-br from-red-600 to-red-800' : 'bg-gradient-to-br from-green-700 to-green-900'}`}>
          <div className="flex items-center gap-3"><div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/20"><Wrench className="h-6 w-6" /></div>
            <div><p className="text-xs font-bold uppercase text-white/80">Right now</p><p className="text-xl font-extrabold">{on ? 'Maintenance is ON' : 'The app is open'}</p></div></div>
          <p className="mt-3 text-sm text-white/90">{on ? 'Customers, officers and service workers see the maintenance screen. Directors and admins can still use everything. Payments from Monnify keep arriving.' : 'Everyone can use the app normally.'}</p>
        </div>
        {!on && (<>
          <div className="rounded-2xl border border-green-100 bg-white p-4 dark:border-night-500 dark:bg-night-700">
            <label className="text-xs font-bold text-green-800 dark:text-night-100">Message people will see (optional)</label>
            <textarea value={msg} onChange={(e) => setMsg(e.target.value)} rows={3} maxLength={300} placeholder="We are upgrading MonieKing. Your money is safe and we will be back shortly." className="mt-1 w-full rounded-xl border border-green-200 bg-white p-3 text-sm text-green-900 outline-none focus:border-green-500 dark:border-night-400 dark:bg-night-800 dark:text-white" />
            <p className="mb-1 mt-3 text-xs font-bold text-green-800 dark:text-night-100">About how long? (optional)</p>
            <div className="flex flex-wrap gap-2">{PRESETS.map((p) => <button key={p.m} onClick={() => setMins(mins === p.m ? null : p.m)} className={`rounded-full px-3.5 py-1.5 text-xs font-bold ${mins === p.m ? 'bg-green-700 text-white' : 'border border-green-200 text-green-800 dark:border-night-400 dark:text-night-100'}`}>{p.l}</button>)}</div>
          </div>
          {!sure ? <button onClick={() => setSure(true)} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-red-600 py-3.5 text-sm font-extrabold text-white active:scale-95"><Power className="h-4 w-4" />Turn maintenance ON</button> : (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 dark:border-red-500/40 dark:bg-red-500/10">
              <p className="flex items-center gap-2 text-sm font-extrabold text-red-700 dark:text-red-300"><AlertTriangle className="h-4 w-4" />Pause the app for everyone except directors?</p>
              <p className="mt-1 text-xs text-red-700/80 dark:text-red-200">Customers will not be able to contribute, withdraw or buy services until you turn this off.</p>
              <div className="mt-3 grid grid-cols-2 gap-2"><button onClick={() => setSure(false)} className="rounded-xl border border-red-300 py-2.5 text-sm font-bold text-red-700 dark:text-red-200">Cancel</button>
                <button disabled={save.isPending} onClick={() => save.mutate(true)} className="rounded-xl bg-red-600 py-2.5 text-sm font-extrabold text-white disabled:opacity-60">{save.isPending ? 'Turning on…' : 'Yes, pause the app'}</button></div></div>)}
        </>)}
        {on && <button disabled={save.isPending} onClick={() => save.mutate(false)} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-green-700 py-3.5 text-sm font-extrabold text-white active:scale-95 disabled:opacity-60"><Power className="h-4 w-4" />{save.isPending ? 'Opening…' : 'Turn maintenance OFF and open the app'}</button>}
        {on && data?.message && <p className="text-center text-xs text-green-700 dark:text-night-200">Showing: "{data.message}"</p>}
      </div>
    </div>
  )
}
