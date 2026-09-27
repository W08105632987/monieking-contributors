import { useState, useMemo } from 'react'
import { Avatar } from '@/components/ui/Avatar'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  Clock, CheckCircle, XCircle, TrendingUp,
  ArrowUpRight, AlertTriangle, ChevronRight, ChevronDown,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuthStore } from '@/store/auth.store'
import { BottomNav } from '@/components/layout/BottomNav'
import { PromoBannerCarousel } from '@/components/dashboard/PromoBannerCarousel'
import { CustomerStatsPanel } from '@/components/dashboard/CustomerStatsPanel'
import { useWithdrawalRealtime } from '@/hooks/useWithdrawalRealtime'
import { formatNaira, timeAgo } from '@/lib/utils'
import { cn } from '@/lib/utils'
import type { Withdrawal, SystemAnalytics } from '@/types'
import { BrandBlobLogo } from '@/components/brand/BrandBlobLogo'

function currentMonthValue() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function periodToDateRange(period: string): { start_date?: string; end_date?: string } {
  if (period === 'all') return {}
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  if (period === 'today') {
    const today = fmt(new Date())
    return { start_date: today, end_date: today }
  }
  const [year, month] = period.split('-').map(Number)
  const start = new Date(year, month - 1, 1)
  const end = new Date(year, month, 0) // last day of that month
  return { start_date: fmt(start), end_date: fmt(end) }
}

function useRecentMonthOptions() {
  return useMemo(() => {
    const now = new Date()
    // "Today" sits right after "All time" — a director opening this
    // first thing wants either the full history or right now, not to
    // hunt through a month list for a single day.
    const opts: { value: string; label: string }[] = [
      { value: 'all', label: 'All time' },
      { value: 'today', label: 'Today' },
    ]
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const label = d.toLocaleString('default', { month: 'long', year: 'numeric' })
      opts.push({ value, label })
    }
    return opts
  }, [])
}

const fadeUp = {
  hidden: { opacity: 0, y: 14 },
  show: (i: number) => ({
    opacity: 1, y: 0,
    transition: { delay: i * 0.07, type: 'spring', stiffness: 300, damping: 28 },
  }),
}

// ── Withdrawal status badge ───────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; classes: string }> = {
    pending:  { label: 'Pending',    classes: 'bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300' },
    claimed:  { label: 'Processing', classes: 'bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300' },
    paid:     { label: 'Paid',       classes: 'bg-green-100 dark:bg-green-950/40 text-green-700 dark:text-green-300' },
    rejected: { label: 'Rejected',   classes: 'bg-red-100 dark:bg-red-950/40 text-red-500 dark:text-red-400' },
  }
  const { label, classes } = map[status] ?? map.pending
  return <span className={cn('text-xs font-bold px-2.5 py-1 rounded-full', classes)}>{label}</span>
}

// ── Withdrawal row ────────────────────────────────────────────────
function WithdrawalRow({ w, onClick }: { w: Withdrawal; onClick: () => void }) {
  const isUrgent = w.status === 'pending' &&
    (Date.now() - new Date(w.requested_at).getTime()) > 1000 * 60 * 60 * 20 // >20h

  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 py-3.5 border-b border-green-50 dark:border-night-600 last:border-0 active:bg-green-50/50 dark:active:bg-night-600/50 transition-all text-left"
    >
      <div className={cn(
        'w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0',
        isUrgent ? 'bg-red-50 dark:bg-red-950/40' : 'bg-green-50 dark:bg-night-600',
      )}>
        {isUrgent
          ? <AlertTriangle className="w-5 h-5 text-red-400" />
          : <ArrowUpRight   className="w-5 h-5 text-green-500 dark:text-green-400" />
        }
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="text-green-900 dark:text-white text-sm font-semibold truncate">
            {w.customer_name ?? 'Customer'}
          </p>
          {isUrgent && (
            <span className="text-xs font-bold text-red-500 dark:text-red-300 bg-red-50 dark:bg-red-950/50 px-1.5 py-0.5 rounded-full flex-shrink-0">Urgent</span>
          )}
        </div>
        <p className="text-green-400 dark:text-night-300 text-xs mt-0.5">{timeAgo(w.requested_at)}</p>
      </div>
      <div className="text-right flex-shrink-0 flex items-center gap-2">
        <div>
          <p className="text-green-900 dark:text-white text-sm font-bold">{formatNaira(w.net_payable_kobo)}</p>
          <StatusBadge status={w.status} />
        </div>
        <ChevronRight className="w-4 h-4 text-green-300 dark:text-night-400" />
      </div>
    </button>
  )
}

// ── Main page ─────────────────────────────────────────────────────
export default function DirectorDashboardPage() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  useWithdrawalRealtime()

  const { data: withdrawals = [], isLoading } = useQuery({
    queryKey: ['director-withdrawals'],
    queryFn: async () => {
      const { data } = await api.get<Withdrawal[]>('/withdrawals?page_size=50')
      return data
    },
    refetchInterval: 30_000, // auto-refresh every 30s
  })

  const pending   = withdrawals.filter(w => w.status === 'pending')
  const claimed   = withdrawals.filter(w => w.status === 'claimed')
  const paid      = withdrawals.filter(w => w.status === 'paid')
  const rejected  = withdrawals.filter(w => w.status === 'rejected')
  const urgent    = pending.filter(w =>
    (Date.now() - new Date(w.requested_at).getTime()) > 1000 * 60 * 60 * 20
  )

  const [heroPeriod, setHeroPeriod] = useState(currentMonthValue())
  const [showPeriodPicker, setShowPeriodPicker] = useState(false)
  const monthOptions = useRecentMonthOptions()

  const { data: heroAnalytics } = useQuery({
    queryKey: ['director-hero-analytics', heroPeriod],
    queryFn: async () => {
      const { start_date, end_date } = periodToDateRange(heroPeriod)
      const params = new URLSearchParams()
      if (start_date) params.set('start_date', start_date)
      if (end_date) params.set('end_date', end_date)
      const { data } = await api.get<SystemAnalytics>(`/admin/analytics?${params.toString()}`)
      return data
    },
  })

  const heroPeriodLabel = monthOptions.find(o => o.value === heroPeriod)?.label ?? 'This month'

  const recentWithdrawals = [...pending, ...claimed]
    .sort((a, b) => new Date(a.requested_at).getTime() - new Date(b.requested_at).getTime())
    .slice(0, 8)

  return (
    <div className="min-h-dvh flex flex-col bg-green-50 dark:bg-night-800">

      {/* Top bar */}
      <header className="flex items-center justify-between px-4 py-3 bg-green-50 dark:bg-night-800">
        <BrandBlobLogo height={36} />
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold bg-green-900 text-amber-400 px-2.5 py-1 rounded-full">Director</span>
          <button onClick={() => navigate('/director/profile')} className="rounded-full shadow-card">
          <Avatar name={user?.full_name ?? 'D'} avatarUrl={user?.avatar_url} size={40} />
        </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto pb-40 px-4">

        {/* Greeting */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-2 mb-4">
          <p className="text-green-500 dark:text-night-200 text-xs font-semibold uppercase tracking-widest">Director portal</p>
          <h1 className="text-green-900 dark:text-white text-2xl font-extrabold mt-0.5">
            {user?.full_name.split(' ').slice(0, 2).join(' ')}
          </h1>
        </motion.div>

        {/* Promo banners */}
        <motion.div custom={0} variants={fadeUp} initial="hidden" animate="show">
          <PromoBannerCarousel />
        </motion.div>

        {/* Urgent alert */}
        {urgent.length > 0 && (
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-red-50 dark:bg-red-950/30 border-2 border-red-200 dark:border-red-900 rounded-2xl p-4 mb-4 flex items-center gap-3"
          >
            <div className="w-10 h-10 bg-red-100 dark:bg-red-900/40 rounded-xl flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="w-5 h-5 text-red-500 dark:text-red-400" />
            </div>
            <div className="flex-1">
              <p className="text-red-700 dark:text-red-200 font-bold text-sm">
                {urgent.length} urgent withdrawal{urgent.length > 1 ? 's' : ''}
              </p>
              <p className="text-red-400 dark:text-red-300 text-xs mt-0.5">
                Approaching 24-hour SLA — process immediately
              </p>
            </div>
            <button
              onClick={() => navigate('/director/withdrawals')}
              className="bg-red-500 hover:bg-red-600 text-white text-xs font-bold rounded-full px-3 py-1.5 active:scale-95 transition-all"
            >
              Process
            </button>
          </motion.div>
        )}

        {/* Summary hero */}
        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.35 }}
          className="relative rounded-3xl mb-4"
          style={{ background: 'linear-gradient(135deg, #052E16 0%, #064E3B 60%, #065F46 100%)' }}
        >
          <div className="absolute inset-0 rounded-3xl overflow-hidden pointer-events-none">
            <div className="absolute rounded-full opacity-25" style={{ width: 160, height: 160, background: '#059669', top: -40, right: -30 }} />
            <div className="absolute rounded-full opacity-15" style={{ width: 100, height: 100, background: '#34D399', top: 10, right: 20 }} />
          </div>
          <div className="relative z-10 p-5">
            <div className="flex items-center justify-between mb-1">
              <p className="text-green-300 text-xs font-semibold uppercase tracking-widest">Total paid out</p>
              <button
                onClick={() => setShowPeriodPicker(s => !s)}
                className="flex items-center gap-1 bg-white/10 rounded-full px-3 py-1 text-white text-xs font-semibold"
              >
                {heroPeriodLabel} <ChevronDown className="w-3 h-3" />
              </button>
            </div>
            {showPeriodPicker && (
              <div className="absolute right-5 top-11 z-20 bg-white dark:bg-night-700 border border-green-100 dark:border-night-600 rounded-2xl shadow-xl py-2 max-h-64 overflow-y-auto w-44">
                {monthOptions.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => { setHeroPeriod(opt.value); setShowPeriodPicker(false) }}
                    className={cn(
                      'w-full text-left px-4 py-2 text-xs font-semibold',
                      opt.value === heroPeriod ? 'text-green-900 dark:text-white bg-green-50 dark:bg-night-600' : 'text-green-600 dark:text-night-200',
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
            <p className="text-white text-4xl font-extrabold tracking-tight mb-1">
              {formatNaira(heroAnalytics?.total_paid_out_kobo ?? 0)}
            </p>
            <p className="text-green-400 text-xs mb-5">
              Charges collected: {formatNaira(heroAnalytics?.total_charges_kobo ?? 0)}
            </p>
            <button
              onClick={() => navigate('/director/withdrawals')}
              className="flex items-center justify-center gap-2 bg-amber-400 text-green-900 font-bold text-sm rounded-full px-6 py-3 active:scale-95 transition-all"
            >
              <ArrowUpRight className="w-4 h-4" /> Process withdrawals
            </button>
          </div>
        </motion.div>

        {/* Total contributed — same period filter as the hero above */}
        <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-600 shadow-card p-4 mb-4">
          <div className="flex items-center justify-between mb-1">
            <p className="text-green-500 dark:text-night-200 text-xs font-semibold uppercase tracking-widest">Total contributed</p>
            <span className="text-green-400 dark:text-night-300 text-xs font-semibold">{heroPeriodLabel}</span>
          </div>
          <p className="text-green-900 dark:text-white text-2xl font-extrabold">
            {formatNaira(heroAnalytics?.total_contributed_kobo ?? 0)}
          </p>
        </div>

        {/* Customer statistics — total/food/regular/active/inactive
            contributors, new signups, and total value currently held,
            platform-wide, with its own Today/7-days/Custom filter and
            an expandable inactive-customers + bulk-ping section. */}
        <CustomerStatsPanel scope={{ kind: 'general' }} />

        {/* Stats grid */}
        <motion.div custom={0} variants={fadeUp} initial="hidden" animate="show" className="grid grid-cols-2 gap-3 mb-4">
          <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-600 shadow-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 bg-amber-50 dark:bg-night-600 rounded-xl flex items-center justify-center">
                <Clock className="w-4 h-4 text-amber-500 dark:text-amber-400" />
              </div>
              <p className="text-green-500 dark:text-night-200 text-xs font-semibold uppercase tracking-wide">Pending</p>
            </div>
            <p className="text-green-900 dark:text-white text-2xl font-extrabold">{pending.length}</p>
            <p className="text-green-400 dark:text-night-300 text-xs mt-0.5">awaiting processing</p>
          </div>
          <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-600 shadow-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 bg-blue-50 dark:bg-night-600 rounded-xl flex items-center justify-center">
                <TrendingUp className="w-4 h-4 text-blue-500 dark:text-blue-400" />
              </div>
              <p className="text-green-500 dark:text-night-200 text-xs font-semibold uppercase tracking-wide">Processing</p>
            </div>
            <p className="text-green-900 dark:text-white text-2xl font-extrabold">{claimed.length}</p>
            <p className="text-green-400 dark:text-night-300 text-xs mt-0.5">claimed by directors</p>
          </div>
          <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-600 shadow-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 bg-green-100 dark:bg-night-600 rounded-xl flex items-center justify-center">
                <CheckCircle className="w-4 h-4 text-green-600 dark:text-green-400" />
              </div>
              <p className="text-green-500 dark:text-night-200 text-xs font-semibold uppercase tracking-wide">Paid</p>
            </div>
            <p className="text-green-900 dark:text-white text-2xl font-extrabold">{paid.length}</p>
            <p className="text-green-400 dark:text-night-300 text-xs mt-0.5">completed payouts</p>
          </div>
          <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-600 shadow-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 bg-red-50 dark:bg-night-600 rounded-xl flex items-center justify-center">
                <XCircle className="w-4 h-4 text-red-400" />
              </div>
              <p className="text-green-500 dark:text-night-200 text-xs font-semibold uppercase tracking-wide">Rejected</p>
            </div>
            <p className="text-green-900 dark:text-white text-2xl font-extrabold">{rejected.length}</p>
            <p className="text-green-400 dark:text-night-300 text-xs mt-0.5">declined requests</p>
          </div>
        </motion.div>

        {/* Pending queue */}
        <motion.div custom={1} variants={fadeUp} initial="hidden" animate="show">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-green-900 dark:text-white font-bold text-base">
              Withdrawal queue
              {pending.length > 0 && (
                <span className="ml-2 text-xs font-bold bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 px-2 py-0.5 rounded-full">
                  {pending.length} pending
                </span>
              )}
            </h2>
            <button
              onClick={() => navigate('/director/withdrawals')}
              className="text-green-600 dark:text-night-200 text-xs font-semibold hover:underline"
            >
              View all
            </button>
          </div>

          {isLoading ? (
            <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-600 shadow-card px-4">
              {[1, 2, 3].map(i => (
                <div key={i} className="flex gap-3 py-3.5 border-b border-green-50 dark:border-night-600 last:border-0">
                  <div className="w-10 h-10 bg-green-100 dark:bg-night-600 rounded-2xl animate-pulse flex-shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 bg-green-100 dark:bg-night-600 rounded animate-pulse w-2/3" />
                    <div className="h-2 bg-green-50 dark:bg-night-500 rounded animate-pulse w-1/3" />
                  </div>
                </div>
              ))}
            </div>
          ) : recentWithdrawals.length === 0 ? (
            <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-600 shadow-card text-center py-10 px-6">
              <CheckCircle className="w-10 h-10 text-green-300 dark:text-night-400 mx-auto mb-3" />
              <p className="text-green-700 dark:text-night-100 font-semibold text-sm">All clear!</p>
              <p className="text-green-400 dark:text-night-300 text-xs mt-1">No pending withdrawals at the moment</p>
            </div>
          ) : (
            <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-600 shadow-card px-4">
              {recentWithdrawals.map(w => (
                <WithdrawalRow
                  key={w.id}
                  w={w}
                  onClick={() => navigate('/director/withdrawals')}
                />
              ))}
            </div>
          )}
        </motion.div>
      </div>

      <BottomNav />
    </div>
  )
}