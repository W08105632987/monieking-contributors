import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowUpRight, Building2, RefreshCw, X
} from 'lucide-react'
import toast from 'react-hot-toast'
import { api, getErrorMessage } from '@/lib/api'
import { useAuthStore } from '@/store/auth.store'
import { WorkerHeader } from '@/components/worker/WorkerHeader'
import { formatNaira } from '@/lib/utils'

interface PayoutItem {
  id: string
  amount_kobo: number
  account_number: string
  account_name: string
  bank_name: string
  status: 'pending' | 'paid' | 'rejected'
  rejection_reason?: string | null
  created_at: string
  reviewed_at?: string | null
}

interface CompletedJob {
  id: string
  service_category: string
  service_type: string
  worker_commission_kobo: number
  status: string
  completed_at: string
}

export default function WorkerEarningsPage() {
  const { user } = useAuthStore()
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<'payouts' | 'history'>('payouts')
  const [isPayoutModalOpen, setIsPayoutModalOpen] = useState(false)
  const [payoutAmountNaira, setPayoutAmountNaira] = useState('')

  // Summary query
  const { data: summary } = useQuery({
    queryKey: ['worker-earnings-summary'],
    queryFn: async () => {
      const res = await api.get('/worker/earnings/summary')
      return res.data
    },
  })

  // Payout history query
  const { data: payouts, isLoading: loadingPayouts } = useQuery({
    queryKey: ['worker-payouts'],
    queryFn: async () => {
      const res = await api.get('/worker/earnings/payouts')
      return res.data?.data as PayoutItem[]
    },
  })

  // Completed jobs query
  const { data: completedJobs, isLoading: loadingJobs } = useQuery({
    queryKey: ['worker-completed-jobs'],
    queryFn: async () => {
      const res = await api.get('/worker/jobs/mine')
      const allJobs = res.data?.data as CompletedJob[]
      // Backend emits 'successful' (not 'completed') for resolved jobs
      return allJobs.filter((j) => j.status === 'successful')
    },
  })

  const commissionBalanceKobo = summary?.commission_balance_kobo ?? user?.commission_balance_kobo ?? 0
  const maxNaira = Math.floor(commissionBalanceKobo / 100)

  // Payout request mutation
  const payoutMutation = useMutation({
    mutationFn: async (amountKobo: number) => {
      const res = await api.post('/worker/earnings/payout-request', {
        amount_kobo: amountKobo,
        bank_name: user?.bank_name || 'Standard Bank',
        account_number: user?.account_number || '',
        account_name: user?.account_name || user?.full_name || '',
      })
      return res.data
    },
    onSuccess: () => {
      toast.success('Payout request submitted for Director review!')
      setIsPayoutModalOpen(false)
      setPayoutAmountNaira('')
      queryClient.invalidateQueries({ queryKey: ['worker-earnings-summary'] })
      queryClient.invalidateQueries({ queryKey: ['worker-payouts'] })
    },
    onError: (err) => {
      toast.error(getErrorMessage(err))
    },
  })

  const handleRequestPayout = (e: React.FormEvent) => {
    e.preventDefault()
    const amountVal = parseFloat(payoutAmountNaira || '0')
    const kobo = Math.round(amountVal * 100)

    if (kobo <= 0) {
      toast.error('Please enter a valid amount')
      return
    }
    if (kobo > commissionBalanceKobo) {
      toast.error('Amount exceeds your available commission balance')
      return
    }
    if (!user?.account_number) {
      toast.error('Please set your bank account details first')
      return
    }

    payoutMutation.mutate(kobo)
  }

  return (
    <div className="min-h-dvh flex flex-col bg-surface dark:bg-night-900 pb-24 text-green-950 dark:text-white">
      <WorkerHeader title="Earnings & Wallet" subtitle="Commissions, payouts & withdrawals" />

      <main className="flex-1 px-4 py-4 space-y-5 max-w-lg mx-auto w-full">
        {/* Big Balance Hero */}
        <div className="p-5 rounded-3xl bg-gradient-to-br from-green-900 via-green-950 to-green-900 text-white shadow-xl border border-green-800 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase font-bold tracking-wider text-amber-400">
              Available Commission Balance
            </span>
            <span className="text-[10px] bg-white/10 px-2 py-0.5 rounded-full text-green-200">
              Instant
            </span>
          </div>

          <div className="font-mono text-3xl sm:text-4xl font-black text-white">
            {formatNaira(commissionBalanceKobo)}
          </div>

          {((summary?.commission_held_kobo ?? 0) > 0 || (summary?.commission_debt_kobo ?? 0) > 0) && (
            <div className="bg-black/25 rounded-2xl p-2.5 space-y-1 text-xs border border-white/10">
              {(summary?.commission_held_kobo ?? 0) > 0 && (
                <div className="flex items-center justify-between text-amber-300">
                  <span>Held pending dispute:</span>
                  <span className="font-mono font-bold">{formatNaira(summary?.commission_held_kobo ?? 0)}</span>
                </div>
              )}
              {(summary?.commission_debt_kobo ?? 0) > 0 && (
                <div className="flex items-center justify-between text-red-300">
                  <span>Owed from reversed job:</span>
                  <span className="font-mono font-bold">- {formatNaira(summary?.commission_debt_kobo ?? 0)}</span>
                </div>
              )}
            </div>
          )}

          {/* Quick Metrics */}
          <div className="grid grid-cols-2 gap-3 pt-3 border-t border-white/10 text-xs">
            <div>
              <span className="text-green-300 text-[11px] block">Lifetime Earned</span>
              <span className="font-mono font-bold text-white text-sm">
                {formatNaira(summary?.lifetime_earned_kobo ?? 0)}
              </span>
            </div>
            <div>
              <span className="text-green-300 text-[11px] block">Total Withdrawn</span>
              <span className="font-mono font-bold text-white text-sm">
                {formatNaira(summary?.paid_out_kobo ?? 0)}
              </span>
            </div>
          </div>

          {/* Withdraw Button */}
          <button
            onClick={() => setIsPayoutModalOpen(true)}
            disabled={commissionBalanceKobo <= 0}
            className="w-full py-3 rounded-2xl bg-brand-gold hover:bg-brand-gold-light disabled:opacity-40 disabled:cursor-not-allowed text-green-950 font-black text-xs transition-all active:scale-[0.99] flex items-center justify-center gap-2 shadow"
          >
            <ArrowUpRight className="w-4 h-4" />
            Request Bank Payout
          </button>
        </div>

        {/* Bank Account Snapshot */}
        <div className="p-3.5 rounded-2xl bg-white dark:bg-night-800 border border-green-100 dark:border-night-700 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-green-50 dark:bg-night-700 flex items-center justify-center text-green-700 dark:text-night-200">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-bold text-green-950 dark:text-white">
                {user?.bank_name || 'No Bank Added'}
              </p>
              <p className="text-[11px] font-mono text-green-700 dark:text-night-400">
                {user?.account_number || '••••••••••'} • {user?.account_name || user?.full_name}
              </p>
            </div>
          </div>
          <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-md border border-emerald-200 dark:border-emerald-800">
            Payout Bank
          </span>
        </div>

        {/* Tab Switcher */}
        <div className="grid grid-cols-2 gap-2 p-1 bg-green-100/60 dark:bg-night-800 rounded-2xl">
          <button
            onClick={() => setActiveTab('payouts')}
            className={`py-2 text-xs font-bold rounded-xl transition-all ${
              activeTab === 'payouts'
                ? 'bg-white dark:bg-night-700 text-green-950 dark:text-white shadow-sm'
                : 'text-green-700 dark:text-night-300'
            }`}
          >
            Payout Requests
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`py-2 text-xs font-bold rounded-xl transition-all ${
              activeTab === 'history'
                ? 'bg-white dark:bg-night-700 text-green-950 dark:text-white shadow-sm'
                : 'text-green-700 dark:text-night-300'
            }`}
          >
            Completed Jobs ({summary?.jobs_completed ?? completedJobs?.length ?? 0})
          </button>
        </div>

        {/* Tab 1: Payout Requests */}
        {activeTab === 'payouts' && (
          <div className="space-y-3">
            {loadingPayouts ? (
              <div className="py-8 text-center text-xs text-green-600 dark:text-night-400">
                <RefreshCw className="w-4 h-4 animate-spin mx-auto mb-1 text-green-600" />
                Loading payouts...
              </div>
            ) : !payouts || payouts.length === 0 ? (
              <div className="py-12 text-center rounded-2xl bg-white dark:bg-night-800 border border-green-100 dark:border-night-700 text-xs text-green-600 dark:text-night-400">
                No payout requests yet.
              </div>
            ) : (
              payouts.map((p) => (
                <div
                  key={p.id}
                  className="p-3.5 rounded-2xl bg-white dark:bg-night-800 border border-green-100 dark:border-night-700 shadow-sm flex items-center justify-between"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-sm text-green-950 dark:text-white">
                        {formatNaira(p.amount_kobo)}
                      </span>
                      <span
                        className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                          p.status === 'paid'
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                            : p.status === 'rejected'
                            ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300'
                            : 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
                        }`}
                      >
                        {p.status === 'paid' ? 'Paid ✓' : p.status}
                      </span>
                    </div>
                    <p className="text-[11px] text-green-700 dark:text-night-400 mt-0.5">
                      To {p.bank_name} ({p.account_number})
                    </p>
                    {p.rejection_reason && (
                      <p className="text-[11px] text-rose-600 dark:text-rose-400 mt-1">
                        Reason: {p.rejection_reason}
                      </p>
                    )}
                  </div>
                  <span className="text-[10px] text-green-600 dark:text-night-400">
                    {new Date(p.created_at).toLocaleDateString()}
                  </span>
                </div>
              ))
            )}
          </div>
        )}

        {/* Tab 2: Completed Jobs */}
        {activeTab === 'history' && (
          <div className="space-y-3">
            {loadingJobs ? (
              <div className="py-8 text-center text-xs text-green-600 dark:text-night-400">
                <RefreshCw className="w-4 h-4 animate-spin mx-auto mb-1 text-green-600" />
                Loading job history...
              </div>
            ) : !completedJobs || completedJobs.length === 0 ? (
              <div className="py-12 text-center rounded-2xl bg-white dark:bg-night-800 border border-green-100 dark:border-night-700 text-xs text-green-600 dark:text-night-400">
                No completed jobs yet. Claim and resolve jobs to earn commission!
              </div>
            ) : (
              completedJobs.map((j) => (
                <div
                  key={j.id}
                  className="p-3.5 rounded-2xl bg-white dark:bg-night-800 border border-green-100 dark:border-night-700 shadow-sm flex items-center justify-between"
                >
                  <div>
                    <h4 className="font-bold text-xs text-green-950 dark:text-white">
                      {j.service_type || j.service_category.toUpperCase()}
                    </h4>
                    <p className="text-[11px] text-green-700 dark:text-night-400 mt-0.5">
                      Completed {new Date(j.completed_at || '').toLocaleDateString()}
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="font-mono font-bold text-xs text-emerald-600 dark:text-emerald-400">
                      +{formatNaira(j.worker_commission_kobo)}
                    </span>
                    <span className="block text-[10px] text-emerald-700 dark:text-emerald-300 font-semibold">
                      Credited ✓
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </main>

      {/* Payout Modal Sheet */}
      <AnimatePresence>
        {isPayoutModalOpen && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 280 }}
              className="bg-white dark:bg-night-800 rounded-t-3xl sm:rounded-3xl w-full max-w-lg p-5 space-y-4 border border-green-100 dark:border-night-700"
            >
              <div className="flex items-center justify-between pb-2 border-b border-green-100 dark:border-night-700">
                <h3 className="font-black text-base text-green-950 dark:text-white">
                  Request Bank Payout
                </h3>
                <button
                  onClick={() => setIsPayoutModalOpen(false)}
                  className="w-8 h-8 rounded-full bg-green-100 dark:bg-night-700 flex items-center justify-center text-green-700 dark:text-night-200"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleRequestPayout} className="space-y-4">
                <div>
                  <div className="flex justify-between text-xs font-bold text-green-900 dark:text-night-200 mb-1">
                    <span>Amount (₦)</span>
                    <span className="text-green-600 dark:text-night-400">
                      Max: {formatNaira(commissionBalanceKobo)}
                    </span>
                  </div>
                  <input
                    type="number"
                    min="100"
                    max={maxNaira}
                    required
                    value={payoutAmountNaira}
                    onChange={(e) => setPayoutAmountNaira(e.target.value)}
                    placeholder="Enter amount to withdraw"
                    className="w-full p-3 rounded-xl border border-green-200 dark:border-night-700 bg-white dark:bg-night-900 text-green-950 dark:text-white text-base font-mono font-bold outline-none focus:border-green-600"
                  />
                </div>

                <div className="p-3 rounded-xl bg-green-50 dark:bg-night-900 border border-green-100 dark:border-night-700 text-xs space-y-1">
                  <div className="flex justify-between text-green-800 dark:text-night-300">
                    <span>Destination Bank:</span>
                    <span className="font-bold text-green-950 dark:text-white">{user?.bank_name}</span>
                  </div>
                  <div className="flex justify-between text-green-800 dark:text-night-300">
                    <span>Account Number:</span>
                    <span className="font-mono font-bold text-green-950 dark:text-white">{user?.account_number}</span>
                  </div>
                  <div className="flex justify-between text-green-800 dark:text-night-300">
                    <span>Account Name:</span>
                    <span className="font-bold text-green-950 dark:text-white">{user?.account_name}</span>
                  </div>
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setIsPayoutModalOpen(false)}
                    className="flex-1 py-3 rounded-xl border border-green-200 dark:border-night-700 text-green-800 dark:text-night-300 font-bold text-xs"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={payoutMutation.isPending}
                    className="flex-1 py-3 rounded-xl bg-green-700 hover:bg-green-800 text-white font-bold text-xs shadow-md transition-all active:scale-[0.99] flex items-center justify-center gap-2"
                  >
                    {payoutMutation.isPending ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <span>Submit Payout</span>
                    )}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  )
}
