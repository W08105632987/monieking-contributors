import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { CheckCircle, XCircle, Check } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { api, getErrorMessage } from '@/lib/api'
import { useAuthStore } from '@/store/auth.store'
import { Avatar } from '@/components/ui/Avatar'
import { useWithdrawalRealtime } from '@/hooks/useWithdrawalRealtime'
import { formatNaira, timeAgo, maskAccount } from '@/lib/utils'
import { cn } from '@/lib/utils'
import type { Withdrawal } from '@/types'
import { BrandBlobLogo } from '@/components/brand/BrandBlobLogo'

type Tab = 'pending' | 'claimed' | 'paid' | 'rejected'

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending:  'bg-amber-100 dark:bg-amber-500 text-amber-700 dark:text-amber-300',
    claimed:  'bg-blue-100 text-blue-700',
    paid:     'bg-green-100 dark:bg-night-600 text-green-700 dark:text-night-100',
    rejected: 'bg-red-100 dark:bg-red-900 text-red-500 dark:text-red-300',
  }
  const labels: Record<string, string> = {
    pending: 'Pending', claimed: 'Processing', paid: 'Paid', rejected: 'Rejected',
  }
  return (
    <span className={cn('text-xs font-bold px-2.5 py-1 rounded-full', map[status] ?? map.pending)}>
      {labels[status] ?? status}
    </span>
  )
}

// ── Process withdrawal sheet ──────────────────────────────────────
function ProcessSheet({ w, onClose }: { w: Withdrawal; onClose: () => void }) {
  const qc = useQueryClient()
  const { user } = useAuthStore()
  const [rejectReason, setRejectReason] = useState('')
  const [showReject, setShowReject]     = useState(false)

  const claimMutation = useMutation({
    mutationFn: () => api.post(`/withdrawals/${w.id}/claim`),
    onSuccess: () => { toast.success('Withdrawal claimed'); qc.invalidateQueries({ queryKey: ['director-withdrawals'] }); onClose() },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const paidMutation = useMutation({
    mutationFn: () => api.post(`/withdrawals/${w.id}/mark-paid`),
    onSuccess: () => { toast.success('Marked as paid — customer notified'); qc.invalidateQueries({ queryKey: ['director-withdrawals'] }); onClose() },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const rejectMutation = useMutation({
    mutationFn: () => api.post(`/withdrawals/${w.id}/reject`, { reason: rejectReason }),
    onSuccess: () => { toast.success('Withdrawal rejected — customer notified'); qc.invalidateQueries({ queryKey: ['director-withdrawals'] }); onClose() },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const isMine = w.claimed_by_director_id === user?.id

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-green-950/60 dark:bg-night-900/60 backdrop-blur-sm" />
      <motion.div
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        className="relative bg-white dark:bg-night-700 rounded-t-3xl w-full max-w-lg p-6 pb-10"
        onClick={e => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-green-200 dark:bg-night-500 rounded-full mx-auto mb-5" />
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-green-900 dark:text-white font-extrabold text-xl">Withdrawal request</h2>
          <StatusBadge status={w.status} />
        </div>

        {/* Customer info */}
        <div className="bg-green-50 dark:bg-night-600 rounded-2xl p-4 mb-4">
          <p className="text-green-500 dark:text-night-200 text-xs font-bold uppercase tracking-wide mb-3">Customer</p>
          <div className="flex items-center gap-3">
            <Avatar name={w.customer_name ?? 'Customer'} avatarUrl={w.customer_avatar_url} size={40} className="text-sm" />
            <div>
              <p className="text-green-900 dark:text-white font-bold text-sm">{w.customer_name ?? 'Customer'}</p>
              <p className="text-green-500 dark:text-night-200 text-xs">{w.account_number ? `••••${w.account_number.slice(-4)}` : ''}</p>
            </div>
          </div>
        </div>

        {/* Payment breakdown */}
        <div className="bg-white dark:bg-night-700 border border-green-100 dark:border-night-500 rounded-2xl p-4 mb-4 space-y-2.5">
          <p className="text-green-500 dark:text-night-200 text-xs font-bold uppercase tracking-wide mb-3">Payment breakdown</p>
          <div className="flex justify-between text-sm">
            <span className="text-green-600 dark:text-night-200">Requested amount</span>
            <span className="text-green-900 dark:text-white font-semibold">{formatNaira(w.requested_amount_kobo)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-green-600 dark:text-night-200">Processing charge</span>
            <span className="text-red-400 dark:text-red-300 font-semibold">- {formatNaira(w.charge_kobo)}</span>
          </div>
          <div className="h-px bg-green-100 dark:bg-night-600" />
          <div className="flex justify-between">
            <span className="text-green-900 dark:text-white font-bold">Amount to transfer</span>
            <span className="text-green-900 dark:text-white font-extrabold text-lg">{formatNaira(w.net_payable_kobo)}</span>
          </div>
        </div>

        {/* Bank details */}
        <div className="bg-amber-50 dark:bg-amber-500 border border-amber-200 dark:border-amber-500 rounded-2xl p-4 mb-5">
          <p className="text-amber-700 dark:text-amber-300 text-xs font-bold uppercase tracking-wide mb-2">Transfer to</p>
          <p className="text-green-900 dark:text-white font-bold text-sm">{w.account_name}</p>
          <p className="text-green-700 dark:text-night-100 text-sm font-semibold tracking-widest mt-0.5">{w.account_number}</p>
          <p className="text-green-500 dark:text-night-200 text-xs mt-0.5">{w.bank_name}</p>
        </div>

        {/* Requested time */}
        <p className="text-green-400 dark:text-night-300 text-xs text-center mb-5">
          Requested {timeAgo(w.requested_at)}
        </p>

        {/* Reject reason input */}
        <AnimatePresence>
          {showReject && (
            <motion.div
              initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden mb-4"
            >
              <label className="text-green-700 dark:text-night-100 text-xs font-bold uppercase tracking-wide block mb-1.5">Rejection reason</label>
              <textarea
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
                placeholder="Explain why this withdrawal is being rejected…"
                rows={3}
                className="w-full border border-green-200 dark:border-night-500 rounded-xl px-4 py-3 text-sm text-green-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Action buttons */}
        {w.status === 'pending' && (
          <button
            onClick={() => claimMutation.mutate()}
            disabled={claimMutation.isPending}
            className="w-full bg-green-900 dark:bg-night-100 text-white font-bold text-sm rounded-full py-4 active:scale-95 transition-all disabled:opacity-50 mb-2"
          >
            {claimMutation.isPending ? 'Claiming…' : 'Claim & process this withdrawal'}
          </button>
        )}

        {w.status === 'claimed' && isMine && (
          <div className="space-y-2">
            <button
              onClick={() => paidMutation.mutate()}
              disabled={paidMutation.isPending}
              className="w-full bg-green-600 dark:bg-night-400 text-white font-bold text-sm rounded-full py-4 active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <Check className="w-4 h-4" />
              {paidMutation.isPending ? 'Confirming…' : `Mark as paid — ${formatNaira(w.net_payable_kobo)}`}
            </button>
            {!showReject ? (
              <button
                onClick={() => setShowReject(true)}
                className="w-full border-2 border-red-200 dark:border-red-900 text-red-400 dark:text-red-300 font-bold text-sm rounded-full py-3.5 active:scale-95 transition-all"
              >
                Reject withdrawal
              </button>
            ) : (
              <button
                onClick={() => rejectMutation.mutate()}
                disabled={!rejectReason.trim() || rejectMutation.isPending}
                className="w-full bg-red-500 dark:bg-red-400 text-white font-bold text-sm rounded-full py-3.5 active:scale-95 transition-all disabled:opacity-50"
              >
                {rejectMutation.isPending ? 'Rejecting…' : 'Confirm rejection'}
              </button>
            )}
          </div>
        )}

        {(w.status === 'paid' || w.status === 'rejected') && (
          <div className={cn('rounded-2xl p-4 text-center', w.status === 'paid' ? 'bg-green-50 dark:bg-night-600' : 'bg-red-50 dark:bg-red-900')}>
            {w.status === 'paid'
              ? <><CheckCircle className="w-6 h-6 text-green-600 dark:text-night-200 mx-auto mb-1" /><p className="text-green-700 dark:text-night-100 font-semibold text-sm">This withdrawal has been paid</p></>
              : <><XCircle className="w-6 h-6 text-red-400 dark:text-red-300 mx-auto mb-1" /><p className="text-red-500 dark:text-red-300 font-semibold text-sm">Rejected: {w.rejection_reason}</p></>
            }
          </div>
        )}
      </motion.div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────
export default function WithdrawalsPage() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  useWithdrawalRealtime()
  const [tab, setTab]       = useState<Tab>('pending')
  const [selected, setSelected] = useState<Withdrawal | null>(null)

  const { data: withdrawals = [], isLoading } = useQuery({
    queryKey: ['director-withdrawals'],
    queryFn: async () => {
      const { data } = await api.get<Withdrawal[]>('/withdrawals?page_size=100')
      return data
    },
    refetchInterval: 30_000,
  })

  const byTab: Record<Tab, Withdrawal[]> = {
    pending:  withdrawals.filter(w => w.status === 'pending').sort((a, b) => new Date(a.requested_at).getTime() - new Date(b.requested_at).getTime()),
    claimed:  withdrawals.filter(w => w.status === 'claimed'),
    paid:     withdrawals.filter(w => w.status === 'paid'),
    rejected: withdrawals.filter(w => w.status === 'rejected'),
  }

  const tabs: { key: Tab; label: string; color: string }[] = [
    { key: 'pending',  label: `Pending (${byTab.pending.length})`,   color: 'text-amber-600 dark:text-amber-300' },
    { key: 'claimed',  label: `Processing (${byTab.claimed.length})`, color: 'text-blue-600' },
    { key: 'paid',     label: `Paid (${byTab.paid.length})`,          color: 'text-green-600 dark:text-night-200' },
    { key: 'rejected', label: `Rejected (${byTab.rejected.length})`,  color: 'text-red-500 dark:text-red-300' },
  ]

  return (
    <div className="min-h-dvh flex flex-col bg-green-50 dark:bg-night-800">
      <header className="flex items-center justify-between px-4 py-3 bg-green-50 dark:bg-night-800">
        <BrandBlobLogo height={36} />
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold bg-green-900 dark:bg-night-100 text-amber-400 dark:text-night-100 px-2.5 py-1 rounded-full">Director</span>
          <button onClick={() => navigate('/director/profile')} className="rounded-full shadow-card">
          <Avatar name={user?.full_name ?? 'D'} avatarUrl={user?.avatar_url} size={40} />
        </button>
        </div>
      </header>

      <div className="px-4 mt-2 mb-4">
        <h1 className="text-green-900 dark:text-white text-2xl font-extrabold">Withdrawals</h1>
        <p className="text-green-500 dark:text-night-200 text-sm mt-0.5">{byTab.pending.length} pending · {byTab.claimed.length} processing</p>
      </div>

      {/* Tabs — horizontal scroll, with a fade edge so it's obvious there's more to scroll to */}
      <div className="relative mb-4">
        <div className="px-4 overflow-x-auto scrollbar-hide">
          <div className="flex gap-2 w-max pr-2">
            {tabs.map(t => (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={cn('px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap transition-all',
                  tab === t.key ? 'bg-green-900 dark:bg-night-100 text-white dark:text-night-900 shadow-card' : 'bg-white dark:bg-night-700 border border-green-200 dark:border-night-500 text-green-600 dark:text-night-200'
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <div className="pointer-events-none absolute top-0 right-0 h-full w-8 bg-gradient-to-l from-green-50 to-transparent" />
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-40">
        {isLoading ? (
          <div className="space-y-3">
            {[1,2,3].map(i => <div key={i} className="h-20 bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 animate-pulse" />)}
          </div>
        ) : byTab[tab].length === 0 ? (
          <div className="bg-white dark:bg-night-700 rounded-3xl border border-green-100 dark:border-night-500 shadow-card text-center py-14 px-6">
            <CheckCircle className="w-12 h-12 text-green-200 dark:text-night-400 mx-auto mb-4" />
            <p className="text-green-800 dark:text-night-100 font-bold text-lg">No {tab} withdrawals</p>
            <p className="text-green-400 dark:text-night-300 text-sm mt-1">
              {tab === 'pending' ? 'All withdrawals have been processed' : `No ${tab} withdrawals yet`}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {byTab[tab].map((w, i) => {
              const isUrgent = w.status === 'pending' &&
                (Date.now() - new Date(w.requested_at).getTime()) > 1000 * 60 * 60 * 20
              return (
                <motion.button
                  key={w.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                  onClick={() => setSelected(w)}
                  className={cn(
                    'w-full bg-white dark:bg-night-700 rounded-2xl border shadow-card p-4 text-left active:scale-99 transition-all',
                    isUrgent ? 'border-red-200 dark:border-red-900' : 'border-green-100 dark:border-night-500'
                  )}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <p className="text-green-900 dark:text-white font-bold text-sm">{w.customer_name ?? 'Customer'}</p>
                      {isUrgent && <span className="text-xs font-bold text-red-500 dark:text-red-300 bg-red-50 dark:bg-red-900 px-1.5 py-0.5 rounded-full">Urgent</span>}
                    </div>
                    <StatusBadge status={w.status} />
                  </div>
                  <div className="flex items-end justify-between">
                    <div>
                      <p className="text-green-500 dark:text-night-200 text-xs">{w.bank_name} · {maskAccount(w.account_number)}</p>
                      <p className="text-green-400 dark:text-night-300 text-xs mt-0.5">{timeAgo(w.requested_at)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-green-900 dark:text-white font-extrabold">{formatNaira(w.net_payable_kobo)}</p>
                      <p className="text-green-400 dark:text-night-300 text-xs">charge: {formatNaira(w.charge_kobo)}</p>
                    </div>
                  </div>
                </motion.button>
              )
            })}
          </div>
        )}
      </div>

      <AnimatePresence>
        {selected && <ProcessSheet w={selected} onClose={() => setSelected(null)} />}
      </AnimatePresence>
    </div>
  )
}