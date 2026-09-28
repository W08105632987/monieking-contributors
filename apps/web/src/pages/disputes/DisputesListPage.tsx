import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react'
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

interface PaginatedDisputes {
  data: Dispute[]
  total: number
  page: number
  page_size: number
  has_next: boolean
}

export default function DisputesListPage() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<'active' | 'resolved'>('active')
  const [page, setPage] = useState(1)

  const { data, isLoading } = useQuery<PaginatedDisputes>({
    queryKey: ['my-disputes', tab, page],
    queryFn: async () => {
      const res = await api.get('/disputes', {
        params: {
          page,
          page_size: 20,
          include_resolved: tab === 'resolved',
          status: tab === 'resolved' ? 'resolved' : undefined,
        },
      })
      // Normalize response if direct array or paginated object
      if (Array.isArray(res.data)) {
        return { data: res.data, total: res.data.length, page: 1, page_size: 20, has_next: false }
      }
      return res.data
    },
  })

  const disputes = data?.data ?? []
  const total = data?.total ?? 0
  const totalPages = Math.ceil(total / 20) || 1

  return (
    <div className="min-h-dvh flex flex-col bg-green-50 dark:bg-night-800">
      <header className="flex items-center gap-3 px-4 py-3 border-b border-green-100/60 dark:border-night-700">
        <button onClick={() => navigate(-1)} className="w-9 h-9 bg-green-100 dark:bg-night-600 rounded-xl flex items-center justify-center">
          <ArrowLeft className="w-4 h-4 text-green-700 dark:text-night-100" />
        </button>
        <h1 className="text-green-900 dark:text-white font-bold text-lg">Disputes</h1>
      </header>

      {/* Filter Tabs: Active vs Resolved History */}
      <div className="px-4 pt-3 pb-1">
        <div className="flex bg-green-100/70 dark:bg-night-700/60 p-1 rounded-xl gap-1 max-w-sm">
          <button
            onClick={() => { setTab('active'); setPage(1) }}
            className={cn(
              'flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all',
              tab === 'active'
                ? 'bg-white dark:bg-night-600 text-green-900 dark:text-white shadow-sm'
                : 'text-green-700 dark:text-night-300 hover:text-green-900'
            )}
          >
            Open & Active
          </button>
          <button
            onClick={() => { setTab('resolved'); setPage(1) }}
            className={cn(
              'flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all',
              tab === 'resolved'
                ? 'bg-white dark:bg-night-600 text-green-900 dark:text-white shadow-sm'
                : 'text-green-700 dark:text-night-300 hover:text-green-900'
            )}
          >
            Resolved History
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-safe-nav">
        {isLoading ? (
          <div className="space-y-3 mt-2">
            {[1, 2, 3].map(i => <div key={i} className="h-20 bg-white dark:bg-night-700 rounded-2xl animate-pulse" />)}
          </div>
        ) : disputes.length === 0 ? (
          <div className="text-center py-16">
            <AlertTriangle className="w-10 h-10 text-green-200 dark:text-night-400 mx-auto mb-3" />
            <p className="text-green-700 dark:text-night-100 font-semibold">
              {tab === 'active' ? 'No active disputes' : 'No resolved disputes'}
            </p>
            <p className="text-green-400 dark:text-night-300 text-sm mt-1">
              {tab === 'active' ? "Nothing needs attention — that's a good thing." : 'No past resolved dispute records found.'}
            </p>
          </div>
        ) : (
          <div className="space-y-3 mt-2">
            {disputes.map(d => (
              <button
                key={d.id}
                onClick={() => navigate(`/disputes/${d.id}`)}
                className="w-full text-left bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-4 transition-transform active:scale-[0.99]"
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

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between pt-4 pb-2 text-xs text-green-700 dark:text-night-300">
                <button
                  disabled={page <= 1}
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white dark:bg-night-700 border border-green-200 dark:border-night-600 disabled:opacity-40"
                >
                  <ChevronLeft className="w-3.5 h-3.5" /> Previous
                </button>
                <span>Page {page} of {totalPages} ({total} total)</span>
                <button
                  disabled={!data?.has_next && page >= totalPages}
                  onClick={() => setPage(p => p + 1)}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white dark:bg-night-700 border border-green-200 dark:border-night-600 disabled:opacity-40"
                >
                  Next <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}