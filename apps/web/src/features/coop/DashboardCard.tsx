import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ChevronRight, HeartHandshake, Sparkles } from 'lucide-react'
import { formatNaira } from '@/lib/utils'
import { useCoopStatus } from './api'

/** Sits under the wallet card on the customer dashboard. Only appears for people the cooperative is open to. */
export function CoopDashboardCard() {
  const nav = useNavigate()
  const { data: s } = useCoopStatus()
  if (!s?.access) return null

  if (!s.is_member || !s.member) {
    return (
      <motion.button
        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
        onClick={() => nav('/coop')}
        className="relative mb-4 w-full overflow-hidden rounded-3xl bg-gradient-to-br from-amber-400 to-amber-500 p-4 text-left shadow-card active:scale-[0.99]"
      >
        <div className="absolute -right-6 -top-6 h-28 w-28 rounded-full bg-white/25" />
        <div className="relative flex items-center gap-3">
          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-green-900/90"><Sparkles className="h-6 w-6 text-amber-300" /></div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-extrabold uppercase tracking-widest text-green-900/70">New</p>
            <p className="text-lg font-extrabold leading-tight text-green-950">Join the MonieKing Cooperative</p>
            <p className="text-xs font-semibold text-green-900/80">Save together, get loans backed by members, share the yearly profit.</p>
          </div>
          <span className="flex h-9 flex-shrink-0 items-center rounded-full bg-green-900 px-3 text-xs font-extrabold text-white">Join<ChevronRight className="h-4 w-4" /></span>
        </div>
      </motion.button>
    )
  }

  const m = s.member
  return (
    <motion.button
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
      onClick={() => nav('/coop')}
      className="mb-4 w-full rounded-3xl border border-green-100 bg-white p-4 text-left shadow-card active:scale-[0.99] dark:border-night-500 dark:bg-night-700"
    >
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl bg-green-100 dark:bg-night-600"><HeartHandshake className="h-5 w-5 text-green-700 dark:text-night-100" /></div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-widest text-green-500 dark:text-night-300">Cooperative · {m.card_no}</p>
          <p className="text-lg font-extrabold text-green-900 dark:text-white">{formatNaira(m.contribution_kobo)}</p>
          <p className="truncate text-xs text-green-600 dark:text-night-200">
            {s.active_loan ? `Loan ${s.active_loan.loan_no} · ${s.active_loan.status.replace(/_/g, ' ')}` : (s.pending_invites ?? 0) > 0 ? `${s.pending_invites} guarantor request waiting` : 'Open your cooperative'}
          </p>
        </div>
        <ChevronRight className="h-5 w-5 flex-shrink-0 text-green-300 dark:text-night-400" />
      </div>
    </motion.button>
  )
}
