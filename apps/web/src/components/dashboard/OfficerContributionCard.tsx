import { useQuery } from '@tanstack/react-query'
import { Coins, Calendar, ClipboardList } from 'lucide-react'
import { api } from '@/lib/api'
import { formatNaira, cn } from '@/lib/utils'
import { useStatsRangeFilter } from '@/hooks/useStatsRangeFilter'
import type { OfficerContributionStats } from '@/types'

export function OfficerContributionCard({ officerId }: { officerId: string }) {
  const filter = useStatsRangeFilter()

  const { data, isLoading } = useQuery({
    queryKey: ['officer-contribution', officerId, filter.start_date, filter.end_date],
    queryFn: async () => {
      const queryObj: Record<string, string> = { officer_id: officerId }
      if (filter.start_date) queryObj.start_date = filter.start_date
      if (filter.end_date) queryObj.end_date = filter.end_date
      const params = new URLSearchParams(queryObj)
      const { data } = await api.get<OfficerContributionStats>(`/customer-stats/officer-contribution?${params}`)
      return data
    },

  })

  return (
    <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Coins className="w-4 h-4 text-green-600 dark:text-night-200" />
          <p className="text-green-900 dark:text-white font-bold text-sm">Contribution gathered</p>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-3 overflow-x-auto no-scrollbar">
        {([
          { value: 'today', label: 'Today' },
          { value: '7d', label: 'Week' },
          { value: 'custom', label: 'Custom' },
        ] as const).map(opt => (
          <button
            key={opt.value}
            onClick={() => filter.setRangeKey(opt.value)}
            className={cn(
              'flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap',
              filter.rangeKey === opt.value ? 'bg-green-900 dark:bg-night-100 text-white' : 'bg-green-50 dark:bg-night-600 text-green-600 dark:text-night-200',
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {filter.rangeKey === 'custom' && (
        <div className="flex items-center gap-2 mb-3">
          <Calendar className="w-4 h-4 text-green-500 dark:text-night-200 flex-shrink-0" />
          <input type="date" value={filter.customStart} onChange={e => filter.setCustomStart(e.target.value)}
            className="flex-1 text-xs text-green-900 dark:text-white border border-green-200 dark:border-night-500 rounded-lg px-2 py-1.5" />
          <span className="text-green-400 dark:text-night-300 text-xs">to</span>
          <input type="date" value={filter.customEnd} onChange={e => filter.setCustomEnd(e.target.value)}
            className="flex-1 text-xs text-green-900 dark:text-white border border-green-200 dark:border-night-500 rounded-lg px-2 py-1.5" />
        </div>
      )}

      {isLoading || !data ? (
        <div className="h-14 bg-green-50 dark:bg-night-600 rounded-xl animate-pulse" />
      ) : (
        <div className="flex items-end justify-between">
          <div>
            <p className="text-green-900 dark:text-white text-2xl font-extrabold">{formatNaira(data.amount_gathered_kobo)}</p>
            <p className="text-green-400 dark:text-night-300 text-xs mt-0.5">{filter.label}</p>
          </div>
          <div className="flex items-center gap-1.5 text-green-500 dark:text-night-200 text-xs font-semibold">
            <ClipboardList className="w-3.5 h-3.5" /> {data.contribution_count} contribution{data.contribution_count === 1 ? '' : 's'}
          </div>
        </div>
      )}
    </div>
  )
}
