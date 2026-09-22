import { useState, useRef, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, Send, Clock, Check, CheckCheck, Paperclip,
  X, FileText, ExternalLink, AlertTriangle
} from 'lucide-react'
import { api } from '@/lib/api'
import { cn, formatDateTime } from '@/lib/utils'
import { useAuthStore } from '@/store/auth.store'
import { Spinner } from '@/components/ui/Spinner'
import toast from 'react-hot-toast'
import type { DisputeDetail, DisputeMessage } from '@/types'
import { DISPUTE_REASON_LABEL } from '@/types'

type PendingMessage = {
  localId: string
  message: string
  attachment_url?: string | null
  attachment_name?: string | null
  attachment_size?: number | null
  failed?: boolean
}

export default function DisputeDetailPage() {
  const { disputeId } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { user } = useAuthStore()

  const [message, setMessage] = useState('')
  const [resolutionNote, setResolutionNote] = useState('')
  const [showResolveBox, setShowResolveBox] = useState(false)
  const [showEscalateBox, setShowEscalateBox] = useState(false)
  const [escalateReason, setEscalateReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<PendingMessage[]>([])

  // File attachment state
  const [attachment, setAttachment] = useState<{
    url: string
    name: string
    size: number
  } | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const { data: dispute, isLoading } = useQuery({
    queryKey: ['dispute', disputeId],
    queryFn: async () => {
      const { data } = await api.get<DisputeDetail>(`/disputes/${disputeId}`)
      return data
    },
    enabled: !!disputeId,
    refetchInterval: 3000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  })

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['dispute', disputeId] })
    qc.invalidateQueries({ queryKey: ['my-disputes'] })
    qc.invalidateQueries({ queryKey: ['worker-disputes'] })
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [dispute?.messages.length, pending.length])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (file.size > 8 * 1024 * 1024) {
      toast.error('File size must be under 8MB')
      return
    }

    setIsUploading(true)
    const reader = new FileReader()
    reader.onload = () => {
      setAttachment({
        url: reader.result as string,
        name: file.name,
        size: file.size,
      })
      setIsUploading(false)
      toast.success('File attached ✓')
    }
    reader.onerror = () => {
      setIsUploading(false)
      toast.error('Failed to read file')
    }
    reader.readAsDataURL(file)
  }

  const sendMessage = async (retry?: PendingMessage) => {
    const text = retry ? retry.message : message.trim()
    const currentAttachment = retry
      ? { url: retry.attachment_url!, name: retry.attachment_name!, size: retry.attachment_size! }
      : attachment

    if (!text && !currentAttachment) return
    const localId = retry ? retry.localId : `pending-${Date.now()}`

    if (retry) {
      setPending(p => p.map(m => m.localId === localId ? { ...m, failed: false } : m))
    } else {
      setMessage('')
      setAttachment(null)
      setPending(p => [
        ...p,
        {
          localId,
          message: text || (currentAttachment ? `Attached file: ${currentAttachment.name}` : ''),
          attachment_url: currentAttachment?.url,
          attachment_name: currentAttachment?.name,
          attachment_size: currentAttachment?.size,
        },
      ])
    }

    try {
      const payload: Record<string, any> = {
        message: text || (currentAttachment ? `Attached: ${currentAttachment.name}` : 'Sent an attachment'),
      }
      if (currentAttachment) {
        payload.attachment_url = currentAttachment.url
        payload.attachment_name = currentAttachment.name
        payload.attachment_size = currentAttachment.size
      }

      const { data } = await api.post<DisputeDetail>(`/disputes/${disputeId}/messages`, payload)
      qc.setQueryData(['dispute', disputeId], data)
      setPending(p => p.filter(m => m.localId !== localId))
      qc.invalidateQueries({ queryKey: ['my-disputes'] })
      qc.invalidateQueries({ queryKey: ['worker-disputes'] })
    } catch (err: any) {
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
      await api.post(`/disputes/${disputeId}/escalate`, { reason: escalateReason || undefined })
      toast.success('Dispute escalated to Director')
      setShowEscalateBox(false)
      setEscalateReason('')
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
  const isWorker    = user?.role === 'service_worker' && dispute.assigned_worker_id === user?.id
  const isUnclaimed = !dispute.assigned_to
  const canResolve  = dispute.status !== 'resolved' && dispute.can_resolve
  const canReply    = dispute.status !== 'resolved' && (isOwner || isDirector || isWorker || dispute.can_resolve)
  const canClaim    = isDirector && isUnclaimed
  const canEscalate = (isOwner || isWorker) && dispute.status !== 'escalated'

  const titleText = dispute.service_request_id
    ? 'Manual Service Dispute'
    : dispute.entity_type === 'wallet_transaction'
    ? 'Wallet transaction dispute'
    : 'Withdrawal dispute'

  return (
    <div className="min-h-dvh flex flex-col bg-green-50 dark:bg-night-800">
      <header className="flex items-center gap-3 px-4 py-3 shrink-0 bg-white/70 dark:bg-night-800/70 backdrop-blur border-b border-green-100 dark:border-night-700">
        <button onClick={() => navigate(-1)} className="w-9 h-9 bg-green-100 dark:bg-night-600 rounded-xl flex items-center justify-center">
          <ArrowLeft className="w-4 h-4 text-green-700 dark:text-night-100" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-green-900 dark:text-white font-bold text-base truncate">
            {titleText}
          </h1>
          <p className="text-green-600 dark:text-night-300 text-xs">
            {DISPUTE_REASON_LABEL[dispute.reason] || dispute.reason}
          </p>
        </div>
        <span
          className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
            dispute.status === 'resolved'
              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
              : dispute.status === 'escalated'
              ? 'bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300'
              : 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
          }`}
        >
          {dispute.status}
        </span>
      </header>

      {/* Chat scroll area */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-3">
        {dispute.is_escalated && (
          <div className="bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800 text-purple-800 dark:text-purple-200 text-xs font-semibold rounded-2xl p-3 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5 text-purple-600" />
            <div>
              <p>Escalated to Director Oversight</p>
              {dispute.escalation_reason && (
                <p className="font-normal text-[11px] mt-0.5 opacity-90">
                  Reason: {dispute.escalation_reason}
                </p>
              )}
            </div>
          </div>
        )}

        {isUnclaimed && dispute.status === 'escalated' && !dispute.is_escalated && (
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
            {p.attachment_name && (
              <div className="mt-1 text-[11px] opacity-80 flex items-center gap-1">
                <FileText className="w-3 h-3" />
                <span>{p.attachment_name}</span>
              </div>
            )}
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

      {/* Action buttons */}
      {canClaim && (
        <div className="px-4 pb-3 shrink-0">
          <button onClick={claim} disabled={busy} className="w-full bg-green-900 dark:bg-night-100 text-white dark:text-night-900 font-bold text-sm rounded-full py-3.5 disabled:opacity-60 shadow">
            {busy ? 'Claiming…' : 'Claim this dispute'}
          </button>
        </div>
      )}

      {canEscalate && !showEscalateBox && (
        <div className="px-4 pb-3 shrink-0">
          <button onClick={() => setShowEscalateBox(true)} className="w-full border-2 border-purple-300 dark:border-purple-800 text-purple-700 dark:text-purple-300 font-bold text-xs rounded-full py-2.5 hover:bg-purple-50 dark:hover:bg-purple-950/30 transition-colors">
            Escalate to Director
          </button>
        </div>
      )}

      {canEscalate && showEscalateBox && (
        <div className="px-4 pb-3 space-y-2 shrink-0">
          <textarea
            value={escalateReason}
            onChange={e => setEscalateReason(e.target.value)}
            placeholder="Reason for escalation (optional)..."
            rows={2}
            className="w-full rounded-xl border border-purple-200 dark:border-purple-800 bg-white dark:bg-night-700 px-3 py-2 text-xs text-green-900 dark:text-white outline-none"
          />
          <div className="flex gap-2">
            <button onClick={() => setShowEscalateBox(false)} className="flex-1 py-2 text-xs font-bold rounded-xl border border-green-200 dark:border-night-600 text-green-800 dark:text-night-300">
              Cancel
            </button>
            <button onClick={escalate} disabled={busy} className="flex-1 bg-purple-700 hover:bg-purple-800 text-white font-bold text-xs rounded-xl py-2 disabled:opacity-60 shadow">
              {busy ? 'Escalating...' : 'Confirm Escalate'}
            </button>
          </div>
        </div>
      )}

      {canResolve && !showResolveBox && (
        <div className="px-4 pb-3 shrink-0">
          <button onClick={() => setShowResolveBox(true)} className="w-full border-2 border-green-600 dark:border-night-200 text-green-700 dark:text-night-200 font-bold text-sm rounded-full py-3">
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

      {/* Reply input with file attachment button */}
      {canReply && (
        <div className="px-4 pb-6 space-y-2 shrink-0">
          {/* Attachment Preview Chip */}
          {attachment && (
            <div className="flex items-center justify-between p-2 rounded-xl bg-green-100 dark:bg-night-700 text-xs text-green-900 dark:text-white border border-green-200 dark:border-night-600">
              <div className="flex items-center gap-2 truncate max-w-[80%]">
                <FileText className="w-4 h-4 text-green-700 dark:text-brand-gold flex-shrink-0" />
                <span className="truncate font-medium">{attachment.name}</span>
              </div>
              <button
                type="button"
                onClick={() => setAttachment(null)}
                className="p-1 rounded-full hover:bg-green-200 dark:hover:bg-night-600 text-green-700 dark:text-night-200"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          <div className="flex items-center gap-2">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading || busy}
              className="w-11 h-11 bg-white dark:bg-night-700 rounded-full flex items-center justify-center shrink-0 border border-green-200 dark:border-night-600 text-green-700 dark:text-night-200 hover:bg-green-50 dark:hover:bg-night-600 active:scale-95 transition-all"
              title="Attach File"
            >
              <Paperclip className="w-4 h-4" />
            </button>

            <input
              value={message}
              onChange={e => setMessage(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && sendMessage()}
              placeholder={attachment ? 'Add message (optional)...' : 'Type a reply...'}
              className="flex-1 rounded-full border-2 border-green-100 dark:border-night-500 bg-white dark:bg-night-700 px-4 py-3 text-sm text-green-900 dark:text-white outline-none focus:border-green-600"
            />

            <button
              onClick={() => sendMessage()}
              disabled={busy || (!message.trim() && !attachment)}
              className="w-11 h-11 bg-green-900 dark:bg-night-100 text-white dark:text-night-900 rounded-full flex items-center justify-center shrink-0 disabled:opacity-40 transition-all active:scale-95"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function MessageBubble({ m, isMine }: { m: DisputeMessage; isMine: boolean }) {
  const isImage = m.attachment_url?.startsWith('data:image') || /\.(jpg|jpeg|png|webp|gif)$/i.test(m.attachment_url || '')

  return (
    <div
      className={cn(
        'max-w-[85%] rounded-2xl px-4 py-3 space-y-1.5',
        isMine
          ? 'ml-auto bg-green-900 dark:bg-night-100 text-white dark:text-night-900'
          : 'bg-white dark:bg-night-700 text-green-900 dark:text-white border border-green-100 dark:border-night-500'
      )}
    >
      <p className="text-xs font-bold opacity-70">{m.sender_name}</p>
      {m.message && <p className="text-sm leading-relaxed">{m.message}</p>}

      {/* Attachment rendering */}
      {m.attachment_url && (
        <div className="pt-1">
          {isImage ? (
            <a href={m.attachment_url} target="_blank" rel="noreferrer" className="block rounded-lg overflow-hidden border border-black/10 dark:border-white/10 max-h-48">
              <img src={m.attachment_url} alt={m.attachment_name || 'Attachment'} className="object-cover w-full h-full" />
            </a>
          ) : (
            <a
              href={m.attachment_url}
              target="_blank"
              rel="noreferrer"
              className={cn(
                'flex items-center gap-2 p-2 rounded-xl text-xs font-semibold underline-offset-2 hover:underline',
                isMine
                  ? 'bg-white/10 text-white dark:bg-night-900/10 dark:text-night-900'
                  : 'bg-green-50 dark:bg-night-800 text-green-800 dark:text-night-200'
              )}
            >
              <FileText className="w-4 h-4 flex-shrink-0" />
              <span className="truncate max-w-[200px]">{m.attachment_name || 'Download Attachment'}</span>
              <ExternalLink className="w-3 h-3 flex-shrink-0 ml-auto" />
            </a>
          )}
        </div>
      )}

      <div className={cn('flex items-center gap-1 pt-0.5', isMine ? 'justify-end' : 'justify-start')}>
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