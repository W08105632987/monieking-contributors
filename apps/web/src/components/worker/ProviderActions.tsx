import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Send, Hourglass, X, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { api, getErrorMessage } from '@/lib/api'

interface Preview {
  available: boolean
  reason: string
  sent: boolean
  provider_service: boolean
  title: string
  params: { name: string; value: string }[]
  files: string[]
}

const LONG = { timeout: 70_000 }

/** Buttons on the worker's active job: send it to Techhub (for services that support it), or park it as
 *  "Awaiting outcome" when the worker has done their part and is waiting on someone else. */
export function ProviderActions({ jobId }: { jobId: string }) {
  const qc = useQueryClient()
  const [confirm, setConfirm] = useState(false)
  const [parkOpen, setParkOpen] = useState(false)
  const [note, setNote] = useState('')

  const preview = useQuery({
    queryKey: ['provider-preview', jobId],
    queryFn: async () => (await api.get<Preview>(`/provider/jobs/${jobId}/preview`)).data,
  })

  const refresh = () => {
    for (const k of ['worker-active-job', 'worker-my-jobs', 'provider-awaiting', 'provider-preview']) {
      qc.invalidateQueries({ queryKey: [k] })
    }
  }

  const send = useMutation({
    mutationFn: async () => (await api.post(`/provider/jobs/${jobId}/send`, {}, LONG)).data,
    onSuccess: (d: { unclear?: boolean }) => {
      setConfirm(false)
      toast.success(d?.unclear
        ? 'Sent, but Techhub’s answer was unclear. A director will check. Do not send it again.'
        : 'Sent to Techhub. It moves to Awaiting outcome and finishes by itself.')
      refresh()
    },
    onError: (e) => { setConfirm(false); toast.error(getErrorMessage(e)); refresh() },
  })

  const park = useMutation({
    mutationFn: async () => (await api.post(`/provider/jobs/${jobId}/await`, { note })).data,
    onSuccess: () => { setParkOpen(false); setNote(''); toast.success('Moved to Awaiting outcome.'); refresh() },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const p = preview.data
  return (
    <div className="space-y-2">
      {p?.provider_service && (
        p.available ? (
          <button
            type="button"
            disabled={send.isPending}
            onClick={() => setConfirm(true)}
            className="w-full py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow flex items-center justify-center gap-1.5 disabled:opacity-50"
          >
            <Send className="w-4 h-4" /> Send to Techhub
          </button>
        ) : p.reason && !p.sent ? (
          <p className="text-[11px] text-green-700 dark:text-night-300 px-1">{p.reason}</p>
        ) : null
      )}
      <button
        type="button"
        onClick={() => setParkOpen(true)}
        className="w-full py-2 px-3 rounded-xl border border-green-200 dark:border-night-600 text-green-900 dark:text-white text-xs font-bold flex items-center justify-center gap-1.5"
      >
        <Hourglass className="w-3.5 h-3.5" /> I'm done, now waiting for an outcome
      </button>

      {confirm && p && (
        <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/50 p-4" onClick={() => !send.isPending && setConfirm(false)}>
          <div className="w-full max-w-sm bg-white dark:bg-night-800 rounded-2xl p-5 space-y-3" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center">
              <h3 className="font-bold text-sm text-green-950 dark:text-white">Send {p.title} to Techhub?</h3>
              <button type="button" aria-label="Close" onClick={() => setConfirm(false)} disabled={send.isPending}><X className="w-4 h-4" /></button>
            </div>
            <div className="rounded-xl bg-green-50 dark:bg-night-900/60 p-3 space-y-1">
              {p.params.map(x => (
                <div key={x.name} className="flex justify-between gap-3 text-xs">
                  <span className="text-green-700 dark:text-night-300">{x.name.replace(/_/g, ' ')}</span>
                  <span className="font-semibold text-green-950 dark:text-white text-right break-all">{x.value}</span>
                </div>
              ))}
              {p.files.map(f => <p key={f} className="text-xs text-green-700 dark:text-night-300">Attached: {f}</p>)}
            </div>
            <p className="text-[11px] text-amber-700 dark:text-amber-300">Techhub charges us when this is sent. Check the details first. It can only be sent once.</p>
            <button
              type="button"
              disabled={send.isPending}
              onClick={() => send.mutate()}
              className="w-full py-3 rounded-xl bg-emerald-600 text-white text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {send.isPending ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending… please wait</> : 'Yes, send it'}
            </button>
          </div>
        </div>
      )}

      {parkOpen && (
        <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/50 p-4" onClick={() => !park.isPending && setParkOpen(false)}>
          <div className="w-full max-w-sm bg-white dark:bg-night-800 rounded-2xl p-5 space-y-3" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-sm text-green-950 dark:text-white">Move to Awaiting outcome</h3>
            <p className="text-xs text-green-700 dark:text-night-300">The job stays with you and does not return to the pool. The customer sees it as Processing. Resolve it later from the Awaiting tab.</p>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              rows={3}
              placeholder="What are you waiting for? e.g. NIMC to update the record"
              className="w-full rounded-xl border border-green-200 dark:border-night-600 bg-white dark:bg-night-900 p-3 text-sm"
            />
            <button
              type="button"
              disabled={park.isPending || note.trim().length < 5}
              onClick={() => park.mutate()}
              className="w-full py-3 rounded-xl bg-green-700 text-white text-sm font-bold disabled:opacity-50"
            >
              {park.isPending ? 'Saving…' : 'Move to Awaiting outcome'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
