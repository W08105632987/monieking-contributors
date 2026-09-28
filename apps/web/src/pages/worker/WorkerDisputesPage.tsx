import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, ChevronRight, RefreshCw, ShieldAlert, ChevronLeft } from 'lucide-react'
import { api } from '@/lib/api'
import { useAuthStore } from '@/store/auth.store'
import { WorkerHeader } from '@/components/worker/WorkerHeader'
import { cn } from '@/lib/utils'
import type { Dispute } from '@/types'

interface PaginatedDisputes {
  data: Dispute[]
  total: number
  page: number
  page_size: number
  has_next: boolean
}

export default function WorkerDisputesPage() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const [tab, setTab] = useState<'active' | 'resolved'>('active')
  const [page, setPage] = useState(1)

  const { data, isLoading } = useQuery<PaginatedDisputes>({
    queryKey: ['worker-disputes', tab, page],
    queryFn: async () => {
      const res = await api.get('/disputes/worker/mine', {
        params: {
          page,
          page_size: 20,
          include_resolved: tab === 'resolved',
          status: tab === 'resolved' ? 'resolved' : undefined,
        },
      })
      if (Array.isArray(res.data)) {
        return { data: res.data, total: res.data.length, page: 1, page_size: 20, has_next: false }
      }
      return res.data
    },
    refetchInterval: 15000,
  })

  const disputes = data?.data ?? []
  const total = data?.total ?? 0
  const totalPages = Math.ceil(total / 20) || 1

  return (
    <div className="min-h-dvh flex flex-col bg-surface dark:bg-night-900 pb-safe-nav text-green-950 dark:text-white">
      <WorkerHeader title="Disputes Hub" subtitle="Customer & operational job disputes" />

      <main className="flex-1 px-4 py-4 space-y-4 max-w-lg mx-auto w-full">
        {/* Info Banner */}
        <div className="p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200 text-xs flex items-start gap-2.5">
          <ShieldAlert className="w-4 h-4 flex-shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
          <p className="leading-relaxed">
            Communicate with customers on disputed services, or track disputes you raised with the Director regarding portal errors or invalid customer info.
          </p>
        </div>

        {/* Filter Tabs */}
        <div className="flex bg-green-100/70 dark:bg-night-800 p-1 rounded-xl gap-1">
          <button
            onClick={() => { setTab('active'); setPage(1) }}
            className={cn(
              'flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all',
              tab === 'active'
                ? 'bg-white dark:bg-night-700 text-green-950 dark:text-white shadow-sm'
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
                ? 'bg-white dark:bg-night-700 text-green-950 dark:text-white shadow-sm'
                : 'text-green-700 dark:text-night-300 hover:text-green-900'
            )}
          >
            Resolved History
          </button>
        </div>

        {/* Dispute List */}
        {isLoading ? (
          <div className="py-12 text-center text-xs text-green-600 dark:text-night-400">
            <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-green-600" />
            Loading disputes...
          </div>
        ) : disputes.length === 0 ? (
          <div className="py-14 px-4 text-center rounded-2xl bg-white dark:bg-night-800 border border-green-100 dark:border-night-700 space-y-2">
            <CheckCircle2 className="w-10 h-10 mx-auto text-emerald-500" />
            <h3 className="font-bold text-sm text-green-950 dark:text-white">
              {tab === 'active' ? 'Zero Active Disputes' : 'No Resolved Disputes'}
            </h3>
            <p className="text-xs text-green-700 dark:text-night-400 max-w-xs mx-auto">
              {tab === 'active' ? 'Great job! You have no open disputes needing action.' : 'No resolved dispute records found.'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {disputes.map((d) => {
              const isRaisedByWorker =
                d.raised_by === user?.id ||
                Boolean((d as any).is_worker_raised) ||
                (d as any).raised_by_role === 'service_worker'

              return (
                <div
                  key={d.id}
                  onClick={() => navigate(`/disputes/${d.id}`)}
                  className="p-4 rounded-2xl bg-white dark:bg-night-800 border border-green-100 dark:border-night-700 shadow-sm hover:shadow transition-all cursor-pointer flex items-center justify-between"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-green-950 dark:text-white">
                        {isRaisedByWorker ? 'You (Worker Dispute)' : d.customer_name}
                      </span>
                      <span
                        className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                          d.status === 'resolved'
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                            : d.status === 'escalated'
                            ? 'bg-purple-100 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300'
                            : 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
                        }`}
                      >
                        {d.status}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <span
                        className={`text-[10px] font-bold px-2 py-0.2 rounded-md ${
                          isRaisedByWorker
                            ? 'bg-blue-100 text-blue-800 dark:bg-blue-950/70 dark:text-blue-300'
                            : 'bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300'
                        }`}
                      >
                        {isRaisedByWorker ? 'Raised by you' : 'Raised by customer'}
                      </span>
                      <p className="text-xs text-green-700 dark:text-night-300">
                        Reason: {d.reason.replace(/_/g, ' ')}
                      </p>
                    </div>

                    <span className="text-[10px] text-green-500 dark:text-night-400 block">
                      Created {new Date(d.created_at).toLocaleDateString()}
                    </span>
                  </div>

                  <ChevronRight className="w-4 h-4 text-green-400 flex-shrink-0" />
                </div>
              )
            })}

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between pt-3 pb-2 text-xs text-green-700 dark:text-night-300">
                <button
                  disabled={page <= 1}
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white dark:bg-night-800 border border-green-200 dark:border-night-700 disabled:opacity-40"
                >
                  <ChevronLeft className="w-3.5 h-3.5" /> Previous
                </button>
                <span>Page {page} of {totalPages} ({total} total)</span>
                <button
                  disabled={!data?.has_next && page >= totalPages}
                  onClick={() => setPage(p => p + 1)}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white dark:bg-night-800 border border-green-200 dark:border-night-700 disabled:opacity-40"
                >
                  Next <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
