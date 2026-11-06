import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Bell, CheckCircle2, XCircle, Mail, MessageSquare, Radio, ChevronDown, Send } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from '@/lib/notify'
import { api, getErrorMessage } from '@/lib/api'
import { cn, formatDateTime } from '@/lib/utils'

interface Alert { id: string; severity: 'info' | 'warning' | 'critical'; category: string; title: string; detail: Record<string, unknown>; occurrences: number
  status: 'open' | 'acknowledged' | 'resolved'; created_at: string; last_seen_at: string; emailed_at: string | null; email_ok: boolean | null; resolved_at: string | null }
interface Channels { email_transport: string; from: string; reply_to: string | null; recipients: string[]; recipient_count: number; phones: number; sms_configured: boolean
  email_last_ok: string | null; email_last_fail: string | null; email_last_fail_reason: string | null; sms_last_ok: string | null; sms_last_fail: string | null
  heartbeat_configured: boolean; sentry_configured: boolean; problems: string[]; ready: boolean }

const SEV: Record<string, string> = {
  critical: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-200', warning: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200', info: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-200' }

export default function DirectorAlertsPage() {
  const nav = useNavigate()
  const qc = useQueryClient()
  const [tab, setTab] = useState<'active' | 'resolved'>('active')
  const [open, setOpen] = useState<string | null>(null)

  const { data } = useQuery({ queryKey: ['system-alerts', tab], refetchInterval: 30_000,
    queryFn: async () => (await api.get<{ alerts: Alert[]; active: number; critical: number }>('/system-alerts', { params: { status: tab } })).data })
  const { data: ch } = useQuery({ queryKey: ['system-alerts-status'], queryFn: async () => (await api.get<Channels>('/system-alerts/status')).data })
  const refresh = () => { qc.invalidateQueries({ queryKey: ['system-alerts'] }); qc.invalidateQueries({ queryKey: ['system-alerts-summary'] }); qc.invalidateQueries({ queryKey: ['system-alerts-status'] }) }

  const act = useMutation({ mutationFn: ({ id, what }: { id: string; what: 'acknowledge' | 'resolve' }) => api.post(`/system-alerts/${id}/${what}`),
    onSuccess: refresh, onError: (e) => toast.error(getErrorMessage(e)) })
  const test = useMutation({
    mutationFn: async (include_sms: boolean) => (await api.post<{ email_sent: boolean; recipients: string[]; email_last_fail_reason: string | null }>('/system-alerts/test', { include_sms })).data,
    onSuccess: (r) => { r.email_sent ? toast.success(`Test email sent to ${r.recipients.join(', ')}`) : toast.error(`Email NOT delivered: ${r.email_last_fail_reason ?? 'unknown reason'}`); refresh() },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const row = (label: string, ok: boolean, value: string) => (
    <div className="flex items-start gap-2 py-1.5 text-xs">
      {ok ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-600" /> : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />}
      <span className="w-24 shrink-0 font-semibold text-green-800 dark:text-night-100">{label}</span><span className="min-w-0 break-words text-green-600 dark:text-night-200">{value}</span>
    </div>
  )

  return (
    <div className="min-h-dvh flex flex-col bg-green-50 dark:bg-night-800">
      <header className="flex items-center gap-3 px-4 py-3">
        <button onClick={() => nav(-1)} aria-label="Back" className="flex h-9 w-9 items-center justify-center rounded-full border border-green-100 bg-white dark:border-night-500 dark:bg-night-700"><ArrowLeft className="h-4 w-4 text-green-700 dark:text-night-100" /></button>
        <h1 className="text-lg font-extrabold text-green-900 dark:text-white">System alerts</h1>
      </header>
      <div className="flex-1 overflow-y-auto px-4 pb-safe-nav">
        {/* Can the alert system actually reach you? */}
        <div className={cn('mb-4 rounded-2xl border p-4', ch?.ready ? 'border-green-100 bg-white dark:border-night-500 dark:bg-night-700' : 'border-red-300 bg-red-50 dark:border-red-500/50 dark:bg-red-500/10')}>
          <p className="mb-1 flex items-center gap-2 text-sm font-extrabold text-green-900 dark:text-white"><Bell className="h-4 w-4" />How alerts reach you</p>
          {ch && (
            <>
              {row('Email', ch.email_transport !== 'none', `${ch.email_transport === 'none' ? 'not configured' : ch.email_transport} · from ${ch.from}`)}
              {row('Recipients', ch.recipient_count > 0, ch.recipient_count ? ch.recipients.join(', ') : 'none: set ALERT_EMAIL_TO')}
              {row('Last email', !ch.email_last_fail || (!!ch.email_last_ok && ch.email_last_ok > ch.email_last_fail), ch.email_last_ok ? `worked ${formatDateTime(ch.email_last_ok)}` : 'never sent yet')}
              {ch.email_last_fail_reason && ch.email_last_fail && (!ch.email_last_ok || ch.email_last_fail > ch.email_last_ok) && row('Failure', false, ch.email_last_fail_reason)}
              {row('SMS', ch.sms_configured && ch.phones > 0, ch.sms_configured ? `${ch.phones} phone(s) for critical alerts` : 'not configured')}
              {row('Watchdog', ch.heartbeat_configured, ch.heartbeat_configured ? 'external heartbeat on' : 'none: nothing can tell you if the whole server is down')}
              {ch.problems.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-5 text-[11px] text-amber-800 dark:text-amber-200">{ch.problems.map(p => <li key={p}>{p}</li>)}</ul>}
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button disabled={test.isPending} onClick={() => test.mutate(false)} className="flex items-center justify-center gap-1.5 rounded-xl bg-green-900 py-2.5 text-xs font-bold text-white disabled:opacity-50 dark:bg-night-100 dark:text-night-900"><Mail className="h-3.5 w-3.5" />Send test email</button>
                <button disabled={test.isPending} onClick={() => test.mutate(true)} className="flex items-center justify-center gap-1.5 rounded-xl border-2 border-green-200 py-2.5 text-xs font-bold text-green-800 disabled:opacity-50 dark:border-night-500 dark:text-night-100"><MessageSquare className="h-3.5 w-3.5" />Test email + SMS</button>
              </div>
            </>
          )}
        </div>

        <div className="mb-3 flex gap-2">
          {(['active', 'resolved'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} className={cn('rounded-full border px-4 py-2 text-xs font-bold capitalize', tab === t ? 'border-transparent bg-green-900 text-white dark:bg-night-100 dark:text-night-900' : 'border-green-100 bg-white text-green-700 dark:border-night-500 dark:bg-night-700 dark:text-night-100')}>
              {t}{t === 'active' && data ? ` (${data.active})` : ''}
            </button>
          ))}
        </div>

        {data?.alerts.length === 0 && <p className="py-10 text-center text-sm text-green-500 dark:text-night-300">{tab === 'active' ? 'Nothing is wrong right now.' : 'No resolved alerts yet.'}</p>}
        {data?.alerts.map(a => (
          <div key={a.id} className="mb-2.5 overflow-hidden rounded-2xl border border-green-100 bg-white shadow-card dark:border-night-500 dark:bg-night-700">
            <button onClick={() => setOpen(open === a.id ? null : a.id)} className="flex w-full items-start gap-3 p-3.5 text-left">
              <span className={cn('mt-0.5 rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase', SEV[a.severity])}>{a.severity}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold leading-snug text-green-950 dark:text-white">{a.title}</span>
                <span className="mt-0.5 block text-[11px] text-green-500 dark:text-night-300">
                  {a.category} · first {formatDateTime(a.created_at)}{a.occurrences > 1 ? ` · seen ${a.occurrences}×` : ''}{a.email_ok === false ? ' · email FAILED' : a.emailed_at ? ' · emailed' : ''}
                </span>
              </span>
              <ChevronDown className={cn('mt-1 h-4 w-4 shrink-0 text-green-400 transition-transform', open === a.id && 'rotate-180')} />
            </button>
            {open === a.id && (
              <div className="border-t border-green-50 px-3.5 pb-3.5 pt-2 dark:border-night-600">
                {Object.entries(a.detail ?? {}).map(([k, v]) => (
                  <p key={k} className="py-0.5 text-xs"><span className="font-semibold text-green-700 dark:text-night-200">{k}: </span><span className="break-words text-green-600 dark:text-night-300">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span></p>
                ))}
                <p className="mt-1 text-[11px] text-green-400 dark:text-night-400">Last seen {formatDateTime(a.last_seen_at)}{a.resolved_at ? ` · resolved ${formatDateTime(a.resolved_at)}` : ''}</p>
                {a.status !== 'resolved' && (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button disabled={a.status === 'acknowledged' || act.isPending} onClick={() => act.mutate({ id: a.id, what: 'acknowledge' })} className="rounded-xl border-2 border-green-200 py-2 text-xs font-bold text-green-800 disabled:opacity-40 dark:border-night-500 dark:text-night-100">{a.status === 'acknowledged' ? 'Acknowledged' : 'I am on it'}</button>
                    <button disabled={act.isPending} onClick={() => act.mutate({ id: a.id, what: 'resolve' })} className="rounded-xl bg-green-700 py-2 text-xs font-bold text-white disabled:opacity-50">Mark resolved</button>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        <p className="flex items-center gap-1.5 py-4 text-[11px] text-green-400 dark:text-night-400"><Radio className="h-3 w-3" />Refreshes every 30 seconds. <Send className="h-3 w-3" />Recovered problems are resolved automatically.</p>
      </div>
    </div>
  )
}
