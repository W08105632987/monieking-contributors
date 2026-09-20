import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Users, CreditCard, Coins, Clock, TrendingUp, FileBarChart, MapPin, Calendar } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { api } from '@/lib/api'
import { formatNaira, cn } from '@/lib/utils'
import type { SystemAnalytics, ZoneAnalytics } from '@/types'

type QuickRange = 'all' | 'this_month' | 'last_month' | 'custom'

function monthBounds(offsetMonths: number) {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth() - offsetMonths, 1)
  const end = new Date(now.getFullYear(), now.getMonth() - offsetMonths + 1, 0)
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  return { start_date: fmt(start), end_date: fmt(end) }
}

export default function AnalyticsPage() {
  const navigate = useNavigate()
  const [quickRange, setQuickRange] = useState<QuickRange>('all')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')

  const { start_date, end_date, periodLabel } = useMemo(() => {
    if (quickRange === 'all') return { start_date: undefined, end_date: undefined, periodLabel: 'All time' }
    if (quickRange === 'this_month') {
      const { start_date, end_date } = monthBounds(0)
      return { start_date, end_date, periodLabel: new Date().toLocaleString('default', { month: 'long', year: 'numeric' }) }
    }
    if (quickRange === 'last_month') {
      const { start_date, end_date } = monthBounds(1)
      const d = new Date(); d.setMonth(d.getMonth() - 1)
      return { start_date, end_date, periodLabel: d.toLocaleString('default', { month: 'long', year: 'numeric' }) }
    }
    // custom
    if (customStart && customEnd) {
      return { start_date: customStart, end_date: customEnd, periodLabel: `${customStart} → ${customEnd}` }
    }
    return { start_date: undefined, end_date: undefined, periodLabel: 'All time' }
  }, [quickRange, customStart, customEnd])

  const { data, isLoading } = useQuery({
    queryKey: ['admin-analytics', start_date, end_date],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (start_date) params.set('start_date', start_date)
      if (end_date) params.set('end_date', end_date)
      const { data } = await api.get<SystemAnalytics>(`/admin/analytics?${params.toString()}`)
      return data
    },
  })

  const { data: zones } = useQuery({
    queryKey: ['zone-analytics'],
    queryFn: async () => { const { data } = await api.get<ZoneAnalytics>('/admin/zone-analytics'); return data },
  })

  const reportHref = `/director/report${start_date && end_date ? `?start_date=${start_date}&end_date=${end_date}&label=${encodeURIComponent(periodLabel)}` : ''}`
  const reportButtonLabel = quickRange === 'all' ? 'View report' : `View ${periodLabel} report`

  const roleChartData = data ? Object.entries(data.users_by_role).map(([role, count]) => ({ role, count })) : []
  const zoneChartData = zones ? zones.by_state.slice(0, 8).map(z => ({ state: z.state, count: z.count })) : []

  return (
    <div className="min-h-dvh flex flex-col bg-green-50 dark:bg-night-800">
      <header className="flex items-center gap-3 px-4 py-3 bg-green-50 dark:bg-night-800">
        <button onClick={() => navigate(-1)} className="w-9 h-9 rounded-full bg-white dark:bg-night-700 border border-green-100 dark:border-night-500 flex items-center justify-center">
          <ArrowLeft className="w-4 h-4 text-green-700 dark:text-night-100" />
        </button>
        <h1 className="text-green-900 dark:text-white font-extrabold text-lg">Analytics</h1>
      </header>

      <div className="flex-1 overflow-y-auto px-4 pb-10">
        {/* Date range filter — defaults to All time */}
        <div className="flex items-center gap-2 mb-2 overflow-x-auto no-scrollbar">
          {([
            { value: 'all', label: 'All time' },
            { value: 'this_month', label: 'This month' },
            { value: 'last_month', label: 'Last month' },
            { value: 'custom', label: 'Custom range' },
          ] as { value: QuickRange; label: string }[]).map(opt => (
            <button
              key={opt.value}
              onClick={() => setQuickRange(opt.value)}
              className={cn(
                'flex-shrink-0 px-3.5 py-2 rounded-full text-xs font-bold whitespace-nowrap',
                quickRange === opt.value ? 'bg-green-900 dark:bg-night-100 text-white' : 'bg-white dark:bg-night-700 border border-green-200 dark:border-night-500 text-green-600 dark:text-night-200',
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {quickRange === 'custom' && (
          <div className="flex items-center gap-2 mb-4 bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 p-3">
            <Calendar className="w-4 h-4 text-green-500 dark:text-night-200 flex-shrink-0" />
            <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)}
              className="flex-1 text-xs text-green-900 dark:text-white border border-green-200 dark:border-night-500 rounded-lg px-2 py-1.5 bg-white dark:bg-night-700" />
            <span className="text-green-400 dark:text-night-300 text-xs">to</span>
            <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)}
              className="flex-1 text-xs text-green-900 dark:text-white border border-green-200 dark:border-night-500 rounded-lg px-2 py-1.5 bg-white dark:bg-night-700" />
          </div>
        )}

        {isLoading || !data ? (
          <div className="grid grid-cols-2 gap-3 mt-2">
            {[1, 2, 3, 4].map(i => <div key={i} className="h-24 bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 animate-pulse" />)}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 mb-4 mt-2">
              <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-4">
                <div className="flex items-center gap-2 mb-2"><Coins className="w-4 h-4 text-green-600 dark:text-night-200" /><p className="text-green-500 dark:text-night-200 text-xs font-semibold uppercase">Total contributed</p></div>
                <p className="text-green-900 dark:text-white text-lg font-extrabold">{formatNaira(data.total_contributed_kobo)}</p>
              </div>
              <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-4">
                <div className="flex items-center gap-2 mb-2"><TrendingUp className="w-4 h-4 text-blue-500" /><p className="text-green-500 dark:text-night-200 text-xs font-semibold uppercase">Paid out</p></div>
                <p className="text-green-900 dark:text-white text-lg font-extrabold">{formatNaira(data.total_paid_out_kobo)}</p>
              </div>
              <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-4">
                <div className="flex items-center gap-2 mb-2"><CreditCard className="w-4 h-4 text-amber-500 dark:text-amber-300" /><p className="text-green-500 dark:text-night-200 text-xs font-semibold uppercase">Active cards</p></div>
                <p className="text-green-900 dark:text-white text-lg font-extrabold">{data.total_active_cards}</p>
                <p className="text-green-400 dark:text-night-300 text-xs mt-0.5">{data.total_food_cards} food cards</p>
              </div>
              <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-4">
                <div className="flex items-center gap-2 mb-2"><Clock className="w-4 h-4 text-red-400 dark:text-red-300" /><p className="text-green-500 dark:text-night-200 text-xs font-semibold uppercase">Pending withdrawals</p></div>
                <p className="text-green-900 dark:text-white text-lg font-extrabold">{data.pending_withdrawals}</p>
              </div>
            </div>

            <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-4 mb-4">
              <p className="text-green-500 dark:text-night-200 text-xs font-semibold uppercase mb-3">Charges collected {quickRange !== 'all' && `— ${periodLabel}`}</p>
              <p className="text-green-900 dark:text-white text-2xl font-extrabold">{formatNaira(data.total_charges_kobo)}</p>
            </div>

            {/* View report button */}
            <button
              onClick={() => navigate(reportHref)}
              className="w-full flex items-center justify-center gap-2 bg-green-900 dark:bg-night-100 text-white font-bold text-sm rounded-2xl py-3.5 mb-4 active:scale-95 transition-all"
            >
              <FileBarChart className="w-4 h-4" /> {reportButtonLabel}
            </button>

            {/* Users by role */}
            <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-4 mb-4">
              <div className="flex items-center gap-2 mb-3"><Users className="w-4 h-4 text-green-600 dark:text-night-200" /><p className="text-green-900 dark:text-white font-bold text-sm">Users by role</p></div>
              {roleChartData.length > 0 && (
                <div style={{ width: '100%', height: 160 }} className="mb-2">
                  <ResponsiveContainer>
                    <BarChart data={roleChartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#D1FAE5" />
                      <XAxis dataKey="role" tick={{ fontSize: 11, fill: '#059669' }} />
                      <YAxis tick={{ fontSize: 11, fill: '#059669' }} allowDecimals={false} />
                      <Tooltip />
                      <Bar dataKey="count" fill="#052E16" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
              <div className="space-y-2">
                {Object.entries(data.users_by_role).map(([role, count]) => (
                  <div key={role} className="flex items-center justify-between text-sm">
                    <span className="text-green-600 dark:text-night-200 capitalize">{role}</span>
                    <span className="text-green-900 dark:text-white font-bold">{count}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Zone breakdown */}
            <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-4">
              <div className="flex items-center gap-2 mb-3"><MapPin className="w-4 h-4 text-copper-500" /><p className="text-green-900 dark:text-white font-bold text-sm">Customer base by state</p></div>
              {zoneChartData.length > 0 ? (
                <div style={{ width: '100%', height: 200 }} className="mb-3">
                  <ResponsiveContainer>
                    <BarChart data={zoneChartData} layout="vertical" margin={{ left: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#D1FAE5" />
                      <XAxis type="number" tick={{ fontSize: 11, fill: '#059669' }} allowDecimals={false} />
                      <YAxis dataKey="state" type="category" width={70} tick={{ fontSize: 11, fill: '#059669' }} />
                      <Tooltip />
                      <Bar dataKey="count" fill="#D97706" radius={[0, 6, 6, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="text-green-400 dark:text-night-300 text-xs mb-3">No location data shared yet.</p>
              )}
              <div className="flex items-center justify-between text-xs text-green-500 dark:text-night-200 pt-2 border-t border-green-50 dark:border-night-600">
                <span>Didn't share location</span>
                <span className="font-bold text-green-700 dark:text-night-100">{zones?.declined_count ?? 0}</span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
