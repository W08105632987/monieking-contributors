import { useState, useRef, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Send, Clock, Check, CheckCheck } from 'lucide-react'
import { api } from '@/lib/api'
import { cn, formatDateTime } from '@/lib/utils'
import { useAuthStore } from '@/store/auth.store'
import { Spinner } from '@/components/ui/Spinner'
import toast from 'react-hot-toast'
import type { DisputeDetail, DisputeMessage } from '@/types'
import { DISPUTE_REASON_LABEL } from '@/types'

// A message still being sent — shown immediately (optimistic), replaced
// the moment the real one comes back from the server. Mirrors WhatsApp:
// clock while sending, single tick once sent, double tick once the other
// party has opened the thread (read_at gets set server-side on open).
type PendingMessage = { localId: string; message: string; failed?: boolean }

export default function DisputeDetailPage() {
  const { disputeId } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { user } = useAuthStore()
  const [message, setMessage] = useState('')
  const [resolutionNote, setResolutionNote] = useState('')
  const [showResolveBox, setShowResolveBox] = useState(false)
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<PendingMessage[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)

  const { data: dispute, isLoading } = useQuery({
    queryKey: ['dispute', disputeId],
    queryFn: async () => {
      const { data } = await api.get<DisputeDetail>(`/disputes/${disputeId}`)
      return data
    },
    enabled: !!disputeId,
    // No WebSocket in this backend yet, so this is the pragmatic stand-in
    // for "real time": poll every 3s while the thread is actually open
    // and the tab is visible, and refetch instantly the moment they tab
    // back in. Good enough for launch; a socket would be the real fix
    // later if message volume ever makes 3s feel slow.
    refetchInterval: 3000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  })

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['dispute', disputeId] })
    qc.invalidateQueries({ queryKey: ['my-disputes'] })
  }

  // Auto-scroll to the newest message — same as opening any chat app.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [dispute?.messages.length, pending.length])

  const sendMessage = async (retry?: PendingMessage) => {
    const text = retry ? retry.message : message.trim()
    if (!text) return
    const localId = retry ? retry.localId : `pending-${Date.now()}`

    if (retry) {
      setPending(p => p.map(m => m.localId === localId ? { ...m, failed: false } : m))
    } else {
      setMessage('')
      setPending(p => [...p, { localId, message: text }])
    }

    try {
      const { data } = await api.post<DisputeDetail>(`/disputes/${disputeId}/messages`, { message: text })
      // Write the confirmed message straight into cache FIRST, then drop
      // the pending bubble — in that order, on the same tick. Doing it
      // the other way (drop pending, then invalidate + wait for a
      // refetch) leaves a gap where the message is in neither list and
      // visibly vanishes for a moment.
      qc.setQueryData(['dispute', disputeId], data)
      setPending(p => p.filter(m => m.localId !== localId))
      qc.invalidateQueries({ queryKey: ['my-disputes'] })
    } catch (err: any) {
      // Leave it visible but marked failed, rather than silently losing
      // what they typed — same as WhatsApp's "tap to retry" red state.
      setPending(p => p.map(m => m.localId === localId ? { ...m, failed: true } : m))
      toast.error(err?.response?.data?.detail ?? 'Could not send message')
    }
  }

  const claim = async () => {
    setBusy(true)
    try {
      await api.post(`/disputes/${disputeId}/claim`)
      toast.success('Dispute claimed')
      refresh()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail ?? 'Could not claim')
    } finally {
      setBusy(false)
    }
  }

  const resolve = async () => {
    if (!resolutionNote.trim()) { toast.error('Add a resolution summary'); return }
    setBusy(true)
    try {
      await api.post(`/disputes/${disputeId}/resolve`, { resolution_summary: resolutionNote })
      toast.success('Dispute resolved')
      setShowResolveBox(false)
      setResolutionNote('')
      refresh()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail ?? 'Could not resolve')
    } finally {
      setBusy(false)
    }
  }

  const escalate = async () => {
    setBusy(true)
    try {
      await api.post(`/disputes/${disputeId}/escalate`)
      toast.success('Escalated to a director')
      refresh()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail ?? 'Could not escalate')
    } finally {
      setBusy(false)
    }
  }

  if (isLoading || !dispute) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-green-50 dark:bg-night-800">
        <Spinner size="lg" />
      </div>
    )
  }

  const isOwner     = user?.id === dispute.raised_by
  const isDirector  = user?.role === 'director' || user?.role === 'admin'
  const isUnclaimed = !dispute.assigned_to
  // can_resolve comes from the backend — it already encodes the real
  // authorization rule (zone-based for officers, claim-based for
  // directors), so this can't drift out of sync with what the server
  // will actually allow, the way a raw assigned_to compare could.
  const canResolve  = dispute.status !== 'resolved' && dispute.can_resolve
  const canReply    = dispute.status !== 'resolved' && (isOwner || isDirector || dispute.can_resolve)
  const canClaim    = isDirector && isUnclaimed
  const canEscalate = isOwner && dispute.status === 'resolved'

  return (
    <div className="min-h-dvh flex flex-col bg-green-50 dark:bg-night-800">
      <header className="flex items-center gap-3 px-4 py-3 shrink-0">
        <button onClick={() => navigate(-1)} className="w-9 h-9 bg-green-100 dark:bg-night-600 rounded-xl flex items-center justify-center">
          <ArrowLeft className="w-4 h-4 text-green-700 dark:text-night-100" />
        </button>
        <div>
          <h1 className="text-green-900 dark:text-white font-bold text-lg">
            {dispute.entity_type === 'wallet_transaction' ? 'Wallet transaction dispute' : 'Withdrawal dispute'}
          </h1>
          <p className="text-green-400 dark:text-night-300 text-xs">{DISPUTE_REASON_LABEL[dispute.reason]}</p>
        </div>
      </header>

      {/* This is the ONLY thing that scrolls — the header above and the
          input/action bars below stay fixed, same as any chat app. */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-4 pb-4 space-y-3">
        {isUnclaimed && dispute.status === 'escalated' && (
          <div className="bg-amber-50 text-amber-700 text-xs font-semibold rounded-xl px-4 py-3">
            Waiting for a director to pick this up.
          </div>
        )}

        {dispute.messages.map(m => (
          <MessageBubble key={m.id} m={m} isMine={m.sender_id === user?.id} />
        ))}

        {pending.map(p => (
          <div
            key={p.localId}
            onClick={() => p.failed && sendMessage(p)}
            className={cn(
              'max-w-[85%] ml-auto rounded-2xl px-4 py-3',
              p.failed ? 'bg-red-50 border-2 border-red-200 cursor-pointer' : 'bg-green-900/60 dark:bg-night-500/70'
            )}
          >
            <p className={cn('text-sm', p.failed ? 'text-red-500' : 'text-white dark:text-night-900')}>{p.message}</p>
            <div className="flex items-center justify-end gap-1 mt-1">
              {p.failed ? (
                <span className="text-[10px] text-red-500 font-semibold">Not sent — tap to retry</span>
              ) : (
                <>
                  <Clock className="w-3 h-3 text-white/70 dark:text-night-900/70" />
                  <span className="text-[10px] text-white/70 dark:text-night-900/70">Sending…</span>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {canClaim && (
        <div className="px-4 pb-3 shrink-0">
          <button onClick={claim} disabled={busy} className="w-full bg-green-900 dark:bg-night-100 text-white dark:text-night-900 font-bold text-sm rounded-full py-3.5 disabled:opacity-60">
            {busy ? 'Claiming…' : 'Claim this dispute'}
          </button>
        </div>
      )}

      {canEscalate && (
        <div className="px-4 pb-3 shrink-0">
          <button onClick={escalate} disabled={busy} className="w-full border-2 border-red-200 text-red-500 font-bold text-sm rounded-full py-3.5 disabled:opacity-60">
            {busy ? 'Escalating…' : 'I still disagree — escalate to a director'}
          </button>
        </div>
      )}

      {canResolve && !showResolveBox && (
        <div className="px-4 pb-3 shrink-0">
          <button onClick={() => setShowResolveBox(true)} className="w-full border-2 border-green-600 dark:border-night-200 text-green-700 dark:text-night-200 font-bold text-sm rounded-full py-3.5">
            Resolve this dispute
          </button>
        </div>
      )}

      {canResolve && showResolveBox && (
        <div className="px-4 pb-3 space-y-2 shrink-0">
          <textarea
            value={resolutionNote}
            onChange={e => setResolutionNote(e.target.value)}
            placeholder="Summarize the resolution — the customer will see this"
            rows={3}
            className="w-full rounded-xl border-2 border-green-100 dark:border-night-500 bg-white dark:bg-night-700 px-4 py-3 text-sm text-green-900 dark:text-white"
          />
          <button onClick={resolve} disabled={busy} className="w-full bg-green-900 dark:bg-night-100 text-white dark:text-night-900 font-bold text-sm rounded-full py-3.5 disabled:opacity-60">
            {busy ? 'Resolving…' : 'Confirm resolution'}
          </button>
        </div>
      )}

      {canReply && (
        <div className="px-4 pb-6 flex items-center gap-2 shrink-0">
          <input
            value={message}
            onChange={e => setMessage(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && sendMessage()}
            placeholder="Type a reply..."
            className="flex-1 rounded-full border-2 border-green-100 dark:border-night-500 bg-white dark:bg-night-700 px-4 py-3 text-sm text-green-900 dark:text-white"
          />
          <button onClick={() => sendMessage()} disabled={busy} className="w-12 h-12 bg-green-900 dark:bg-night-100 rounded-full flex items-center justify-center shrink-0 disabled:opacity-60">
            <Send className="w-4 h-4 text-white dark:text-night-900" />
          </button>
        </div>
      )}
    </div>
  )
}

function MessageBubble({ m, isMine }: { m: DisputeMessage; isMine: boolean }) {
  return (
    <div
      className={cn(
        'max-w-[85%] rounded-2xl px-4 py-3',
        isMine
          ? 'ml-auto bg-green-900 dark:bg-night-100 text-white dark:text-night-900'
          : 'bg-white dark:bg-night-700 text-green-900 dark:text-white border border-green-100 dark:border-night-500'
      )}
    >
      <p className="text-xs font-bold opacity-70 mb-1">{m.sender_name}</p>
      <p className="text-sm">{m.message}</p>
      <div className={cn('flex items-center gap-1 mt-1', isMine ? 'justify-end' : 'justify-start')}>
        <p className="text-[10px] opacity-60">{formatDateTime(m.created_at)}</p>
        {isMine && (
          m.read_at
            ? <CheckCheck className="w-3.5 h-3.5 text-sky-300" />
            : <Check className="w-3.5 h-3.5 opacity-60" />
        )}
      </div>
    </div>
  )
}