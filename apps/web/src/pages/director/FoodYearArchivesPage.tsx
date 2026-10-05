import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Archive, ChevronRight, TrendingUp, TrendingDown } from 'lucide-react'
import { api } from '@/lib/api'
import { cn, formatNaira, formatDateTime } from '@/lib/utils'

interface ArchiveSummary {
  id: string
  year_label: string
  closed_at: string
  total_qualified: number
  total_collected: number
  net_result_kobo: number
}

export default function FoodYearArchivesPage() {
  const navigate = useNavigate()
  const { data, isLoading } = useQuery({
    queryKey: ['food-year-archives'],
    queryFn: async () => (await api.get<ArchiveSummary[]>('/food-collections/year/archives')).data,
  })

  return (
    <div className="min-h-dvh flex flex-col bg-green-50 dark:bg-night-800">
      <header className="flex items-center gap-3 px-4 py-3">
        <button onClick={() => navigate(-1)} className="w-9 h-9 bg-white dark:bg-night-700 border border-green-200 dark:border-night-500 rounded-xl flex items-center justify-center active:scale-95 transition-all">
          <ArrowLeft className="w-5 h-5 text-green-700 dark:text-night-100" />
        </button>
        <h1 className="text-green-900 dark:text-white font-extrabold text-lg">Food Contribution Records</h1>
      </header>

      <div className="flex-1 overflow-y-auto px-4 pb-safe-nav">
        {isLoading ? (
          <div className="space-y-2.5">{[1, 2].map(i => <div key={i} className="h-20 bg-white dark:bg-night-700 rounded-2xl animate-pulse" />)}</div>
        ) : !data || data.length === 0 ? (
          <div className="bg-white dark:bg-night-700 rounded-2xl p-8 text-center mt-4">
            <Archive className="w-10 h-10 text-green-200 dark:text-night-500 mx-auto mb-2" />
            <p className="text-green-500 dark:text-night-200 text-sm font-semibold">No closed years yet</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {data.map(archive => (
              <button
                key={archive.id}
                onClick={() => navigate(`/director/food/archives/${archive.year_label}`)}
                className="w-full bg-white dark:bg-night-700 rounded-2xl p-4 flex items-center justify-between gap-3 text-left active:scale-[0.98] transition-all"
              >
                <div>
                  <p className="text-green-900 dark:text-white font-extrabold text-base">{archive.year_label} Food Contribution Records</p>
                  <p className="text-green-400 dark:text-night-300 text-xs mt-0.5">
                    {archive.total_collected}/{archive.total_qualified} collected · Closed {formatDateTime(archive.closed_at)}
                  </p>
                  <div className={cn('flex items-center gap-1 mt-1.5 text-xs font-bold', archive.net_result_kobo >= 0 ? 'text-green-700 dark:text-green-400' : 'text-red-500')}>
                    {archive.net_result_kobo >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                    {archive.net_result_kobo >= 0 ? 'Profit' : 'Loss'}: {formatNaira(Math.abs(archive.net_result_kobo))}
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-green-300 dark:text-night-400 shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
