import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, CheckCircle2, XCircle, Clock, RotateCcw, History } from 'lucide-react'
import { api } from '@/lib/api'
import { formatNaira, timeAgo, cn } from '@/lib/utils'
import type { IdentityServiceRequest, IdentityServiceCategory, IdentityRequestStatus } from '@/types'
import { CATEGORY_LABEL, CATEGORY_ICON, CATEGORY_ORDER } from '@/lib/identityServices'
import { FallbackError } from '@/components/ui/FallbackError'
import { QuickActionsGrid } from '@/components/dashboard/QuickActionsGrid'

const STATUS_DOT: Record<IdentityRequestStatus, string> = {
  completed: 'bg-green-500',
  pending:   'bg-amber-400',
  failed:    'bg-red-400',
  reversed:  'bg-amber-400',
}
const STATUS_ICON: Record<IdentityRequestStatus, typeof CheckCircle2> = {
  completed: CheckCircle2, pending: Clock, failed: XCircle, reversed: RotateCcw,
}

export default function ServiceHistoryPage() {
  const navigate = useNavigate()
  // Present at two routes: /customer/services/history (own history, no param)
  // and /officer/customers/:customerId/services (an officer viewing one
  // customer's history). Same list/filter UI either way — only the query
  // target changes, which the backend's list_requests already supports
  // via the customer_id param (see identity_services.py).
  const { customerId } = useParams<{ customerId?: string }>()
  const [category, setCategory] = useState<IdentityServiceCategory | 'all'>('all')

  const { data: requests = [], isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['service-requests', customerId ?? 'self', category],
    queryFn: async () => {
      const { data } = await api.get<IdentityServiceRequest[]>('/identity-services/requests', {
        params: {
          ...(category === 'all' ? {} : { category }),
          ...(customerId ? { customer_id: customerId } : {}),
        },
      })
      return data
    },
  })

  return (
    <div className="min-h-dvh flex flex-col bg-green-50 dark:bg-night-800">
      <header className="flex items-center gap-3 px-4 py-3">
        <button onClick={() => navigate(-1)} className="w-9 h-9 bg-green-100 dark:bg-night-600 rounded-xl flex items-center justify-center">
          <ArrowLeft className="w-4 h-4 text-green-700 dark:text-night-100" />
        </button>
        <h1 className="text-green-900 dark:text-white font-bold text-lg">
          {customerId ? "Customer's service history" : 'Service history'}
        </h1>
      </header>

      {customerId && (
        <div className="px-4">
          <QuickActionsGrid customerId={customerId} title="New request" />
          <div className="h-px bg-green-100 dark:bg-night-500 my-5" />
        </div>
      )}

      {/* category filter chips — same tiles as the dashboard, so the mental model carries over */}
      <div className="flex gap-2 overflow-x-auto no-scrollbar px-4 pb-3">
        <button
          onClick={() => setCategory('all')}
          className={cn(
            'flex-shrink-0 px-3.5 py-2 rounded-full text-xs font-bold border',
            category === 'all'
              ? 'bg-green-900 dark:bg-amber-400 text-white dark:text-green-900 border-transparent'
              : 'bg-white dark:bg-night-700 text-green-700 dark:text-night-100 border-green-100 dark:border-night-500'
          )}
        >
          All
        </button>
        {CATEGORY_ORDER.map(cat => {
          const Icon = CATEGORY_ICON[cat]
          return (
            <button
              key={cat}
              onClick={() => setCategory(cat)}
              className={cn(
                'flex-shrink-0 flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-bold border',
                category === cat
                  ? 'bg-green-900 dark:bg-amber-400 text-white dark:text-green-900 border-transparent'
                  : 'bg-white dark:bg-night-700 text-green-700 dark:text-night-100 border-green-100 dark:border-night-500'
              )}
            >
              <Icon className="w-3.5 h-3.5" /> {CATEGORY_LABEL[cat]}
            </button>
          )
        })}
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-safe-nav">
        {isError ? (
          <FallbackError
            title="Couldn't load your history"
            onRetry={() => refetch()}
            isRetrying={isFetching}
          />
        ) : isLoading ? (
          <div className="space-y-2.5 mt-1">
            {[1, 2, 3, 4].map(i => <div key={i} className="h-[72px] bg-white dark:bg-night-700 rounded-2xl animate-pulse" />)}
          </div>
        ) : requests.length === 0 ? (
          <div className="text-center py-16">
            <History className="w-10 h-10 text-green-200 dark:text-night-400 mx-auto mb-3" />
            <p className="text-green-700 dark:text-night-100 font-semibold text-sm">No requests yet</p>
            <p className="text-green-400 dark:text-night-300 text-xs mt-1">
              Verifications and other requests you submit will show up here.
            </p>
          </div>
        ) : (
          <div className="space-y-2.5 mt-1">
            {requests.map(req => {
              const CategoryIcon = CATEGORY_ICON[req.service_category]
              const StatusIcon = STATUS_ICON[req.status]
              return (
                <button
                  key={req.id}
                  onClick={() => navigate(`/services/requests/${req.id}`)}
                  className="w-full flex items-center gap-3 bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-3.5 text-left"
                >
                  <div className="w-10 h-10 rounded-xl bg-green-100 dark:bg-night-600 flex items-center justify-center flex-shrink-0">
                    <CategoryIcon className="w-5 h-5 text-green-700 dark:text-night-100" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-green-900 dark:text-white text-sm font-bold truncate">{req.service_name}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className={cn('w-1.5 h-1.5 rounded-full', STATUS_DOT[req.status])} />
                      <p className="text-green-400 dark:text-night-300 text-xs">
                        {req.status === 'completed' ? 'Completed' : req.status === 'pending' ? 'Pending' : req.status === 'failed' ? 'Failed' : 'Reversed'}
                        {' · '}{timeAgo(req.created_at)}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <span className="text-green-900 dark:text-white text-sm font-bold">{formatNaira(req.amount_charged_kobo)}</span>
                    <StatusIcon className="w-3.5 h-3.5 text-green-300 dark:text-night-400" />
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
