import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, AlertTriangle } from 'lucide-react'
import { api } from '@/lib/api'
import { cn, timeAgo } from '@/lib/utils'
import type { Dispute, DisputeStatus } from '@/types'
import { DISPUTE_REASON_LABEL } from '@/types'

const STATUS_STYLE: Record<DisputeStatus, string> = {
  open:          'bg-amber-50 text-amber-600',
  under_review:  'bg-amber-50 text-amber-600',
  escalated:     'bg-red-50 text-red-500',
  resolved:      'bg-green-100 dark:bg-night-600 text-green-600 dark:text-night-200',
}
const STATUS_LABEL: Record<DisputeStatus, string> = {
  open:          'Open',
  under_review:  'Under review',
  escalated:     'Escalated',
  resolved:      'Resolved',
}

export default function DisputesListPage() {
  const navigate = useNavigate()

  const { data: disputes = [], isLoading } = useQuery({
    queryKey: ['my-disputes'],
    queryFn: async () => {
      const { data } = await api.get<Dispute[]>('/disputes')
      return data
    },
  })

  return (
    <div className="min-h-dvh flex flex-col bg-green-50 dark:bg-night-800">
      <header className="flex items-center gap-3 px-4 py-3">
        <button onClick={() => navigate(-1)} className="w-9 h-9 bg-green-100 dark:bg-night-600 rounded-xl flex items-center justify-center">
          <ArrowLeft className="w-4 h-4 text-green-700 dark:text-night-100" />
        </button>
        <h1 className="text-green-900 dark:text-white font-bold text-lg">Disputes</h1>
      </header>

      <div className="flex-1 overflow-y-auto px-4 pb-10">
        {isLoading ? (
          <div className="space-y-3 mt-2">
            {[1, 2, 3].map(i => <div key={i} className="h-20 bg-white dark:bg-night-700 rounded-2xl animate-pulse" />)}
          </div>
        ) : disputes.length === 0 ? (
          <div className="text-center py-16">
            <AlertTriangle className="w-10 h-10 text-green-200 dark:text-night-400 mx-auto mb-3" />
            <p className="text-green-700 dark:text-night-100 font-semibold">No disputes</p>
            <p className="text-green-400 dark:text-night-300 text-sm mt-1">Nothing to see here — that's a good thing.</p>
          </div>
        ) : (
          <div className="space-y-3 mt-2">
            {disputes.map(d => (
              <button
                key={d.id}
                onClick={() => navigate(`/disputes/${d.id}`)}
                className="w-full text-left bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-4"
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className={cn('px-2.5 py-1 rounded-full text-xs font-bold', STATUS_STYLE[d.status])}>
                      {STATUS_LABEL[d.status]}
                    </span>
                    {d.is_worker_raised && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300">
                        Worker Dispute
                      </span>
                    )}
                  </div>
                  <span className="text-green-300 dark:text-night-400 text-xs">{timeAgo(d.created_at)}</span>
                </div>
                <p className="text-green-900 dark:text-white font-semibold text-sm">
                  {d.entity_type === 'manual_service'
                    ? 'Manual Identity Service'
                    : d.entity_type === 'wallet_transaction'
                    ? 'Wallet transaction'
                    : 'Withdrawal'}{' '}
                  · {d.customer_name}
                </p>
                <p className="text-green-400 dark:text-night-300 text-xs mt-0.5">
                  {DISPUTE_REASON_LABEL[d.reason] || (d.reason ? d.reason.replace(/_/g, ' ') : 'Dispute')}
                </p>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}