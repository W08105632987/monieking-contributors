import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, CheckCircle2, XCircle, Clock, RotateCcw, History, ChevronRight, ShieldCheck, FileText, Receipt, Fingerprint } from 'lucide-react'
import { api } from '@/lib/api'
import { formatNaira, timeAgo, cn } from '@/lib/utils'
import { FallbackError } from '@/components/ui/FallbackError'
import { QuickActionsGrid } from '@/components/dashboard/QuickActionsGrid'

/** One row of the unified feed served by GET /history. */
export interface HistoryItem {
  key: string
  source: 'identity' | 'manual' | 'bill' | 'verification'
  id: string
  title: string
  category: string
  status: 'completed' | 'pending' | 'failed' | 'reversed'
  amount_kobo: number
  created_at: string
  detail?: string | null
  openable?: boolean
  expired?: boolean
}

type Filter = 'all' | 'verification' | 'identity' | 'manual' | 'bill'
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'verification', label: 'NIN / BVN checks' },
  { id: 'identity', label: 'Identity services' },
  { id: 'manual', label: 'Manual services' },
  { id: 'bill', label: 'Bills' },
]

const SOURCE_ICON = { verification: Fingerprint, identity: ShieldCheck, manual: FileText, bill: Receipt } as const
const STATUS_DOT = { completed: 'bg-green-500', pending: 'bg-amber-400', failed: 'bg-red-400', reversed: 'bg-amber-400' }
const STATUS_ICON = { completed: CheckCircle2, pending: Clock, failed: XCircle, reversed: RotateCcw }
const STATUS_LABEL = { completed: 'Completed', pending: 'Pending', failed: 'Failed', reversed: 'Refunded' }

export default function ServiceHistoryPage() {
  const navigate = useNavigate()
  // Two routes: /customer/services/history (own) and /officer/customers/:customerId/services
  // (an officer viewing one customer). One feed, every service the customer has used.
  const { customerId } = useParams<{ customerId?: string }>()
  const [filter, setFilter] = useState<Filter>('all')

  const { data: items = [], isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['service-history', customerId ?? 'self'],
    queryFn: async () => (await api.get<HistoryItem[]>('/history', { params: customerId ? { customer_id: customerId } : {} })).data,
  })

  const shown = filter === 'all' ? items : items.filter(i => i.source === filter)

  const target = (i: HistoryItem): string | null => {
    if (i.source === 'identity') return `/services/requests/${i.id}`
    if (i.source === 'manual') return `/customer/manual-services/requests/${i.id}`
    if (i.source === 'verification' && i.openable) {
      return customerId ? `/officer/customers/${customerId}/verify/${i.category}/${i.id}` : `/customer/verify/${i.category}/${i.id}`
    }
    return null
  }

  return (
    <div className="min-h-dvh flex flex-col bg-green-50 dark:bg-night-800">
      <header className="flex items-center gap-3 px-4 py-3">
        <button onClick={() => navigate(-1)} aria-label="Back" className="w-9 h-9 bg-green-100 dark:bg-night-600 rounded-xl flex items-center justify-center">
          <ArrowLeft className="w-4 h-4 text-green-700 dark:text-night-100" />
        </button>
        <h1 className="text-green-900 dark:text-white font-bold text-lg">
          {customerId ? "Customer's history" : 'History'}
        </h1>
      </header>

      {customerId && (
        <div className="px-4">
          <QuickActionsGrid customerId={customerId} title="New request" />
          <div className="h-px bg-green-100 dark:bg-night-500 my-5" />
        </div>
      )}

      <div className="flex gap-2 overflow-x-auto no-scrollbar px-4 pb-3">
        {FILTERS.map(f => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={cn(
              'flex-shrink-0 px-3.5 py-2 rounded-full text-xs font-bold border',
              filter === f.id
                ? 'bg-green-900 dark:bg-amber-400 text-white dark:text-green-900 border-transparent'
                : 'bg-white dark:bg-night-700 text-green-700 dark:text-night-100 border-green-100 dark:border-night-500'
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-safe-nav">
        {isError ? (
          <FallbackError title="Couldn't load your history" onRetry={() => refetch()} isRetrying={isFetching} />
        ) : isLoading ? (
          <div className="space-y-2.5 mt-1">
            {[1, 2, 3, 4].map(i => <div key={i} className="h-[72px] bg-white dark:bg-night-700 rounded-2xl animate-pulse" />)}
          </div>
        ) : shown.length === 0 ? (
          <div className="text-center py-16">
            <History className="w-10 h-10 text-green-200 dark:text-night-400 mx-auto mb-3" />
            <p className="text-green-700 dark:text-night-100 font-semibold text-sm">Nothing here yet</p>
            <p className="text-green-400 dark:text-night-300 text-xs mt-1">Every service you use, successful or not, shows up here.</p>
          </div>
        ) : (
          <div className="space-y-2.5 mt-1">
            {shown.map(i => {
              const Icon = SOURCE_ICON[i.source]
              const StatusIcon = STATUS_ICON[i.status]
              const to = target(i)
              const Row = to ? 'button' : 'div'
              return (
                <Row
                  key={i.key}
                  {...(to ? { onClick: () => navigate(to), type: 'button' as const } : {})}
                  className="w-full flex items-center gap-3 bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-3.5 text-left"
                >
                  <div className="w-10 h-10 rounded-xl bg-green-100 dark:bg-night-600 flex items-center justify-center flex-shrink-0">
                    <Icon className="w-5 h-5 text-green-700 dark:text-night-100" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-green-900 dark:text-white text-sm font-bold truncate">{i.title}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className={cn('w-1.5 h-1.5 rounded-full', STATUS_DOT[i.status])} />
                      <p className="text-green-400 dark:text-night-300 text-xs">
                        {STATUS_LABEL[i.status]}{' · '}{timeAgo(i.created_at)}{i.expired ? ' · expired' : ''}
                      </p>
                    </div>
                    {i.detail && <p className="text-green-500 dark:text-night-300 text-xs mt-0.5 line-clamp-2">{i.detail}</p>}
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <span className="text-green-900 dark:text-white text-sm font-bold">
                      {i.amount_kobo > 0 ? formatNaira(i.amount_kobo) : i.status === 'completed' ? '—' : 'Not charged'}
                    </span>
                    {to ? <ChevronRight className="w-3.5 h-3.5 text-green-300 dark:text-night-400" /> : <StatusIcon className="w-3.5 h-3.5 text-green-300 dark:text-night-400" />}
                  </div>
                </Row>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
