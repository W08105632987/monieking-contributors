import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Eye, Users, MousePointerClick } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
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
}

const RANGE_OPTIONS = [
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'all', label: 'All time' },
] as const

function StatCard({ icon: Icon, label, value }: { icon: any; label: string; value: number }) {
  return (
    <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-600 shadow-card p-4">
      <div className="w-8 h-8 rounded-xl bg-green-100 dark:bg-night-600 flex items-center justify-center mb-2.5">
        <Icon className="w-4 h-4 text-green-700 dark:text-night-100" />
      </div>
      <p className="text-green-500 dark:text-night-200 text-[11px] font-semibold uppercase tracking-wide mb-1">{label}</p>
      <p className="text-green-900 dark:text-white text-xl font-extrabold">{value.toLocaleString()}</p>
    </div>
  )
}

export default function LiveMetricsPage() {
  const navigate = useNavigate()
  const [range, setRange] = useState<'7d' | '30d' | 'all'>('7d')

  const { start_date, end_date } = (() => {
    if (range === 'all') return { start_date: undefined, end_date: undefined }
    const end = new Date()
    const start = new Date()
    start.setDate(start.getDate() - (range === '7d' ? 6 : 29))
    return { start_date: start.toISOString().slice(0, 10), end_date: end.toISOString().slice(0, 10) }
  })()

  const { data, isLoading } = useQuery({
    queryKey: ['director-live-metrics', range],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (start_date) params.set('start_date', start_date)
      if (end_date) params.set('end_date', end_date)
      return (await api.get<AnalyticsOverview>(`/analytics/overview?${params}`)).data
    },
  })

  return (
    <div className="min-h-dvh flex flex-col bg-green-50 dark:bg-night-800">
      <header className="flex items-center gap-3 px-4 py-3 bg-green-50 dark:bg-night-800">
        <button onClick={() => navigate(-1)} className="w-9 h-9 rounded-full bg-white dark:bg-night-700 border border-green-100 dark:border-night-600 flex items-center justify-center text-green-700 dark:text-night-100 shadow-xs">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h1 className="text-green-900 dark:text-white font-extrabold text-lg">Live metrics</h1>
      </header>

      <div className="flex-1 overflow-y-auto px-4 pb-safe-nav">
        <div className="flex items-center gap-2 mb-4 overflow-x-auto no-scrollbar">
          {RANGE_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setRange(opt.value)}
              className={cn(
                'flex-shrink-0 px-3.5 py-2 rounded-full text-xs font-bold whitespace-nowrap transition-colors',
                range === opt.value
                  ? 'bg-green-900 dark:bg-night-100 text-white dark:text-night-900 shadow-card'
                  : 'bg-white dark:bg-night-700 border border-green-200 dark:border-night-600 text-green-600 dark:text-night-200',
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {isLoading || !data ? (
          <div className="grid grid-cols-3 gap-3">{[1, 2, 3].map(i => <div key={i} className="h-24 bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-600 animate-pulse" />)}</div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3 mb-4">
              <StatCard icon={Eye} label="Pageviews" value={data.pageviews} />
              <StatCard icon={Users} label="Visitors" value={data.unique_visitors} />
              <StatCard icon={MousePointerClick} label="Clicks" value={data.clicks} />
            </div>

            <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-600 shadow-card p-4 mb-4">
              <p className="text-green-900 dark:text-white font-bold text-sm mb-3">Traffic over time</p>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={data.daily}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2A2F57" opacity={0.3} />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(d) => d.slice(5)} />
                  <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                  <Tooltip />
                  <Line type="monotone" dataKey="pageviews" stroke="#059669" strokeWidth={2} dot={false} name="Pageviews" />
                  <Line type="monotone" dataKey="clicks" stroke="#D97706" strokeWidth={2} dot={false} name="Clicks" />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-600 shadow-card p-4 mb-4">
              <p className="text-green-900 dark:text-white font-bold text-sm mb-3">Top pages</p>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={data.top_pages} layout="vertical" margin={{ left: 16 }}>
                  <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
                  <YAxis type="category" dataKey="path" tick={{ fontSize: 9 }} width={100} />
                  <Tooltip />
                  <Bar dataKey="views" fill="#059669" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-600 shadow-card p-4 mb-4">
              <p className="text-green-900 dark:text-white font-bold text-sm mb-3">Most clicked</p>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={data.top_clicks} layout="vertical" margin={{ left: 16 }}>
                  <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
                  <YAxis type="category" dataKey="label" tick={{ fontSize: 9 }} width={100} />
                  <Tooltip />
                  <Bar dataKey="clicks" fill="#D97706" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-600 shadow-card p-4">
              <p className="text-green-900 dark:text-white font-bold text-sm mb-3">Visitors by role</p>
              <div className="flex gap-3 flex-wrap">
                {data.by_role.map(r => (
                  <div key={r.role} className="bg-green-50 dark:bg-night-600 rounded-xl px-3.5 py-2.5">
                    <p className="text-green-400 dark:text-night-300 text-[10px] uppercase font-semibold capitalize">{r.role.replace('_', ' ')}</p>
                    <p className="text-green-900 dark:text-white text-base font-extrabold">{r.visitors.toLocaleString()}</p>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
