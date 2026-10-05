import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { ArrowLeft, Package, MapPin } from 'lucide-react'
import { api } from '@/lib/api'
import { cn, formatDateTime } from '@/lib/utils'
import { FallbackError } from '@/components/ui/FallbackError'

interface LedgerEntry {
  id: string
  customer_name: string | null
  package_name: string
  collected_at: string | null
  is_my_zone: boolean
  zone_name: string | null
}

interface LedgerResponse {
  items: LedgerEntry[]
  total: number
  stats: { today: number; total: number }
}

export default function FoodLedgerPage() {
  const navigate = useNavigate()

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['officer-food-ledger'],
    queryFn: async () => {
      const { data } = await api.get<LedgerResponse>('/food-collections/mine', { params: { page: 1, page_size: 50 } })
      return data
    },
  })

  return (
    <div className="min-h-dvh flex flex-col bg-green-50 dark:bg-night-800">
      <header className="flex items-center gap-3 px-4 py-3">
        <button onClick={() => navigate(-1)} className="w-9 h-9 bg-white dark:bg-night-700 border border-green-200 dark:border-night-500 rounded-xl flex items-center justify-center active:scale-95 transition-all">
          <ArrowLeft className="w-5 h-5 text-green-700 dark:text-night-100" />
        </button>
        <h1 className="text-green-900 dark:text-white font-extrabold text-lg">My Food Distribution Log</h1>
      </header>

      <div className="flex-1 overflow-y-auto px-4 pb-safe-nav">
        {isError ? (
          <FallbackError title="Couldn't load your ledger" onRetry={() => refetch()} isRetrying={isFetching} />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="bg-white dark:bg-night-700 rounded-2xl p-4">
                <p className="text-green-400 dark:text-night-300 text-xs font-semibold">Today</p>
                <p className="text-green-900 dark:text-white text-2xl font-extrabold mt-1">{data?.stats.today ?? '—'}</p>
              </div>
              <div className="bg-white dark:bg-night-700 rounded-2xl p-4">
                <p className="text-green-400 dark:text-night-300 text-xs font-semibold">Total distributed</p>
                <p className="text-green-900 dark:text-white text-2xl font-extrabold mt-1">{data?.stats.total ?? '—'}</p>
              </div>
            </div>

            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map(i => <div key={i} className="h-20 bg-white dark:bg-night-700 rounded-2xl animate-pulse" />)}
              </div>
            ) : !data || data.items.length === 0 ? (
              <div className="bg-white dark:bg-night-700 rounded-2xl p-8 text-center">
                <Package className="w-10 h-10 text-green-200 dark:text-night-500 mx-auto mb-2" />
                <p className="text-green-500 dark:text-night-200 text-sm font-semibold">No distributions confirmed yet</p>
              </div>
            ) : (
              <div className="space-y-2.5 pb-4">
                {data.items.map((entry, i) => (
                  <motion.div
                    key={entry.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(i * 0.03, 0.3) }}
                    className="bg-white dark:bg-night-700 rounded-2xl p-4 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="text-green-900 dark:text-white font-bold text-sm truncate">{entry.customer_name || 'Customer'}</p>
                      <p className="text-green-500 dark:text-night-300 text-xs mt-0.5">{entry.package_name}</p>
                      {entry.collected_at && (
                        <p className="text-green-300 dark:text-night-400 text-[11px] mt-0.5">{formatDateTime(entry.collected_at)}</p>
                      )}
                    </div>
                    <span
                      className={cn(
                        'shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold',
                        entry.is_my_zone
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                          : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
                      )}
                    >
                      <MapPin className="w-3 h-3" />
                      {entry.is_my_zone ? 'My Zone' : entry.zone_name || 'Other zone'}
                    </span>
                  </motion.div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
