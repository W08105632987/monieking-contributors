import { useQuery } from '@tanstack/react-query'
import { Eye, Hourglass, Send } from 'lucide-react'
import type { JobDetailData } from './ViewInfoModal'
import { api } from '@/lib/api'
import { formatNaira } from '@/lib/utils'

export interface AwaitingJob {
  id: string
  title: string
  price_kobo: number
  days_waiting: number
  via_provider: boolean
  ticket_status: string | null
  ticket_ref: string | null
  provider_note: string | null
  note: string | null
}

const TICKET_TEXT: Record<string, string> = {
  pending: 'Waiting for Techhub',
  unknown: 'Sent, waiting for a director to confirm',
  sending: 'Sending…',
}

/** Jobs this worker has finished their part of and that wait on an outside party. They never return to the pool. */
export function AwaitingList({ onResolve, onView, details = {} }: { onResolve: (id: string) => void; onView?: (id: string) => void; details?: Record<string, JobDetailData | undefined> }) {
  const { data = [], isLoading } = useQuery({
    queryKey: ['provider-awaiting'],
    queryFn: async () => (await api.get<AwaitingJob[]>('/provider/awaiting')).data,
    refetchInterval: 30_000,
  })
  if (isLoading) return <div className="py-12 text-center text-xs text-green-600 dark:text-night-400">Loading…</div>
  if (data.length === 0) {
    return (
      <div className="py-16 px-4 text-center rounded-2xl bg-white dark:bg-night-800 border border-green-100 dark:border-night-700 space-y-2">
        <Hourglass className="w-10 h-10 text-green-300 dark:text-night-500 mx-auto" />
        <h3 className="font-bold text-sm text-green-950 dark:text-white">Nothing awaiting an outcome</h3>
        <p className="text-xs text-green-700 dark:text-night-400">Jobs you send to Techhub, or park while waiting on someone else, wait here.</p>
      </div>
    )
  }
  return (
    <div className="space-y-3">
      {data.map(j => (
        <div key={j.id} className="p-4 rounded-2xl bg-white dark:bg-night-800 border border-green-100 dark:border-night-700 space-y-2">
          <div className="flex justify-between items-start gap-3">
            <div className="min-w-0">
              <h3 className="font-bold text-sm text-green-950 dark:text-white truncate">{j.title}</h3>
              <p className="text-xs text-green-700 dark:text-night-300 flex items-center gap-1">
                {j.via_provider ? <><Send className="w-3 h-3" /> {TICKET_TEXT[j.ticket_status ?? 'pending'] ?? 'Waiting for Techhub'}</> : 'Waiting on an outside party'}
                {' · '}{j.days_waiting === 0 ? 'today' : `${j.days_waiting} day${j.days_waiting === 1 ? '' : 's'}`}
              </p>
            </div>
            <span className="font-mono text-sm font-black text-amber-600 dark:text-amber-400">{formatNaira(j.price_kobo)}</span>
          </div>
          {(() => {
            // Two jobs of the same kind look identical by title alone: show who it is for and the first details.
            const d = details[j.id]
            if (!d) return null
            const bits = Object.entries(d.form_data ?? {}).filter(([, v]) => typeof v === 'string' || typeof v === 'number').slice(0, 2)
            return (
              <div className="rounded-xl bg-green-50 px-3 py-2 text-xs text-green-900 dark:bg-night-700 dark:text-night-100">
                <p className="font-bold">{d.customer_name ?? 'Customer'}{d.customer_phone ? ` · ${d.customer_phone}` : ''}</p>
                {bits.map(([k, v]) => <p key={k} className="truncate"><span className="opacity-70">{k.replace(/_/g, ' ')}:</span> {String(v)}</p>)}
                <p className="opacity-70">Requested {new Date(d.created_at).toLocaleString()}</p>
              </div>
            )
          })()}
          {(j.provider_note || j.note) && <p className="text-xs text-green-800 dark:text-night-200">{j.provider_note || j.note}</p>}
          {onView && (
            <button type="button" onClick={() => onView(j.id)} className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-green-200 py-2.5 text-xs font-bold text-green-900 dark:border-night-600 dark:text-white">
              <Eye className="h-4 w-4" /> View details
            </button>
          )}
          {j.via_provider ? (
            <p className="text-[11px] text-green-600 dark:text-night-400">This finishes by itself when Techhub answers. You are paid then.</p>
          ) : (
            <button type="button" onClick={() => onResolve(j.id)} className="w-full py-2.5 rounded-xl bg-green-700 text-white text-xs font-bold">
              Resolve job
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
