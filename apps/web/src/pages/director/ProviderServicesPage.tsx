import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, AlertTriangle } from 'lucide-react'
import toast from 'react-hot-toast'
import { getErrorMessage } from '@/lib/api'
import { FallbackError } from '@/components/ui/FallbackError'
import {
  getAttention, getProviderServices, putProviderService, resolveTicket,
  type Attention, type ProviderService,
} from '@/lib/providerApi'

const card = 'bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-4 mb-4'
const label = 'text-green-500 dark:text-night-300 text-xs font-semibold uppercase tracking-wide'
const input = 'w-full mt-1 rounded-xl border-2 border-green-100 dark:border-night-500 bg-white dark:bg-night-600 px-3 py-2.5 text-sm font-medium text-green-900 dark:text-white outline-none focus:border-green-400'

function Toggle({ on, onChange, text, hint }: { on: boolean; onChange: (v: boolean) => void; text: string; hint?: string }) {
  return (
    <div className="mt-3">
      <label className="flex items-center justify-between gap-3">
        <span className="text-green-900 dark:text-white text-sm font-semibold">{text}</span>
        <input type="checkbox" checked={on} onChange={e => onChange(e.target.checked)} className="w-5 h-5" />
      </label>
      {hint && <p className="text-green-500 dark:text-night-300 text-xs mt-1">{hint}</p>}
    </div>
  )
}

function ServiceCard({ svc, keySet }: { svc: ProviderService; keySet: boolean }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [enabled, setEnabled] = useState(svc.enabled)
  const [refund, setRefund] = useState(svc.refund_on_failure)
  const [alertDays, setAlertDays] = useState(String(svc.alert_after_days))
  const [pollMin, setPollMin] = useState(String(svc.poll_minutes))
  const [endpoint, setEndpoint] = useState(svc.endpoint)
  const [map, setMap] = useState<Record<string, string>>(svc.field_map)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    setEnabled(svc.enabled); setRefund(svc.refund_on_failure); setAlertDays(String(svc.alert_after_days))
    setPollMin(String(svc.poll_minutes)); setEndpoint(svc.endpoint); setMap(svc.field_map)
  }, [svc])

  const save = useMutation({
    mutationFn: () => putProviderService(svc.service_code, {
      enabled, refund_on_failure: refund, alert_after_days: Number(alertDays), poll_minutes: Number(pollMin),
      endpoint: endpoint.trim(), field_map: map,
    }),
    onSuccess: () => { toast.success('Saved'); qc.invalidateQueries({ queryKey: ['provider-admin'] }) },
    onError: e => toast.error(getErrorMessage(e)),
  })

  return (
    <div className={card}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-green-900 dark:text-white font-bold text-base">{svc.title}</p>
          <p className="text-green-500 dark:text-night-300 text-xs">
            {svc.template_exists
              ? (svc.template_enabled ? 'Service form is live for customers' : 'Service form exists but is switched off for customers')
              : 'Service form not created yet (see the setup note)'}
            {svc.open_tickets > 0 ? ` · ${svc.open_tickets} waiting at Techhub` : ''}
          </p>
        </div>
        {svc.template_exists && (
          <button type="button" onClick={() => navigate(`/director/service-builder/${svc.service_code}`)} className="text-xs font-bold text-green-700 dark:text-night-100 underline flex-shrink-0">
            Edit form &amp; price
          </button>
        )}
      </div>

      <Toggle on={enabled} onChange={setEnabled} text="Workers can send to Techhub"
        hint={keySet ? 'Off: workers handle this service by hand, exactly as before.' : 'The Techhub key is not set on the server, so this cannot be switched on yet.'} />
      <Toggle on={refund} onChange={setRefund} text="Refund the customer if Techhub fails the request"
        hint="On by default. Switch off only for a service where Techhub does not refund us. Failed requests are then closed without a refund." />

      <div className="grid grid-cols-2 gap-3 mt-3">
        <div>
          <span className={label}>Alert me after (days)</span>
          <input inputMode="numeric" value={alertDays} onChange={e => setAlertDays(e.target.value)} className={input} />
        </div>
        <div>
          <span className={label}>Check Techhub every (min)</span>
          <input inputMode="numeric" value={pollMin} onChange={e => setPollMin(e.target.value)} className={input} />
        </div>
      </div>

      <button type="button" onClick={() => setOpen(o => !o)} className="mt-3 text-xs font-bold text-green-700 dark:text-night-100 underline">
        {open ? 'Hide' : 'Show'} what is sent to Techhub
      </button>
      {open && (
        <div className="mt-2">
          <span className={label}>Techhub endpoint</span>
          <input value={endpoint} onChange={e => setEndpoint(e.target.value)} className={input} />
          <p className={`${label} mt-3`}>Techhub field ← form field</p>
          {Object.entries(map).map(([param, key]) => {
            const optional = key.startsWith('?')
            const bare = key.replace(/^\?/, '')
            return (
              <div key={param} className="mt-2">
                <span className="text-green-900 dark:text-white text-sm">{param}{optional ? ' (optional)' : ''}</span>
                <select
                  value={bare}
                  onChange={e => setMap(m => ({ ...m, [param]: (optional ? '?' : '') + e.target.value }))}
                  className={input}
                >
                  {[...new Set([bare, ...svc.form_keys])].map(k => <option key={k} value={k}>{k}</option>)}
                </select>
              </div>
            )
          })}
          {Object.keys(svc.file_params).length > 0 && (
            <p className="text-green-500 dark:text-night-300 text-xs mt-2">
              Files sent: {Object.entries(svc.file_params).map(([p, k]) => `${p} ← ${k.replace(/^\?/, '')}`).join(', ')}
            </p>
          )}
          {Object.keys(svc.applies_when).length > 0 && (
            <p className="text-green-500 dark:text-night-300 text-xs mt-2">
              Only used when: {Object.entries(svc.applies_when).map(([k, v]) => `${k} is ${v.join(' or ')}`).join('; ')}. Other requests stay manual.
            </p>
          )}
          <p className="text-green-500 dark:text-night-300 text-xs mt-2">If you rename or delete a form field in the Service Builder, come back here and point the matching Techhub field at the new one.</p>
        </div>
      )}

      <button type="button" disabled={save.isPending} onClick={() => save.mutate()}
        className="w-full mt-4 py-3 rounded-full bg-green-600 text-white font-bold text-sm disabled:opacity-50">
        {save.isPending ? 'Saving…' : 'Save'}
      </button>
    </div>
  )
}

function AttentionRow({ a }: { a: Attention }) {
  const qc = useQueryClient()
  const [ref, setRef] = useState('')
  const act = useMutation({
    mutationFn: (action: string) => resolveTicket(a.id, { action, ticket_ref: ref || undefined }),
    onSuccess: () => { toast.success('Done'); qc.invalidateQueries({ queryKey: ['provider-attention'] }); qc.invalidateQueries({ queryKey: ['provider-admin'] }) },
    onError: e => toast.error(getErrorMessage(e)),
  })
  const unclear = a.status === 'unknown' || a.status === 'sending'
  const btn = 'px-3 py-2 rounded-xl text-xs font-bold border border-green-200 dark:border-night-500 text-green-900 dark:text-white disabled:opacity-50'
  return (
    <div className="rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50/60 dark:bg-amber-950/20 p-3 mt-2">
      <p className="text-sm font-bold text-green-950 dark:text-white">{a.title}</p>
      <p className="text-xs text-green-700 dark:text-night-300">
        {unclear ? 'Sent, but Techhub’s answer was unclear. Check the Techhub dashboard.' : `Waiting ${a.days_waiting} days at Techhub${a.ticket_ref ? ` (ref ${a.ticket_ref})` : ''}.`}
        {a.note ? ` ${a.note}` : ''}
      </p>
      {unclear && (
        <div className="mt-2">
          <input value={ref} onChange={e => setRef(e.target.value)} placeholder="Techhub reference, if it went through" className={input} />
          <div className="flex flex-wrap gap-2 mt-2">
            <button type="button" className={btn} disabled={act.isPending || !ref.trim()} onClick={() => act.mutate('entered_reference')}>It went through</button>
            <button type="button" className={btn} disabled={act.isPending} onClick={() => { if (window.confirm('Only choose this if Techhub did NOT receive it. The worker will be able to send it again.')) act.mutate('not_sent') }}>It did not go through</button>
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-2 mt-2">
        <button type="button" className={btn} disabled={act.isPending} onClick={() => { if (window.confirm('Mark this as done? The worker is paid their commission.')) act.mutate('close_success') }}>Close as successful</button>
        <button type="button" className={btn} disabled={act.isPending} onClick={() => { if (window.confirm('Mark this as failed? The customer is refunded if this service’s refund switch is on.')) act.mutate('close_failed') }}>Close as failed</button>
      </div>
    </div>
  )
}

export default function ProviderServicesPage() {
  const navigate = useNavigate()
  const q = useQuery({ queryKey: ['provider-admin'], queryFn: getProviderServices })
  const att = useQuery({ queryKey: ['provider-attention'], queryFn: getAttention, refetchInterval: 60_000 })

  return (
    <div className="min-h-dvh flex flex-col bg-green-50 dark:bg-night-800">
      <header className="flex items-center gap-3 px-4 py-3">
        <button onClick={() => navigate(-1)} aria-label="Back" className="w-9 h-9 bg-green-100 dark:bg-night-600 rounded-xl flex items-center justify-center">
          <ArrowLeft className="w-4 h-4 text-green-700 dark:text-night-100" />
        </button>
        <h1 className="text-green-900 dark:text-white font-bold text-lg">Techhub services</h1>
      </header>
      <div className="flex-1 overflow-y-auto px-4 pb-safe-nav">
        {q.isError ? (
          <FallbackError title="Couldn't load" onRetry={() => q.refetch()} isRetrying={q.isFetching} />
        ) : !q.data ? (
          <div className="h-40 bg-white dark:bg-night-700 rounded-2xl animate-pulse" />
        ) : (
          <>
            {(att.data?.length ?? 0) > 0 && (
              <div className={card}>
                <p className="flex items-center gap-1.5 text-amber-700 dark:text-amber-300 text-sm font-bold"><AlertTriangle className="w-4 h-4" /> Needs your attention ({att.data!.length})</p>
                {att.data!.map(a => <AttentionRow key={a.id} a={a} />)}
              </div>
            )}
            <p className="text-green-600 dark:text-night-300 text-xs mb-3">
              These services still go through your service workers. When a worker claims one, a Send to Techhub button appears. The job then waits under that worker and finishes by itself when Techhub answers.
            </p>
            {q.data.services.map(s => <ServiceCard key={s.service_code} svc={s} keySet={q.data!.techhub_key_set} />)}
          </>
        )}
      </div>
    </div>
  )
}
