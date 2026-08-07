import { useState } from 'react'
import { Avatar } from '@/components/ui/Avatar'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowDownLeft, ArrowUpRight, Copy, CheckCheck,
  TrendingUp, TrendingDown, Wallet, RefreshCw,
  X, ChevronRight, Clock, CreditCard,
} from 'lucide-react'
import { useWallet } from '@/hooks/useWallet'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { DisputeModal } from '@/components/disputes/DisputeModal'
import { useAuthStore } from '@/store/auth.store'
import { BottomNav } from '@/components/layout/BottomNav'
import { formatNaira, formatDateTime, timeAgo, copyToClipboard } from '@/lib/utils'
import { cn } from '@/lib/utils'
import toast from 'react-hot-toast'
import type { WalletTransaction } from '@/types'
import { FEATURE_FLAGS } from '@/config/featureFlags'

const TX_CATEGORY_LABEL: Record<string, string> = {
  wallet_funding:       'Wallet funded',
  contribution:         'Contribution',
  withdrawal:           'Withdrawal',
  charge:               'Withdrawal charge',
  officer_contribution: 'Cash contribution',
  reversal:             'Reversal',
}

// ── Transaction item ──────────────────────────────────────────────
function TxItem({ tx, onClick }: { tx: WalletTransaction; onClick: () => void }) {
  const isCredit = tx.type === 'credit'

  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 py-3.5 border-b border-green-50 dark:border-night-600 last:border-0 text-left active:bg-green-50/60 dark:active:bg-white/5 transition-colors -mx-1 px-1 rounded-xl"
    >
      <div className={cn(
        'w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0',
        isCredit ? 'bg-green-100 dark:bg-night-600' : 'bg-red-50 dark:bg-red-900/20',
      )}>
        {isCredit
          ? <ArrowDownLeft className="w-5 h-5 text-green-600 dark:text-night-200" />
          : <ArrowUpRight  className="w-5 h-5 text-red-400 dark:text-red-300" />
        }
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-green-900 dark:text-white text-sm font-semibold truncate">
          {TX_CATEGORY_LABEL[tx.category] ?? tx.category}
        </p>
        <p className="text-green-400 dark:text-night-300 text-xs mt-0.5 truncate flex items-center gap-1">
          <Clock className="w-3 h-3 flex-shrink-0" /> {timeAgo(tx.created_at)}
        </p>
      </div>
      <div className="text-right flex-shrink-0 flex items-center gap-2">
        <div>
          <p className={cn('text-sm font-bold', isCredit ? 'text-green-600 dark:text-night-200' : 'text-red-400 dark:text-red-300')}>
            {isCredit ? '+' : '-'}{formatNaira(tx.amount_kobo)}
          </p>
          <p className="text-green-300 dark:text-night-300 text-xs mt-0.5">{formatDateTime(tx.created_at).split(',')[0]}</p>
        </div>
        <ChevronRight className="w-4 h-4 text-green-200 dark:text-night-400" />
      </div>
    </button>
  )
}

// ── Transaction detail sheet ────────────────────────────────────────
function TxDetailSheet({ tx, onClose }: { tx: WalletTransaction; onClose: () => void }) {
  const isCredit = tx.type === 'credit'
  const [showDispute, setShowDispute] = useState(false)

  const rows = [
    { label: 'Status',         value: 'Successful' },
    { label: 'Reference',      value: tx.reference, mono: true },
    { label: 'Date & time',    value: formatDateTime(tx.created_at) },
    { label: 'Balance after',  value: formatNaira(tx.balance_after_kobo) },
    ...(tx.description ? [{ label: 'Description', value: tx.description }] : []),
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-green-950/60 backdrop-blur-sm" />
      <motion.div
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 22, stiffness: 260, mass: 0.9 }}
        className="relative bg-white dark:bg-night-700 rounded-t-3xl w-full max-w-lg p-6 pb-10 max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-green-200 dark:bg-night-500 rounded-full mx-auto mb-5" />
        <button onClick={onClose} className="absolute top-5 right-5 w-8 h-8 rounded-full bg-green-50 dark:bg-night-600 flex items-center justify-center">
          <X className="w-4 h-4 text-green-700 dark:text-night-100" />
        </button>

        <div className="flex flex-col items-center text-center mb-6 pt-2">
          <div className={cn(
            'w-14 h-14 rounded-2xl flex items-center justify-center mb-3',
            isCredit ? 'bg-green-100 dark:bg-night-600' : 'bg-red-50 dark:bg-red-900/20',
          )}>
            {isCredit
              ? <ArrowDownLeft className="w-6 h-6 text-green-600 dark:text-night-200" />
              : <ArrowUpRight  className="w-6 h-6 text-red-400 dark:text-red-300" />
            }
          </div>
          <p className={cn('text-3xl font-extrabold tracking-tight', isCredit ? 'text-green-700 dark:text-night-100' : 'text-red-500')}>
            {isCredit ? '+' : '-'}{formatNaira(tx.amount_kobo)}
          </p>
          <p className="text-green-500 dark:text-night-200 text-sm font-semibold mt-1">
            {TX_CATEGORY_LABEL[tx.category] ?? tx.category}
          </p>
        </div>

        <div className="bg-green-50 dark:bg-night-600 rounded-2xl p-4 space-y-3">
          {rows.map(row => (
            <div key={row.label} className="flex items-start justify-between gap-3">
              <span className="text-green-500 dark:text-night-200 text-xs font-semibold uppercase tracking-wide pt-0.5 shrink-0">{row.label}</span>
              <span className={cn('text-green-900 dark:text-white text-sm font-semibold text-right min-w-0 break-words', row.mono && 'font-mono text-xs break-all')}>
                {row.value}
              </span>
            </div>
          ))}
        </div>

        <button
          onClick={() => setShowDispute(true)}
          className="w-full mt-4 text-red-400 dark:text-red-300 font-bold text-sm py-3 rounded-xl border-2 border-red-100 dark:border-red-900/40 active:scale-95 transition-all"
        >
          Dispute this transaction
        </button>
      </motion.div>

      {showDispute && (
        <DisputeModal entityType="wallet_transaction" entityId={tx.id} onClose={() => setShowDispute(false)} />
      )}
    </div>
  )
}

// ── Fund wallet bottom sheet ──────────────────────────────────────
function FundWalletSheet({ onClose }: { onClose: () => void }) {
  const { wallet } = useWallet()
  const [copied, setCopied] = useState(false)

  const copyAccount = async () => {
    if (wallet?.virtual_account_number) {
      const ok = await copyToClipboard(wallet.virtual_account_number)
      if (ok) {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      } else {
        toast.error('Could not copy — try selecting the number manually')
      }
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-green-950/60 backdrop-blur-sm" />
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        className="relative bg-white dark:bg-night-700 rounded-t-3xl w-full max-w-lg p-6 pb-10"
        onClick={e => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-green-200 dark:bg-night-500 rounded-full mx-auto mb-6" />
        <h2 className="text-green-900 dark:text-white font-extrabold text-xl mb-1">Fund your wallet</h2>
        <p className="text-green-500 dark:text-night-200 text-sm mb-6">
          Transfer money to your dedicated virtual account below. Your wallet will be credited automatically within 60 seconds.
        </p>

        {wallet?.virtual_account_number ? (
          <>
            {/* Virtual account card */}
            <div
              className="rounded-2xl p-5 mb-4 relative overflow-hidden bg-hero-gradient dark:bg-night-gradient"
            >
              <div className="absolute rounded-full opacity-20 dark:opacity-15 bg-green-600 dark:bg-night-400" style={{ width: 120, height: 120, top: -30, right: -20 }} />
              <div className="absolute rounded-full opacity-15 dark:opacity-10 bg-green-400 dark:bg-night-300" style={{ width: 70, height: 70, top: 10, right: 20 }} />

              <div className="relative z-10">
                <p className="text-green-400 dark:text-night-300 text-xs font-semibold uppercase tracking-widest mb-3">Your virtual account</p>
                <p className="text-white text-3xl font-extrabold tracking-widest mb-1">
                  {wallet.virtual_account_number}
                </p>
                <p className="text-green-300 dark:text-night-300 text-sm font-medium">{wallet.virtual_account_bank}</p>
                <p className="text-green-400 dark:text-night-300 text-xs mt-1">Account name: MonieKing / {wallet.virtual_account_number}</p>
              </div>
            </div>

            <button
              onClick={copyAccount}
              className={cn(
                'w-full flex items-center justify-center gap-2 font-bold text-sm rounded-full py-4 transition-all active:scale-95',
                copied
                  ? 'bg-green-100 dark:bg-night-600 text-green-700 dark:text-night-100'
                  : 'bg-green-900 dark:bg-night-100 text-white dark:text-night-900'
              )}
            >
              {copied
                ? <><CheckCheck className="w-4 h-4" /> Account number copied!</>
                : <><Copy className="w-4 h-4" /> Copy account number</>
              }
            </button>

            <div className="mt-4 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-2xl p-4">
              <p className="text-amber-700 dark:text-amber-300 text-xs font-semibold mb-1">⚡ How it works</p>
              <p className="text-amber-600 dark:text-amber-300/80 text-xs leading-relaxed">
                Transfer any amount from your bank app to this account number. Your MonieKing wallet balance will update automatically within 60 seconds. No fees charged.
              </p>
            </div>
          </>
        ) : (
          <KycRequiredPrompt onClose={onClose} />
        )}
      </motion.div>
    </div>
  )
}

// ── Shown wherever a virtual account would normally appear, but KYC
// hasn't been completed yet — since accounts are no longer auto-created,
// this isn't a "please wait" state, it needs an action. ────────────────
function KycRequiredPrompt({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  return (
    <div className="text-center py-8">
      <CreditCard className="w-12 h-12 text-green-200 dark:text-night-400 mx-auto mb-3" />
      <p className="text-green-700 dark:text-night-100 font-semibold">Setting up your account</p>
      <p className="text-green-400 dark:text-night-300 text-sm mt-1 mb-5 px-4">
        Your account number is still being set up. This is usually quick — completing identity verification now will also finish setting it up.
      </p>
      <button
        onClick={() => { onClose(); navigate('/customer/profile') }}
        className="bg-green-900 dark:bg-night-100 text-white dark:text-night-900 font-bold text-sm rounded-full px-6 py-3 active:scale-95 transition-all"
      >
        Complete identity verification
      </button>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────
export default function WalletPage() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const { wallet, transactions, isLoading, refetch } = useWallet()
  const [showFundSheet, setShowFundSheet] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [selectedTx, setSelectedTx] = useState<WalletTransaction | null>(null)
  const [statRange, setStatRange] = useState<'week' | 'month' | 'all'>('all')

  const { data: summary } = useQuery({
    queryKey: ['wallet-summary', statRange],
    queryFn: async () => {
      const { data } = await api.get<{ total_in_kobo: number; total_out_kobo: number; range_label: string }>(
        '/wallets/me/summary', { params: { range: statRange } }
      )
      return data
    },
  })

  const handleRefresh = async () => {
    setRefreshing(true)
    await refetch()
    setTimeout(() => setRefreshing(false), 800)
  }

  // (totals now come from the /wallets/me/summary query above, not
  // summed client-side from a possibly-truncated transaction page)

  return (
    <div className="min-h-dvh flex flex-col bg-green-50 dark:bg-night-800">

      {/* Top bar */}
      <header className="flex items-center justify-between px-4 py-3 bg-green-50 dark:bg-night-800">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 bg-green-900 dark:bg-white/10 rounded-xl flex items-center justify-center shadow-card">
            <span className="text-amber-400 font-extrabold text-base">₦</span>
          </div>
          <div className="flex items-baseline gap-0.5">
            <span className="text-green-900 dark:text-white font-extrabold text-xl tracking-tight leading-none">Monie</span>
            <span className="text-amber-500 font-extrabold text-xl tracking-tight leading-none">King</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            className="w-9 h-9 bg-green-100 dark:bg-night-600 rounded-xl flex items-center justify-center"
          >
            <RefreshCw className={cn('w-4 h-4 text-green-600 dark:text-night-200', refreshing && 'animate-spin')} />
          </button>
          <button onClick={() => navigate('/customer/profile')} className="rounded-full shadow-card">
          <Avatar name={user?.full_name ?? 'U'} avatarUrl={user?.avatar_url} size={40} />
        </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto pb-40">

        {/* Wallet balance hero */}
        <div className="px-4 mb-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3 }}
            className="relative rounded-3xl overflow-hidden bg-hero-gradient dark:bg-night-gradient"
          >
            <div className="absolute rounded-full opacity-25 dark:opacity-20 bg-green-600 dark:bg-night-400" style={{ width: 160, height: 160, top: -40, right: -30 }} />
            <div className="absolute rounded-full opacity-15 dark:opacity-10 bg-green-400 dark:bg-night-300" style={{ width: 100, height: 100, top: 10, right: 20 }} />

            <div className="relative z-10 p-5">
              <p className="text-green-300 dark:text-night-300 text-xs font-semibold uppercase tracking-widest mb-1">Available balance</p>
              {isLoading ? (
                <div className="h-10 w-40 bg-green-700 dark:bg-night-500 rounded-xl animate-pulse mb-1" />
              ) : (
                <p className="text-white text-4xl font-extrabold tracking-tight mb-1">
                  {formatNaira(wallet?.balance_kobo ?? 0)}
                </p>
              )}
              <p className="text-green-400 dark:text-night-300 text-xs mb-5">
                {wallet?.virtual_account_number
                  ? <>VA: {wallet.virtual_account_number} · {wallet.virtual_account_bank}</>
                  : 'Verify your identity to activate your account number'}
              </p>

              <div className="flex gap-3">
                <button
                  onClick={() => setShowFundSheet(true)}
                  className="flex-1 min-w-0 flex items-center justify-center gap-2 bg-amber-400 dark:bg-night-100 text-green-900 dark:text-night-900 font-bold text-sm rounded-full py-3 active:scale-95 transition-all"
                >
                  <ArrowDownLeft className="w-4 h-4" /> Fund wallet
                </button>
                <button
                  onClick={() => FEATURE_FLAGS.WITHDRAWALS_ENABLED && navigate('/customer/withdrawals/new')}
                  disabled={!FEATURE_FLAGS.WITHDRAWALS_ENABLED}
                  className="relative flex-1 min-w-0 flex items-center justify-center gap-2 border-2 border-green-500 dark:border-night-300 text-green-300 dark:text-night-300 font-bold text-sm rounded-full py-3 active:scale-95 transition-all disabled:opacity-50 disabled:active:scale-100"
                >
                  <ArrowUpRight className="w-4 h-4" /> Withdraw
                  {!FEATURE_FLAGS.WITHDRAWALS_ENABLED && (
                    <span className="absolute -top-2 -right-2 text-[9px] font-bold text-amber-900 bg-amber-300 px-1.5 py-0.5 rounded-full">SOON</span>
                  )}
                </button>
              </div>
            </div>
          </motion.div>
        </div>

        {/* Money in / out stats */}
        <div className="px-4 flex items-center gap-2 mb-3">
          {(['week', 'month', 'all'] as const).map(r => (
            <button
              key={r}
              onClick={() => setStatRange(r)}
              className={cn(
                'px-3 py-1.5 rounded-full text-xs font-bold transition-colors',
                statRange === r
                  ? 'bg-green-900 dark:bg-night-100 text-white dark:text-night-900'
                  : 'bg-white dark:bg-night-700 text-green-600 dark:text-night-200 border border-green-100 dark:border-night-500'
              )}
            >
              {r === 'week' ? '7 days' : r === 'month' ? '30 days' : 'All time'}
            </button>
          ))}
        </div>
        <div className="px-4 grid grid-cols-2 gap-3 mb-5">
          <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 bg-green-100 dark:bg-night-600 rounded-xl flex items-center justify-center">
                <TrendingUp className="w-4 h-4 text-green-600 dark:text-night-200" />
              </div>
              <p className="text-green-500 dark:text-night-200 text-xs font-semibold uppercase tracking-wide">Money in</p>
            </div>
            <p className="text-green-900 dark:text-white text-xl font-extrabold">{formatNaira(summary?.total_in_kobo ?? 0)}</p>
            <p className="text-green-400 dark:text-night-300 text-xs mt-0.5">{summary?.range_label ?? 'All time'}</p>
          </div>
          <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 bg-red-50 dark:bg-red-900/20 rounded-xl flex items-center justify-center">
                <TrendingDown className="w-4 h-4 text-red-400 dark:text-red-300" />
              </div>
              <p className="text-green-500 dark:text-night-200 text-xs font-semibold uppercase tracking-wide">Money out</p>
            </div>
            <p className="text-green-900 dark:text-white text-xl font-extrabold">{formatNaira(summary?.total_out_kobo ?? 0)}</p>
            <p className="text-green-400 dark:text-night-300 text-xs mt-0.5">{summary?.range_label ?? 'All time'}</p>
          </div>
        </div>

        {/* Transaction history — last 5 only, full list lives on its own page */}
        <div className="px-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-green-900 dark:text-white font-bold text-base">Recent transactions</h2>
            {transactions.length > 0 && (
              <button
                onClick={() => navigate('/customer/wallet/transactions')}
                className="text-green-600 dark:text-night-200 text-xs font-bold flex items-center gap-0.5"
              >
                View all <ChevronRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card px-4">
            {isLoading ? (
              <div className="space-y-3 py-4">
                {[1, 2, 3].map(i => (
                  <div key={i} className="flex gap-3">
                    <div className="w-10 h-10 bg-green-100 dark:bg-night-600 rounded-2xl animate-pulse" />
                    <div className="flex-1 space-y-2">
                      <div className="h-3 bg-green-100 dark:bg-night-600 rounded animate-pulse w-2/3" />
                      <div className="h-2 bg-green-50 dark:bg-night-600 rounded animate-pulse w-1/3" />
                    </div>
                  </div>
                ))}
              </div>
            ) : transactions.length === 0 ? (
              <div className="text-center py-12">
                <Wallet className="w-10 h-10 text-green-200 dark:text-night-400 mx-auto mb-3" />
                <p className="text-green-700 dark:text-night-100 font-semibold text-sm">No transactions yet</p>
                <p className="text-green-400 dark:text-night-300 text-xs mt-1">
                  Fund your wallet to get started
                </p>
                <button
                  onClick={() => setShowFundSheet(true)}
                  className="mt-4 bg-green-900 dark:bg-night-100 text-white dark:text-night-900 text-xs font-bold rounded-full px-6 py-2.5 active:scale-95 transition-all"
                >
                  Fund wallet
                </button>
              </div>
            ) : (
              transactions.slice(0, 5).map(tx => (
                <TxItem key={tx.id} tx={tx} onClick={() => setSelectedTx(tx)} />
              ))
            )}
          </div>
        </div>
      </div>

      <BottomNav />

      <AnimatePresence>
        {showFundSheet && <FundWalletSheet onClose={() => setShowFundSheet(false)} />}
        {selectedTx && <TxDetailSheet tx={selectedTx} onClose={() => setSelectedTx(null)} />}
      </AnimatePresence>
    </div>
  )
}