import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ChevronRight, FileText } from 'lucide-react'
import { api } from '@/lib/api'
import { formatNaira, cn } from '@/lib/utils'
import { BottomNav } from '@/components/layout/BottomNav'

interface ManualServiceRequestItem {
  id: string
  service_category: string
  service_type: string
  price_kobo: number
  status: 'pending' | 'processing' | 'successful' | 'failed'
  created_at: string
  claimed_at?: string | null
  completed_at?: string | null
  worker_remarks?: string | null
}

const STATUS_STYLE = {
  pending:    'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300',
  processing: 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300',
  successful: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300',
  failed:     'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300',
}

const STATUS_LABEL = {
  pending:    'Pending Worker',
  processing: 'In Progress',
  successful: 'Completed',
  failed:     'Failed',
}

export default function ManualServiceHistoryPage() {
  const navigate = useNavigate()
  const [statusFilter, setStatusFilter] = useState<string>('all')

  const { data, isLoading } = useQuery<{
    data: ManualServiceRequestItem[]
    total: number
  }>({
    queryKey: ['my-manual-service-requests', statusFilter],
    queryFn: async () => {
      const params: Record<string, string> = {}
      if (statusFilter !== 'all') params.service_status = statusFilter
      const res = await api.get('/manual-services/my-requests', { params })
      return res.data
    },
  })

  const requests = data?.data || []

  return (
    <div className="min-h-dvh flex flex-col bg-surface dark:bg-night-900 pb-24 text-green-950 dark:text-white">
      {/* Header */}
      <header className="sticky top-0 z-20 flex items-center gap-3 px-4 py-3 bg-white/80 dark:bg-night-800/80 backdrop-blur-md border-b border-green-100 dark:border-night-700">
        <button
          onClick={() => navigate(-1)}
          className="w-9 h-9 bg-green-50 dark:bg-night-700 rounded-xl flex items-center justify-center text-green-800 dark:text-white border border-green-100 dark:border-night-600"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h1 className="text-base font-black text-green-950 dark:text-white">
            Identity Service Requests
          </h1>
          <p className="text-xs text-green-700 dark:text-night-400">
            NIN, BVN, CAC, and verification application history
          </p>
        </div>
      </header>

      <main className="flex-1 px-4 py-4 space-y-4 max-w-lg mx-auto w-full">
        {/* Status Filter Pills */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
          {['all', 'pending', 'processing', 'successful', 'failed'].map((st) => (
            <button
              key={st}
              onClick={() => setStatusFilter(st)}
              className={cn(
                'px-3.5 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-colors border',
                statusFilter === st
                  ? 'bg-green-800 text-white border-green-800 shadow-sm'
                  : 'bg-white dark:bg-night-800 text-green-800 dark:text-night-300 border-green-200 dark:border-night-700'
              )}
            >
              {st === 'all' ? 'All Requests' : STATUS_LABEL[st as keyof typeof STATUS_LABEL]}
            </button>
          ))}
        </div>

        {/* List */}
        {isLoading ? (
          <div className="space-y-3 pt-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-24 bg-white dark:bg-night-800 rounded-2xl animate-pulse border border-green-100 dark:border-night-700" />
            ))}
          </div>
        ) : requests.length === 0 ? (
          <div className="py-16 text-center space-y-3 rounded-2xl bg-white dark:bg-night-800 border border-green-100 dark:border-night-700 p-6">
            <FileText className="w-10 h-10 text-green-300 dark:text-night-500 mx-auto" />
            <h3 className="font-bold text-sm text-green-950 dark:text-white">
              No Service Requests Found
            </h3>
            <p className="text-xs text-green-700 dark:text-night-400 max-w-xs mx-auto">
              You haven't submitted any manual identity service requests matching this filter.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {requests.map((req) => (
              <div
                key={req.id}
                onClick={() => navigate(`/customer/manual-services/requests/${req.id}`)}
                className="p-4 rounded-2xl bg-white dark:bg-night-800 border border-green-100 dark:border-night-700 shadow-sm hover:shadow transition-all cursor-pointer space-y-2.5"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <span
                      className={cn(
                        'text-[10px] font-bold uppercase px-2.5 py-0.5 rounded-full inline-block',
                        STATUS_STYLE[req.status]
                      )}
                    >
                      {STATUS_LABEL[req.status]}
                    </span>
                    <h3 className="font-bold text-sm text-green-950 dark:text-white mt-1">
                      {req.service_type || req.service_category.toUpperCase()}
                    </h3>
                    <p className="text-xs text-green-700 dark:text-night-400">
                      Category: {req.service_category.replace(/_/g, ' ')}
                    </p>
                  </div>

                  <div className="text-right">
                    <span className="font-mono font-black text-sm text-green-900 dark:text-brand-gold block">
                      {formatNaira(req.price_kobo)}
                    </span>
                    <span className="text-[10px] text-green-500 dark:text-night-400">
                      {new Date(req.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>

                <div className="pt-2 border-t border-green-50 dark:border-night-700 flex items-center justify-between text-xs">
                  <span className="text-green-600 dark:text-night-400">
                    Tap to view details & status timeline
                  </span>
                  <ChevronRight className="w-4 h-4 text-green-400 dark:text-night-400" />
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      <BottomNav />
    </div>
  )
}
