import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { Eye, Users, MousePointerClick } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

interface AnalyticsOverview {
  pageviews: number
  unique_visitors: number
  clicks: number
  top_pages: { path: string; views: number }[]
  top_clicks: { label: string; clicks: number }[]
  by_role: { role: string; visitors: number }[]
  daily: { date: string; pageviews: number; clicks: number }[]
  period: { start_date: string | null; end_date: string | null }
}

const RANGE_OPTIONS = [
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'all', label: 'All time' },
] as const

function StatCard({ icon: Icon, label, value }: { icon: any; label: string; value: number }) {
  return (
    <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-5">
      <div className="w-9 h-9 rounded-xl bg-green-100 dark:bg-night-600 flex items-center justify-center mb-3">
        <Icon className="w-4.5 h-4.5 text-green-700 dark:text-night-100" />
      </div>
      <p className="text-green-500 dark:text-night-200 text-xs font-semibold uppercase tracking-wide mb-1">{label}</p>
      <p className="text-green-900 dark:text-white text-2xl font-extrabold">{value.toLocaleString()}</p>
    </div>
  )
}

export default function AnalyticsPage() {
  const [range, setRange] = useState<'7d' | '30d' | 'all'>('7d')

  const { start_date, end_date } = (() => {
    if (range === 'all') return { start_date: undefined, end_date: undefined }
    const end = new Date()
    const start = new Date()
    start.setDate(start.getDate() - (range === '7d' ? 6 : 29))
    return { start_date: start.toISOString().slice(0, 10), end_date: end.toISOString().slice(0, 10) }
  })()

  const { data, isLoading } = useQuery({
    queryKey: ['crm-analytics', range],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (start_date) params.set('start_date', start_date)
      if (end_date) params.set('end_date', end_date)
      return (await api.get<AnalyticsOverview>(`/analytics/overview?${params}`)).data
    },
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-green-900 dark:text-white font-extrabold text-2xl">Live metrics</h1>
        <div className="flex items-center gap-2">
          {RANGE_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setRange(opt.value)}
              className={cn(
                'px-3.5 py-2 rounded-full text-xs font-bold',
                range === opt.value ? 'bg-green-900 dark:bg-copper-400 text-white dark:text-green-950' : 'bg-white dark:bg-night-700 border border-green-200 dark:border-night-500 text-green-600 dark:text-night-200',
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      <p className="text-green-500 dark:text-night-200 text-sm mb-6">Every visit and click, tracked in-house — nothing here goes to a third party</p>

      {isLoading || !data ? (
        <div className="grid grid-cols-3 gap-4">{[1, 2, 3].map(i => <div key={i} className="h-28 bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 animate-pulse" />)}</div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-4 mb-6">
            <StatCard icon={Eye} label="Pageviews" value={data.pageviews} />
            <StatCard icon={Users} label="Unique visitors" value={data.unique_visitors} />
            <StatCard icon={MousePointerClick} label="Clicks" value={data.clicks} />
          </div>

          <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-5 mb-6">
            <p className="text-green-900 dark:text-white font-bold text-sm mb-4">Traffic over time</p>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={data.daily}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5F5EC" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d) => d.slice(5)} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Line type="monotone" dataKey="pageviews" stroke="#059669" strokeWidth={2} dot={false} name="Pageviews" />
                <Line type="monotone" dataKey="clicks" stroke="#D97706" strokeWidth={2} dot={false} name="Clicks" />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-5">
              <p className="text-green-900 dark:text-white font-bold text-sm mb-4">Top pages</p>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={data.top_pages} layout="vertical" margin={{ left: 24 }}>
                  <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                  <YAxis type="category" dataKey="path" tick={{ fontSize: 10 }} width={120} />
                  <Tooltip />
                  <Bar dataKey="views" fill="#059669" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-5">
              <p className="text-green-900 dark:text-white font-bold text-sm mb-4">Most clicked</p>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={data.top_clicks} layout="vertical" margin={{ left: 24 }}>
                  <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                  <YAxis type="category" dataKey="label" tick={{ fontSize: 10 }} width={120} />
                  <Tooltip />
                  <Bar dataKey="clicks" fill="#D97706" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-5">
            <p className="text-green-900 dark:text-white font-bold text-sm mb-4">Visitors by role</p>
            <div className="flex gap-4 flex-wrap">
              {data.by_role.map(r => (
                <div key={r.role} className="bg-green-50 dark:bg-night-600 rounded-xl px-4 py-3">
                  <p className="text-green-400 dark:text-night-300 text-[11px] uppercase font-semibold capitalize">{r.role.replace('_', ' ')}</p>
                  <p className="text-green-900 dark:text-white text-lg font-extrabold">{r.visitors.toLocaleString()}</p>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
