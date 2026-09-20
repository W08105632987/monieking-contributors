import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Users, UtensilsCrossed, Repeat, UserPlus, ArrowUpCircle, ArrowDownCircle,
  Coins, TrendingUp, TrendingDown, Calendar, ChevronDown, Download,
} from 'lucide-react'
import { api } from '@/lib/api'
import { formatNaira, cn } from '@/lib/utils'
import { useStatsRangeFilter, type StatsRangeKey } from '@/hooks/useStatsRangeFilter'
import type { CustomerStatsOverview } from '@/types'
import { InactiveCustomersList } from './InactiveCustomersList'

type Scope =
  | { kind: 'general' }                          // director, platform-wide
  | { kind: 'officer_zone'; officerId: string }   // director → officer detail
  | { kind: 'my_zone' }                           // officer's own dashboard/detail

function overviewQueryKeyAndFn(scope: Scope, start_date: string | undefined, end_date: string | undefined) {
  // 'all time' means start_date/end_date are simply omitted — the
  // backend's date_range_filters() already treats missing bounds as
  // "no filter", so this is the real all-time query, not a huge
  // hardcoded date range standing in for one.
  const params = new URLSearchParams()
  if (start_date) params.set('start_date', start_date)
  if (end_date) params.set('end_date', end_date)

  if (scope.kind === 'general') {
    return {
      key: ['customer-stats-overview', 'general', start_date ?? 'all', end_date ?? 'all'],
      fn: async () => (await api.get<CustomerStatsOverview>(`/customer-stats/overview?${params}`)).data,
    }
  }
  if (scope.kind === 'officer_zone') {
    params.set('officer_id', scope.officerId)
    return {
      key: ['customer-stats-overview', 'officer_zone', scope.officerId, start_date ?? 'all', end_date ?? 'all'],
      fn: async () => (await api.get<CustomerStatsOverview>(`/customer-stats/overview?${params}`)).data,
    }
  }
  return {
    key: ['customer-stats-overview', 'my_zone', start_date ?? 'all', end_date ?? 'all'],
    fn: async () => (await api.get<CustomerStatsOverview>(`/customer-stats/my-zone-overview?${params}`)).data,
  }
}

function TrendBadge({ pct }: { pct: number | null | undefined }) {
  if (pct === null || pct === undefined) return null
  const up = pct >= 0
  return (
    <span className={cn(
      'inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full',
      up ? 'bg-green-100 dark:bg-green-950/40 text-green-700 dark:text-green-300' : 'bg-red-50 dark:bg-red-950/40 text-red-500 dark:text-red-400',
    )}>
      {up ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
      {Math.abs(pct)}%
    </span>
  )
}

function StatCard({
  icon: Icon, label, value, sublabel, trendPct, tint,
}: {
  icon: any; label: string; value: string | number; sublabel?: string
  trendPct?: number | null; tint: string
}) {
  return (
    <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className={cn('w-7 h-7 rounded-xl flex items-center justify-center', tint)}>
            <Icon className="w-4 h-4" />
          </div>
          <p className="text-green-500 dark:text-night-200 text-xs font-semibold uppercase tracking-wide">{label}</p>
        </div>
        <TrendBadge pct={trendPct} />
      </div>
      <p className="text-green-900 dark:text-white text-xl font-extrabold">{value}</p>
      {sublabel && <p className="text-green-400 dark:text-night-300 text-xs mt-0.5">{sublabel}</p>}
    </div>
  )
}

function exportCsv(data: CustomerStatsOverview, label: string) {
  const rows = [
    ['Metric', 'Value'],
    ['Period', label],
    ['Total contributors', String(data.total_contributors)],
    ['Food contributors', String(data.food_contributors)],
    ['Regular contributors', String(data.regular_contributors)],
    ['New contributors', String(data.new_contributors)],
    ['Active contributors', String(data.active_contributors)],
    ['Inactive contributors', String(data.inactive_contributors)],
    ['Total value currently active (₦)', String(data.total_value_active_kobo / 100)],
  ]
  const csv = rows.map(r => r.map(cell => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `customer-statistics-${label.replace(/\s+/g, '_')}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

const RANGE_OPTIONS: { value: StatsRangeKey; label: string }[] = [
  { value: 'all', label: 'All time' },
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7 days' },
  { value: 'custom', label: 'Custom range' },
]

/**
 * The Customer Statistics panel. Defaults to All time everywhere it
 * appears (director general dashboard, director → officer, officer's
 * own dashboard, officer's "See more" detail page) — a compact
 * dropdown, styled the same way as the director dashboard's hero-card
 * period picker (small pill + chevron, opens a short absolute list),
 * lets whoever's looking at it narrow to Today / 7 days / Custom
 * range. `showInactiveList` still gates the collapsible
 * inactive-customers + bulk-ping section — the officer's compact
 * dashboard card keeps that hidden and links to "See more" instead;
 * every other placement shows it.
 */
export function CustomerStatsPanel({
  scope, showInactiveList = true, title = 'Customer statistics',
}: {
  scope: Scope
  showInactiveList?: boolean
  title?: string
}) {
  const filter = useStatsRangeFilter()
  const [showInactive, setShowInactive] = useState(false)
  const [showPicker, setShowPicker] = useState(false)

  const { key, fn } = overviewQueryKeyAndFn(scope, filter.start_date, filter.end_date)
  const { data, isLoading } = useQuery({ queryKey: key, queryFn: fn })

  const inactiveScopeProps =
    scope.kind === 'officer_zone' ? { officerId: scope.officerId, canCall: false, canBulkPing: true }
    : scope.kind === 'my_zone'    ? { canCall: true, canBulkPing: true }
    : { canCall: false, canBulkPing: true } // general

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-3 gap-2">
        <h2 className="text-green-900 dark:text-white font-bold text-base">{title}</h2>
        <div className="flex items-center gap-2 flex-shrink-0">
          {!isLoading && data && (
            <button
              onClick={() => exportCsv(data, filter.label)}
              className="flex items-center gap-1 text-green-600 dark:text-night-200 text-xs font-semibold"
            >
              <Download className="w-3.5 h-3.5" /> Export
            </button>
          )}
          <div className="relative">
            <button
              onClick={() => setShowPicker(s => !s)}
              className="flex items-center gap-1 bg-green-900 dark:bg-night-600 rounded-full px-3 py-1.5 text-white text-xs font-semibold"
            >
              {filter.label} <ChevronDown className="w-3 h-3" />
            </button>
            {showPicker && (
              <div className="absolute right-0 top-9 z-20 bg-white dark:bg-night-700 rounded-2xl shadow-xl py-2 w-40 border border-green-100 dark:border-night-500">
                {RANGE_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => { filter.setRangeKey(opt.value); setShowPicker(opt.value === 'custom') }}
                    className={cn(
                      'w-full text-left px-4 py-2 text-xs font-semibold',
                      opt.value === filter.rangeKey ? 'text-green-900 dark:text-white bg-green-50 dark:bg-night-600' : 'text-green-600 dark:text-night-200',
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {filter.rangeKey === 'custom' && (
        <div className="flex items-center gap-2 mb-4 bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 p-3">
          <Calendar className="w-4 h-4 text-green-500 dark:text-night-200 flex-shrink-0" />
          <input type="date" value={filter.customStart} onChange={e => filter.setCustomStart(e.target.value)}
            className="flex-1 text-xs text-green-900 dark:text-white border border-green-200 dark:border-night-500 rounded-lg px-2 py-1.5" />
          <span className="text-green-400 dark:text-night-300 text-xs">to</span>
          <input type="date" value={filter.customEnd} onChange={e => filter.setCustomEnd(e.target.value)}
            className="flex-1 text-xs text-green-900 dark:text-white border border-green-200 dark:border-night-500 rounded-lg px-2 py-1.5" />
        </div>
      )}

      {isLoading || !data ? (
        <div className="grid grid-cols-2 gap-3">
          {[1, 2, 3, 4].map(i => <div key={i} className="h-24 bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 animate-pulse" />)}
        </div>
      ) : (
        <>
          {/* Total contributors — the "legend" the panel is built around */}
          <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-4 mb-3">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-green-600 dark:text-night-200" />
                <p className="text-green-500 dark:text-night-200 text-xs font-semibold uppercase tracking-widest">Total contributors</p>
              </div>
              <TrendBadge pct={data.trend?.total_contributors} />
            </div>
            <p className="text-green-900 dark:text-white text-3xl font-extrabold mb-1">{data.total_contributors}</p>
            <p className="text-green-400 dark:text-night-300 text-xs">{data.food_contributors} food · {data.regular_contributors} regular</p>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-3">
            <StatCard icon={UtensilsCrossed} tint="bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-300" label="Food"
              value={data.food_contributors} trendPct={data.trend?.food_contributors} />
            <StatCard icon={Repeat} tint="bg-blue-50 dark:bg-blue-950/40 text-blue-500 dark:text-blue-300" label="Regular"
              value={data.regular_contributors} trendPct={data.trend?.regular_contributors} />
            <StatCard icon={UserPlus} tint="bg-green-100 dark:bg-green-950/40 text-green-700 dark:text-green-300" label="New"
              value={data.new_contributors} trendPct={data.trend?.new_contributors}
              sublabel={filter.label} />
            <StatCard icon={Coins} tint="bg-copper-50 dark:bg-amber-950/40 text-copper-600 dark:text-amber-300" label="Active value"
              value={formatNaira(data.total_value_active_kobo)} trendPct={data.trend?.total_value_active_kobo}
              sublabel="held on customers' behalf" />
          </div>

          <div className="grid grid-cols-2 gap-3 mb-3">
            <StatCard icon={ArrowUpCircle} tint="bg-green-100 dark:bg-green-950/40 text-green-700 dark:text-green-300" label="Active"
              value={data.active_contributors} trendPct={data.trend?.active_contributors} />
            <StatCard icon={ArrowDownCircle} tint="bg-red-50 dark:bg-red-950/40 text-red-400 dark:text-red-300" label="Inactive"
              value={data.inactive_contributors} trendPct={data.trend?.inactive_contributors} />
          </div>

          {showInactiveList && (
            <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card overflow-hidden">
              <button
                onClick={() => setShowInactive(v => !v)}
                className="w-full flex items-center justify-between p-4"
              >
                <p className="text-green-900 dark:text-white font-bold text-sm">
                  Inactive customers
                  {data.inactive_contributors > 0 && (
                    <span className="ml-2 text-xs font-bold bg-red-50 dark:bg-red-950/50 text-red-400 dark:text-red-300 px-2 py-0.5 rounded-full">
                      {data.inactive_contributors}
                    </span>
                  )}
                </p>
                <ChevronDown className={cn('w-4 h-4 text-green-300 dark:text-night-300 transition-transform', showInactive && 'rotate-180')} />
              </button>
              {showInactive && (
                <div className="px-4 pb-4">
                  <InactiveCustomersList
                    officerId={scope.kind === 'officer_zone' ? scope.officerId : undefined}
                    canCall={inactiveScopeProps.canCall}
                    canBulkPing={inactiveScopeProps.canBulkPing}
                  />
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
