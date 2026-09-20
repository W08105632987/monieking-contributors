import { useQuery } from '@tanstack/react-query'
import { Users, UtensilsCrossed, Repeat, UserPlus, ArrowUpCircle, ArrowDownCircle, Coins } from 'lucide-react'
import { api } from '@/lib/api'
import { formatNaira, cn } from '@/lib/utils'
import type { CustomerStatsOverview } from '@/types'

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

function Card({ icon: Icon, label, value, tint }: { icon: any; label: string; value: string | number; tint: string }) {
  return (
    <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-5">
      <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center mb-3', tint)}>
        <Icon className="w-5 h-5" />
      </div>
      <p className="text-green-500 dark:text-night-200 text-xs font-semibold uppercase tracking-wide mb-1">{label}</p>
      <p className="text-green-900 dark:text-white text-2xl font-extrabold">{value}</p>
    </div>
  )
}

export default function OverviewPage() {
  const today = todayIso()
  const { data, isLoading } = useQuery({
    queryKey: ['crm-overview', today],
    queryFn: async () => (await api.get<CustomerStatsOverview>(
      `/customer-stats/overview?start_date=${today}&end_date=${today}`
    )).data,
  })

  return (
    <div>
      <h1 className="text-green-900 dark:text-white font-extrabold text-2xl mb-1">Overview</h1>
      <p className="text-green-500 dark:text-night-200 text-sm mb-6">Platform-wide, today</p>

      {isLoading || !data ? (
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <div key={i} className="h-28 bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 animate-pulse" />)}
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-4">
          <Card icon={Users} tint="bg-green-100 text-green-700" label="Total contributors" value={data.total_contributors} />
          <Card icon={UtensilsCrossed} tint="bg-amber-50 text-amber-600" label="Food" value={data.food_contributors} />
          <Card icon={Repeat} tint="bg-blue-50 text-blue-500" label="Regular" value={data.regular_contributors} />
          <Card icon={UserPlus} tint="bg-green-100 text-green-700" label="New today" value={data.new_contributors} />
          <Card icon={ArrowUpCircle} tint="bg-green-100 text-green-700" label="Active" value={data.active_contributors} />
          <Card icon={ArrowDownCircle} tint="bg-red-50 text-red-400" label="Inactive" value={data.inactive_contributors} />
          <Card icon={Coins} tint="bg-copper-50 text-copper-600" label="Value currently active" value={formatNaira(data.total_value_active_kobo)} />
        </div>
      )}
    </div>
  )
}
