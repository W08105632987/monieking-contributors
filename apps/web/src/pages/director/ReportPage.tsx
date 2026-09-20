import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Wallet, CreditCard, TrendingUp } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { api } from '@/lib/api'
import { formatNaira } from '@/lib/utils'
import type { ProfitReport } from '@/types'

const COLORS = ['#052E16', '#D97706']

export default function ReportPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const startDate = params.get('start_date') ?? undefined
  const endDate = params.get('end_date') ?? undefined
  const label = params.get('label') ?? 'All time'

  const { data, isLoading } = useQuery({
    queryKey: ['profit-report', startDate, endDate],
    queryFn: async () => {
      const p = new URLSearchParams()
      if (startDate) p.set('start_date', startDate)
      if (endDate) p.set('end_date', endDate)
      const { data } = await api.get<ProfitReport>(`/admin/profit-report?${p.toString()}`)
      return data
    },
  })

  const pieData = data ? [
    { name: 'Contribution withdrawals', value: data.card_withdrawal_charges_kobo },
    { name: 'Instant wallet withdrawals', value: data.instant_withdrawal_charges_kobo },
  ] : []

  return (
    <div className="min-h-dvh flex flex-col bg-green-50 dark:bg-night-800">
      <header className="flex items-center gap-3 px-4 py-3 bg-green-50 dark:bg-night-800">
        <button onClick={() => navigate(-1)} className="w-9 h-9 rounded-full bg-white dark:bg-night-700 border border-green-100 dark:border-night-500 flex items-center justify-center">
          <ArrowLeft className="w-4 h-4 text-green-700 dark:text-night-100" />
        </button>
        <div>
          <h1 className="text-green-900 dark:text-white font-extrabold text-lg leading-tight">Profit report</h1>
          <p className="text-green-500 dark:text-night-200 text-xs">{label}</p>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 pb-10">
        {isLoading || !data ? (
          <div className="space-y-3">
            <div className="h-40 bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 animate-pulse" />
            <div className="h-24 bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 animate-pulse" />
            <div className="h-24 bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 animate-pulse" />
          </div>
        ) : (
          <>
            {/* Total profit hero */}
            <div
              className="relative rounded-3xl overflow-hidden mb-4 p-5"
              style={{ background: 'linear-gradient(135deg, #052E16 0%, #064E3B 60%, #065F46 100%)' }}
            >
              <p className="text-green-300 dark:text-night-300 text-xs font-semibold uppercase tracking-widest mb-1">Total company profit</p>
              <p className="text-white text-4xl font-extrabold tracking-tight">{formatNaira(data.total_profit_kobo)}</p>
              <p className="text-green-400 dark:text-night-300 text-xs mt-1">{label} · sum of all charges collected</p>
            </div>

            {/* Breakdown chart */}
            {data.total_profit_kobo > 0 && (
              <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-4 mb-4">
                <p className="text-green-900 dark:text-white font-bold text-sm mb-2">Breakdown</p>
                <div style={{ width: '100%', height: 200 }}>
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label={(d) => formatNaira(d.value)}>
                        {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <Tooltip formatter={(v: number) => formatNaira(v)} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* Source detail cards */}
            <div className="space-y-3">
              <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-9 h-9 bg-green-100 dark:bg-night-600 rounded-xl flex items-center justify-center">
                    <CreditCard className="w-4 h-4 text-green-700 dark:text-night-100" />
                  </div>
                  <div>
                    <p className="text-green-900 dark:text-white font-bold text-sm">Contribution card withdrawals</p>
                    <p className="text-green-400 dark:text-night-300 text-xs">{data.card_withdrawal_count} paid withdrawal{data.card_withdrawal_count === 1 ? '' : 's'}</p>
                  </div>
                </div>
                <p className="text-green-900 dark:text-white text-xl font-extrabold">{formatNaira(data.card_withdrawal_charges_kobo)}</p>
              </div>

              <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-9 h-9 bg-amber-50 dark:bg-amber-500 rounded-xl flex items-center justify-center">
                    <Wallet className="w-4 h-4 text-amber-600 dark:text-amber-300" />
                  </div>
                  <div>
                    <p className="text-green-900 dark:text-white font-bold text-sm">Instant wallet withdrawals</p>
                    <p className="text-green-400 dark:text-night-300 text-xs">{data.instant_withdrawal_count} paid withdrawal{data.instant_withdrawal_count === 1 ? '' : 's'}</p>
                  </div>
                </div>
                <p className="text-green-900 dark:text-white text-xl font-extrabold">{formatNaira(data.instant_withdrawal_charges_kobo)}</p>
              </div>

              <div className="bg-green-900 dark:bg-night-100 rounded-2xl p-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-amber-400 dark:text-night-100" />
                  <p className="text-white font-bold text-sm">Total profit</p>
                </div>
                <p className="text-amber-400 dark:text-night-100 font-extrabold text-lg">{formatNaira(data.total_profit_kobo)}</p>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
