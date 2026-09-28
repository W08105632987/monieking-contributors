import { useState } from 'react'
import { Avatar } from '@/components/ui/Avatar'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowDownLeft, ArrowUpRight, Copy, CheckCheck,
  TrendingUp, TrendingDown, Wallet, RefreshCw,
  Eye, EyeOff, Lock, AlertCircle, X, Clock, ChevronRight, CreditCard,
} from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { useWallet } from '@/hooks/useWallet'
import { api, getErrorMessage } from '@/lib/api'
import { useAuthStore } from '@/store/auth.store'
import { formatNaira, timeAgo, formatDateTime, copyToClipboard } from '@/lib/utils'
import { cn } from '@/lib/utils'
import type { WalletTransaction } from '@/types'
import { FEATURE_FLAGS } from '@/config/featureFlags'
import { BrandBlobLogo } from '@/components/brand/BrandBlobLogo'

const TX_CATEGORY_LABEL: Record<string, string> = {
  wallet_funding:       'Wallet funded',
  contribution:         'Contribution posted',
  officer_contribution: 'Cash contribution posted',
  withdrawal:           'Withdrawal',
  charge:               'Withdrawal charge',
  reversal:             'Reversal',
}

const OFFICER_WALLET_WITHDRAWAL_CHARGE_KOBO = 5_000 // ₦50, flat

function OfficerWalletWithdrawSheet({ onClose }: { onClose: () => void }) {
  const { user } = useAuthStore()
  const { wallet, refetch } = useWallet()
  const qc = useQueryClient()
  const [amountNaira, setAmountNaira] = useState('')
  const [password, setPassword]       = useState('')
  const [showPwd, setShowPwd]         = useState(false)
  const [loading, setLoading]         = useState(false)

  const amountKobo  = Math.round(parseFloat(amountNaira || '0') * 100)
  const netPayable  = amountKobo - OFFICER_WALLET_WITHDRAWAL_CHARGE_KOBO
  const canSubmit   = amountKobo > 0
    && amountKobo <= (wallet?.balance_kobo ?? 0)
    && netPayable > 0
    && password.length >= 6

  const handleSubmit = async () => {
    if (!canSubmit) return
    setLoading(true)
    try {
      await api.post('/wallets/me/withdraw', {
        amount_kobo:         amountKobo,
        auth_method:         'password',
        withdrawal_password: password,
      })
      toast.success('Withdrawal successful ✓')
      await refetch()
      qc.invalidateQueries({ queryKey: ['wallet-transactions'] })
      onClose()
    } catch (err) {
      toast.error(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-green-950/60 backdrop-blur-sm" />
      <motion.div
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        className="relative bg-white dark:bg-night-700 rounded-t-3xl w-full max-w-lg p-6 pb-10 max-h-[88vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-green-200 dark:bg-night-500 rounded-full mx-auto mb-5" />
        <div className="flex items-center gap-3 mb-1">
          <Wallet className="w-6 h-6 text-green-700 dark:text-night-100" />
          <h2 className="text-green-900 dark:text-white font-extrabold text-lg leading-tight">Withdraw to my account</h2>
        </div>
        <p className="text-green-500 dark:text-night-200 text-xs mb-5">Sent instantly — no approval wait.</p>

        <p className="text-green-700 dark:text-night-100 text-xs font-bold uppercase tracking-wide mb-2">Amount (₦)</p>
        <div className="relative mb-2">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-green-500 dark:text-night-200 font-bold text-lg">₦</span>
          <input
            type="text"
            inputMode="decimal"
            name="officer-wallet-withdraw-amount-2"
            autoComplete="off"
            value={amountNaira}
            onChange={e => setAmountNaira(e.target.value.replace(/[^0-9.]/g, ''))}
            placeholder={`Max: ${(wallet?.balance_kobo ?? 0) / 100}`}
            className="w-full border-2 border-green-200 dark:border-night-500 rounded-xl pl-9 pr-4 py-4 text-xl text-green-900 dark:text-white font-bold focus:outline-none focus:border-green-500 bg-white dark:bg-night-700"
          />
        </div>
        {amountKobo > (wallet?.balance_kobo ?? 0) && (
          <div className="flex items-center gap-1.5 mb-3">
            <AlertCircle className="w-3.5 h-3.5 text-red-400 dark:text-red-300 flex-shrink-0" />
            <p className="text-red-400 dark:text-red-300 text-xs font-semibold">Exceeds wallet balance</p>
          </div>
        )}

        {amountKobo > 0 && (
          <div className="bg-white dark:bg-night-700 border border-green-100 dark:border-night-500 rounded-2xl p-4 mb-5 shadow-card">
            <div className="flex justify-between text-sm mb-2">
              <span className="text-green-600 dark:text-night-200">Requested amount</span>
              <span className="text-green-900 dark:text-white font-semibold">{formatNaira(amountKobo)}</span>
            </div>
            <div className="flex justify-between text-sm mb-2">
              <span className="text-green-600 dark:text-night-200">Processing charge</span>
              <span className="text-red-400 dark:text-red-300 font-semibold">- {formatNaira(OFFICER_WALLET_WITHDRAWAL_CHARGE_KOBO)}</span>
            </div>
            <div className="h-px bg-green-100 dark:bg-night-600 mb-2" />
            <div className="flex justify-between">
              <span className="text-green-900 dark:text-white font-bold">You receive</span>
              <span className={cn('font-extrabold text-lg', netPayable > 0 ? 'text-green-700 dark:text-night-100' : 'text-red-400')}>
                {formatNaira(Math.max(0, netPayable))}
              </span>
            </div>
          </div>
        )}

        <div className="bg-green-50 border border-green-200 dark:border-night-500 rounded-2xl p-4 mb-5">
          <p className="text-green-500 dark:text-night-200 text-xs font-bold uppercase tracking-wide mb-2">Payout to</p>
          <p className="text-green-900 dark:text-white font-bold text-sm">{user?.account_name}</p>
          <p className="text-green-700 dark:text-night-100 text-sm font-semibold tracking-widest mt-0.5">{user?.account_number}</p>
          <p className="text-green-500 dark:text-night-200 text-xs mt-0.5">{user?.bank_name}</p>
        </div>

        <p className="text-green-700 dark:text-night-100 text-xs font-bold uppercase tracking-wide mb-2">
          <Lock className="w-3 h-3 inline mr-1" />Withdrawal password
        </p>
        <div className="relative mb-6">
          <input
            type="text"
            name="officer-wallet-page-withdrawal-pin"
            autoComplete="off"
            style={{ WebkitTextSecurity: showPwd ? 'none' : 'disc' } as React.CSSProperties}
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Enter your withdrawal password"
            className="w-full border-2 border-green-200 dark:border-night-500 rounded-xl px-4 py-3.5 pr-10 text-sm text-green-900 dark:text-white focus:outline-none focus:border-green-500 bg-white dark:bg-night-700"
          />
          <button type="button" onClick={() => setShowPwd(v => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-green-400 dark:text-night-300">
            {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>

        <button
          onClick={handleSubmit}
          disabled={!canSubmit || loading}
          className="w-full bg-green-900 text-white font-bold text-base rounded-full py-4 active:scale-95 transition-all disabled:opacity-40 shadow-card"
        >
          {loading ? 'Sending…' : 'Withdraw instantly'}
        </button>
      </motion.div>
    </div>
  )
}

// ── Transaction item ──────────────────────────────────────────────
function TxItem({ tx, onClick }: { tx: WalletTransaction; onClick: () => void }) {
  const isCredit = tx.type === 'credit'
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 py-3.5 border-b border-green-50 dark:border-night-600 last:border-0 text-left active:bg-green-50/60 dark:active:bg-white/5 transition-colors -mx-1 px-1 rounded-xl"
    >
      <div className={cn('w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0',
        isCredit ? 'bg-green-100 dark:bg-night-600' : 'bg-red-50',
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
          <p className={cn('text-sm font-bold', isCredit ? 'text-green-600 dark:text-night-200' : 'text-red-400')}>
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
  const rows = [
    { label: 'Status',        value: 'Successful' },
    { label: 'Reference',     value: tx.reference, mono: true },
    { label: 'Date & time',   value: formatDateTime(tx.created_at) },
    { label: 'Balance after', value: formatNaira(tx.balance_after_kobo) },
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
            isCredit ? 'bg-green-100 dark:bg-night-600' : 'bg-red-50',
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
      </motion.div>
    </div>
  )
}

// ── Fund wallet sheet ─────────────────────────────────────────────
function FundWalletSheet({ onClose }: { onClose: () => void }) {
  const { wallet } = useWallet()
  const navigate = useNavigate()
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
        <h2 className="text-green-900 dark:text-white font-extrabold text-xl mb-1">Fund officer wallet</h2>
        <p className="text-green-500 dark:text-night-200 text-sm mb-2">
          Transfer money to your virtual account below.
        </p>
        <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-2xl p-3 mb-5">
          <p className="text-amber-700 dark:text-amber-300 text-xs font-semibold">💡 Officer wallet purpose</p>
          <p className="text-amber-600 dark:text-amber-300 text-xs mt-0.5 leading-relaxed">
            Your wallet balance is used to post cash contributions on behalf of your customers. Make sure it always has enough funds before visiting customers.
          </p>
        </div>

        {wallet?.virtual_account_number ? (
          <>
            <div
              className="rounded-2xl p-5 mb-4 relative overflow-hidden"
              style={{ background: 'linear-gradient(135deg, #052E16 0%, #064E3B 100%)' }}
            >
              <div className="absolute rounded-full opacity-20" style={{ width: 120, height: 120, background: '#059669', top: -30, right: -20 }} />
              <div className="absolute rounded-full opacity-15" style={{ width: 70, height: 70, background: '#34D399', top: 10, right: 20 }} />
              <div className="relative z-10">
                <p className="text-green-400 dark:text-night-300 text-xs font-semibold uppercase tracking-widest mb-3">Officer virtual account</p>
                <p className="text-white text-3xl font-extrabold tracking-widest mb-1">{wallet.virtual_account_number}</p>
                <p className="text-green-300 dark:text-night-300 text-sm font-medium">{wallet.virtual_account_bank}</p>
              </div>
            </div>
            <button
              onClick={copyAccount}
              className={cn(
                'w-full flex items-center justify-center gap-2 font-bold text-sm rounded-full py-4 transition-all active:scale-95',
                copied ? 'bg-green-100 dark:bg-night-600 text-green-700 dark:text-night-100' : 'bg-green-900 text-white',
              )}
            >
              {copied
                ? <><CheckCheck className="w-4 h-4" /> Copied!</>
                : <><Copy className="w-4 h-4" /> Copy account number</>
              }
            </button>
          </>
        ) : (
          <div className="text-center py-8">
            <CreditCard className="w-12 h-12 text-green-200 dark:text-night-400 mx-auto mb-3" />
            <p className="text-green-700 dark:text-night-100 font-semibold">Setting up your account</p>
            <p className="text-green-400 dark:text-night-300 text-sm mt-1 mb-5 px-4">
              Your account number is still being set up. This is usually quick — completing identity verification now will also finish setting it up.
            </p>
            <button
              onClick={() => { onClose(); navigate('/officer/profile') }}
              className="bg-green-900 text-white font-bold text-sm rounded-full px-6 py-3 active:scale-95 transition-all"
            >
              Complete identity verification
            </button>
          </div>
        )}
      </motion.div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────
export default function OfficerWalletPage() {
  const navigate  = useNavigate()
  const { user }  = useAuthStore()
  const { wallet, transactions, isLoading, refetch } = useWallet()
  const [showFundSheet, setShowFundSheet] = useState(false)
  const [showWalletWithdraw, setShowWalletWithdraw] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [selectedTx, setSelectedTx] = useState<WalletTransaction | null>(null)

  const handleRefresh = async () => {
    setRefreshing(true)
    await refetch()
    setTimeout(() => setRefreshing(false), 800)
  }

  const totalIn  = transactions.filter(t => t.type === 'credit').reduce((s, t) => s + t.amount_kobo, 0)
  const totalOut = transactions.filter(t => t.type === 'debit' ).reduce((s, t) => s + t.amount_kobo, 0)

  return (
    <div className="min-h-dvh flex flex-col bg-green-50 dark:bg-night-800">

      {/* Top bar */}
      <header className="flex items-center justify-between px-4 py-3 bg-green-50 dark:bg-night-800">
        <BrandBlobLogo height={36} />
        <div className="flex items-center gap-2">
          <button onClick={handleRefresh} className="w-9 h-9 bg-green-100 dark:bg-night-600 rounded-xl flex items-center justify-center shrink-0">
            <RefreshCw className={cn('w-4 h-4 text-green-600 dark:text-night-200', refreshing && 'animate-spin')} />
          </button>
          <span className="hidden min-[360px]:inline-block text-xs font-bold bg-green-900 text-amber-400 px-2.5 py-1 rounded-full whitespace-nowrap">Officer</span>
          <button onClick={() => navigate('/officer/profile')} className="rounded-full shadow-card">
          <Avatar name={user?.full_name ?? 'O'} avatarUrl={user?.avatar_url} size={40} />
        </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto pb-safe-nav">

        {/* Wallet balance hero */}
        <div className="px-4 mb-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3 }}
            className="relative rounded-3xl overflow-hidden"
            style={{ background: 'linear-gradient(135deg, #052E16 0%, #064E3B 60%, #065F46 100%)' }}
          >
            <div className="absolute rounded-full opacity-25" style={{ width: 160, height: 160, background: '#059669', top: -40, right: -30 }} />
            <div className="absolute rounded-full opacity-15" style={{ width: 100, height: 100, background: '#34D399', top: 10, right: 20 }} />
            <div className="relative z-10 p-5">
              <div className="flex items-center gap-2 mb-1">
                <Wallet className="w-4 h-4 text-green-400 dark:text-night-300" />
                <p className="text-green-300 dark:text-night-300 text-xs font-semibold uppercase tracking-widest">Officer wallet</p>
              </div>
              {isLoading ? (
                <div className="h-10 w-40 bg-green-700 rounded-xl animate-pulse mb-1" />
              ) : (
                <p className="text-white text-4xl font-extrabold tracking-tight mb-1">
                  {formatNaira(wallet?.balance_kobo ?? 0)}
                </p>
              )}
              <p className="text-green-400 dark:text-night-300 text-xs mb-5">
                VA: {wallet?.virtual_account_number ?? '—'} · {wallet?.virtual_account_bank ?? 'Pending setup'}
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowFundSheet(true)}
                  className="flex-1 min-w-0 flex items-center justify-center gap-2 bg-amber-400 text-green-900 dark:text-white font-bold text-sm rounded-full py-3 active:scale-95 transition-all"
                >
                  <ArrowDownLeft className="w-4 h-4" /> Fund wallet
                </button>
                <button
                  onClick={() => FEATURE_FLAGS.INSTANT_WITHDRAWAL_ENABLED && setShowWalletWithdraw(true)}
                  disabled={!FEATURE_FLAGS.INSTANT_WITHDRAWAL_ENABLED}
                  className="relative flex-1 min-w-0 flex items-center justify-center gap-2 border-2 border-green-500 text-green-300 dark:text-night-300 font-bold text-sm rounded-full py-3 active:scale-95 transition-all disabled:opacity-50 disabled:active:scale-100"
                >
                  <ArrowUpRight className="w-4 h-4" /> Withdraw
                  {!FEATURE_FLAGS.INSTANT_WITHDRAWAL_ENABLED && (
                    <span className="absolute -top-2 -right-2 text-[9px] font-bold text-amber-900 bg-amber-300 px-1.5 py-0.5 rounded-full">SOON</span>
                  )}
                </button>
              </div>
            </div>
          </motion.div>
        </div>

        {/* Stats */}
        <div className="px-4 grid grid-cols-2 gap-3 mb-5">
          <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 bg-green-100 dark:bg-night-600 rounded-xl flex items-center justify-center">
                <TrendingUp className="w-4 h-4 text-green-600 dark:text-night-200" />
              </div>
              <p className="text-green-500 dark:text-night-200 text-xs font-semibold uppercase tracking-wide">Total funded</p>
            </div>
            <p className="text-green-900 dark:text-white text-xl font-extrabold">{formatNaira(totalIn)}</p>
            <p className="text-green-400 dark:text-night-300 text-xs mt-0.5">Money added</p>
          </div>
          <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 bg-red-50 dark:bg-red-900/20 rounded-xl flex items-center justify-center">
                <TrendingDown className="w-4 h-4 text-red-400 dark:text-red-300" />
              </div>
              <p className="text-green-500 dark:text-night-200 text-xs font-semibold uppercase tracking-wide">Contributions</p>
            </div>
            <p className="text-green-900 dark:text-white text-xl font-extrabold">{formatNaira(totalOut)}</p>
            <p className="text-green-400 dark:text-night-300 text-xs mt-0.5">Posted for customers</p>
          </div>
        </div>

        {/* Transaction history — last 5 only, full list lives on its own page */}
        <div className="px-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-green-900 dark:text-white font-bold text-base">Recent transactions</h2>
            {transactions.length > 0 && (
              <button
                onClick={() => navigate('/officer/wallet/transactions')}
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
                <p className="text-green-400 dark:text-night-300 text-xs mt-1">Fund your wallet to start posting contributions</p>
                <button
                  onClick={() => setShowFundSheet(true)}
                  className="mt-4 bg-green-900 text-white text-xs font-bold rounded-full px-6 py-2.5 active:scale-95 transition-all"
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

      <AnimatePresence>
        {showFundSheet && <FundWalletSheet onClose={() => setShowFundSheet(false)} />}
        {showWalletWithdraw && <OfficerWalletWithdrawSheet onClose={() => setShowWalletWithdraw(false)} />}
        {selectedTx && <TxDetailSheet tx={selectedTx} onClose={() => setSelectedTx(null)} />}
      </AnimatePresence>
    </div>
  )
}