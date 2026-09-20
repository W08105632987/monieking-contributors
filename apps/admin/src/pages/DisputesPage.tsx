import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, MessageSquare, Send } from 'lucide-react'
import toast from 'react-hot-toast'
import { api, getErrorMessage } from '@/lib/api'
import { formatDateTime, cn } from '@/lib/utils'
import { Modal } from '@/components/ui/Modal'
import type { DisputeListItem, DisputeDetail } from '@/types'

const STATUS_TINT: Record<string, string> = {
  open: 'bg-amber-50 text-amber-600',
  under_review: 'bg-blue-50 text-blue-500',
  escalated: 'bg-red-50 text-red-500',
  resolved: 'bg-green-100 text-green-700',
}

export default function DisputesPage() {
  const qc = useQueryClient()
  const [statusFilter, setStatusFilter] = useState('')
  const [openDisputeId, setOpenDisputeId] = useState<string | null>(null)

  const { data: disputes, isLoading } = useQuery({
    queryKey: ['crm-disputes'],
    queryFn: async () => (await api.get<DisputeListItem[]>('/disputes')).data,
  })

  const filtered = (disputes ?? []).filter(d => !statusFilter || d.status === statusFilter)

  return (
    <div>
      <h1 className="text-green-900 dark:text-white font-extrabold text-2xl mb-1">Disputes</h1>
      <p className="text-green-500 dark:text-night-200 text-sm mb-6">Unclaimed queue and whatever you've personally claimed</p>

      <div className="flex items-center gap-2 mb-5">
        {['', 'open', 'under_review', 'escalated', 'resolved'].map(s => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className={cn('px-3.5 py-2 rounded-full text-xs font-bold whitespace-nowrap capitalize',
              statusFilter === s ? 'bg-green-900 dark:bg-copper-400 text-white dark:text-green-950' : 'bg-white dark:bg-night-700 border border-green-200 dark:border-night-500 text-green-600 dark:text-night-200')}>
            {s ? s.replace('_', ' ') : 'All'}
          </button>
        ))}
      </div>

      {isLoading && <div className="h-48 bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 animate-pulse" />}
      {!isLoading && filtered.length === 0 && (
        <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-8 text-center">
          <p className="text-green-500 dark:text-night-200 text-sm">No disputes here.</p>
        </div>
      )}
      <div className="space-y-2">
        {filtered.map(d => (
          <button
            key={d.id}
            onClick={() => setOpenDisputeId(d.id)}
            className="w-full text-left bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-4 flex items-center justify-between hover:bg-green-50/60 dark:hover:bg-night-600/60 transition-colors"
          >
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
              <div>
                <p className="text-green-900 dark:text-white font-semibold text-sm capitalize">{d.reason.replace(/_/g, ' ')}</p>
                <p className="text-green-400 dark:text-night-300 text-xs">{d.customer_name} · {d.entity_type.replace('_', ' ')} · {formatDateTime(d.created_at)}</p>
              </div>
            </div>
            <span className={cn('text-[11px] font-bold px-2 py-0.5 rounded-full capitalize', STATUS_TINT[d.status] ?? '')}>
              {d.status.replace('_', ' ')}
            </span>
          </button>
        ))}
      </div>

      {openDisputeId && (
        <DisputeDetailModal
          disputeId={openDisputeId}
          onClose={() => setOpenDisputeId(null)}
          onChanged={() => qc.invalidateQueries({ queryKey: ['crm-disputes'] })}
        />
      )}
    </div>
  )
}

function DisputeDetailModal({ disputeId, onClose, onChanged }: {
  disputeId: string
  onClose: () => void
  onChanged: () => void
}) {
  const qc = useQueryClient()
  const [message, setMessage] = useState('')
  const [resolution, setResolution] = useState('')

  const { data: dispute, isLoading } = useQuery({
    queryKey: ['crm-dispute', disputeId],
    queryFn: async () => (await api.get<DisputeDetail>(`/disputes/${disputeId}`)).data,
  })

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['crm-dispute', disputeId] })
    onChanged()
  }

  const claimMutation = useMutation({
    mutationFn: () => api.post(`/disputes/${disputeId}/claim`),
    onSuccess: () => { toast.success('Claimed'); refresh() },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const messageMutation = useMutation({
    mutationFn: () => api.post(`/disputes/${disputeId}/messages`, { message }),
    onSuccess: () => { setMessage(''); refresh() },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const resolveMutation = useMutation({
    mutationFn: () => api.post(`/disputes/${disputeId}/resolve`, { resolution_summary: resolution }),
    onSuccess: () => { toast.success('Dispute resolved'); refresh(); onClose() },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  return (
    <Modal title="Dispute" onClose={onClose}>
      {isLoading || !dispute ? (
        <div className="h-40 bg-green-50 dark:bg-night-600 rounded-xl animate-pulse" />
      ) : (
        <div>
          <div className="mb-4">
            <p className="text-green-900 dark:text-white font-bold text-sm capitalize">{dispute.reason.replace(/_/g, ' ')}</p>
            <p className="text-green-400 dark:text-night-300 text-xs">{dispute.customer_name} · {dispute.entity_type.replace('_', ' ')}</p>
            <span className={cn('inline-block mt-2 text-[11px] font-bold px-2 py-0.5 rounded-full capitalize', STATUS_TINT[dispute.status] ?? '')}>
              {dispute.status.replace('_', ' ')}
            </span>
          </div>

          {!dispute.assigned_to && dispute.status !== 'resolved' && (
            <button onClick={() => claimMutation.mutate()} disabled={claimMutation.isPending}
              className="w-full bg-green-900 dark:bg-copper-400 text-white dark:text-green-950 font-bold text-xs rounded-xl py-2.5 mb-4">
              {claimMutation.isPending ? 'Claiming…' : 'Claim this dispute'}
            </button>
          )}

          <div className="mb-4">
            <div className="flex items-center gap-1.5 mb-2">
              <MessageSquare className="w-3.5 h-3.5 text-green-500 dark:text-night-200" />
              <p className="text-green-500 dark:text-night-200 text-xs font-semibold uppercase tracking-wide">Messages</p>
            </div>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {dispute.messages.length === 0 && <p className="text-green-400 dark:text-night-300 text-xs">No messages yet.</p>}
              {dispute.messages.map(m => (
                <div key={m.id} className="bg-green-50 dark:bg-night-600 rounded-xl px-3 py-2">
                  <p className="text-green-900 dark:text-white text-xs font-semibold">{m.sender_name}</p>
                  <p className="text-green-700 dark:text-night-100 text-sm">{m.message}</p>
                  <p className="text-green-400 dark:text-night-300 text-[10px] mt-1">{formatDateTime(m.created_at)}</p>
                </div>
              ))}
            </div>
          </div>

          {dispute.can_resolve && (
            <>
              <div className="flex items-center gap-2 mb-4">
                <input value={message} onChange={e => setMessage(e.target.value)} placeholder="Send a message…"
                  className="flex-1 border border-green-200 dark:border-night-500 dark:bg-night-600 rounded-xl px-3 py-2 text-sm text-green-900 dark:text-white focus:outline-none focus:border-green-500" />
                <button onClick={() => messageMutation.mutate()} disabled={!message.trim() || messageMutation.isPending}
                  className="bg-green-900 dark:bg-copper-400 text-white dark:text-green-950 rounded-xl p-2.5 disabled:opacity-40">
                  <Send className="w-4 h-4" />
                </button>
              </div>

              <div>
                <label className="block text-green-500 dark:text-night-200 text-xs font-semibold uppercase tracking-wide mb-1.5">Resolve with summary</label>
                <textarea value={resolution} onChange={e => setResolution(e.target.value)} rows={3}
                  placeholder="How was this resolved?"
                  className="w-full border border-green-200 dark:border-night-500 dark:bg-night-600 rounded-xl px-3 py-2.5 text-sm text-green-900 dark:text-white focus:outline-none focus:border-green-500 mb-2" />
                <button onClick={() => resolveMutation.mutate()} disabled={!resolution.trim() || resolveMutation.isPending}
                  className="w-full bg-green-700 text-white font-bold text-xs rounded-xl py-2.5 disabled:opacity-40">
                  {resolveMutation.isPending ? 'Resolving…' : 'Mark as resolved'}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  )
}
