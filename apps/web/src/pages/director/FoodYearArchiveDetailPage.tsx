import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { api } from '@/lib/api'
import { cn, formatNaira, formatDateTime } from '@/lib/utils'
import { FallbackError } from '@/components/ui/FallbackError'

interface ArchiveDetail {
  year_label: string
  closed_at: string
  closed_by: string | null
  total_qualified: number
  total_collected: number
  total_not_collected: number
  total_customer_contributions_kobo: number
  adjustment_kobo: number
  adjustment_note: string | null
  total_cost_kobo: number
  net_result_kobo: number
  cost_lines: { item_name: string; unit_cost_kobo: number }[]
}

export default function FoodYearArchiveDetailPage() {
  const { year } = useParams<{ year: string }>()
  const navigate = useNavigate()

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['food-year-archive', year],
    queryFn: async () => (await api.get<ArchiveDetail>(`/food-collections/year/archives/${year}`)).data,
    enabled: !!year,
  })

  return (
    <div className="min-h-dvh flex flex-col bg-green-50 dark:bg-night-800">
      <header className="flex items-center gap-3 px-4 py-3">
        <button onClick={() => navigate(-1)} className="w-9 h-9 bg-white dark:bg-night-700 border border-green-200 dark:border-night-500 rounded-xl flex items-center justify-center active:scale-95 transition-all">
          <ArrowLeft className="w-5 h-5 text-green-700 dark:text-night-100" />
        </button>
        <h1 className="text-green-900 dark:text-white font-extrabold text-lg">{year} Records</h1>
      </header>

      <div className="flex-1 overflow-y-auto px-4 pb-safe-nav space-y-4">
        {isError ? (
          <FallbackError title="Couldn't load this record" onRetry={() => refetch()} isRetrying={isFetching} />
        ) : isLoading || !data ? (
          <div className="h-64 bg-white dark:bg-night-700 rounded-2xl animate-pulse" />
        ) : (
          <>
            <p className="text-green-400 dark:text-night-300 text-xs text-center">
              Closed {formatDateTime(data.closed_at)} by {data.closed_by || 'a director'}
            </p>

            <div className="grid grid-cols-3 gap-2.5">
              <Stat label="Qualified" value={String(data.total_qualified)} />
              <Stat label="Collected" value={String(data.total_collected)} />
              <Stat label="Not collected" value={String(data.total_not_collected)} />
            </div>

            <div className="bg-white dark:bg-night-700 rounded-2xl p-4 space-y-2.5">
              <p className="text-green-900 dark:text-white font-bold text-sm mb-1">Financial summary</p>
              <Row label="Total customer contributions" value={formatNaira(data.total_customer_contributions_kobo)} />
              {data.cost_lines.map((line, i) => (
                <Row key={i} label={`Cost — ${line.item_name} × ${data.total_collected}`} value={formatNaira(line.unit_cost_kobo * data.total_collected)} muted />
              ))}
              {data.adjustment_kobo !== 0 && (
                <Row label={`Adjustment${data.adjustment_note ? ` — ${data.adjustment_note}` : ''}`} value={formatNaira(data.adjustment_kobo)} muted />
              )}
              <div className="border-t border-green-100 dark:border-night-600 pt-2.5">
                <Row label="Total cost" value={formatNaira(data.total_cost_kobo)} />
              </div>
            </div>

            <div className={cn('rounded-2xl p-5 text-center', data.net_result_kobo >= 0 ? 'bg-green-900 dark:bg-green-950' : 'bg-red-500')}>
              <p className="text-white/70 text-xs font-bold uppercase tracking-wide">{data.net_result_kobo >= 0 ? 'Profit' : 'Loss'} for {data.year_label}</p>
              <p className="text-white text-3xl font-extrabold mt-1">{formatNaira(Math.abs(data.net_result_kobo))}</p>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white dark:bg-night-700 rounded-2xl p-3 text-center">
      <p className="text-green-900 dark:text-white text-xl font-extrabold">{value}</p>
      <p className="text-green-400 dark:text-night-300 text-[10px] font-semibold mt-0.5">{label}</p>
    </div>
  )
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className={cn('text-xs', muted ? 'text-green-400 dark:text-night-300' : 'text-green-600 dark:text-night-200 font-semibold')}>{label}</span>
      <span className={cn('text-sm font-bold text-right shrink-0', muted ? 'text-green-600 dark:text-night-300' : 'text-green-900 dark:text-white')}>{value}</span>
    </div>
  )
}
