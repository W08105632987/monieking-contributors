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
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, getErrorMessage } from '@/lib/api'
import { DisputeModal } from '@/components/disputes/DisputeModal'
import { useAuthStore } from '@/store/auth.store'
import { formatNaira, formatDateTime, timeAgo, copyToClipboard } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { txLabel } from '@/lib/txLabel'
import toast from '@/lib/notify'
import { kycPath } from '@/lib/kyc'
import type { WalletTransaction } from '@/types'
import { FallbackError } from '@/components/ui/FallbackError'
import { BrandBlobLogo } from '@/components/brand/BrandBlobLogo'

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
          {txLabel(tx)}
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
  const navigate = useNavigate()
  const isCredit = tx.type === 'credit'
  const [showDispute, setShowDispute] = useState(false)
  // The receipt knows whether the underlying request failed, and why.
  const { data: receipt } = useQuery({
    queryKey: ['tx-receipt', tx.id],
    queryFn: async () => (await api.get<{ failed?: boolean; failure_reason?: string | null }>(`/wallets/transactions/${tx.id}/receipt`)).data,
    staleTime: 60_000,
  })
  const failed = !!receipt?.failed

  const rows = [
    { label: 'Status',         value: failed ? 'Failed' : 'Successful' },
    ...(failed && receipt?.failure_reason ? [{ label: 'Reason', value: receipt.failure_reason }] : []),
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
            {txLabel(tx)}
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
          onClick={() => navigate(`/transactions/${tx.id}/receipt`)}
          className="w-full mt-4 text-green-700 dark:text-night-100 font-bold text-sm py-3 rounded-xl bg-green-50 dark:bg-night-600 active:scale-95 transition-all"
        >
          View full receipt
        </button>
        <button
          onClick={() => setShowDispute(true)}
          className="w-full mt-2 text-red-400 dark:text-red-300 font-bold text-sm py-3 rounded-xl border-2 border-red-100 dark:border-red-900/40 active:scale-95 transition-all"
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
  const { data: feeInfo } = useQuery({ queryKey: ['funding-fee-info'], queryFn: async () => (await api.get<{ charging: boolean; mode?: 'none' | 'ranges' | 'monnify'; tiers: { from: number; to: number | null; fee: number }[] }>('/wallets/funding-fee')).data, staleTime: 60_000 })
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
                <p className="text-green-400 dark:text-night-300 text-xs mt-1">Account name: {wallet.virtual_account_name ?? 'MonieKing'}</p>
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

            {feeInfo?.mode === 'monnify' && (
              <div className="mt-4 rounded-2xl border border-green-100 bg-green-50/60 p-4 text-xs text-green-900 dark:border-night-500 dark:bg-night-600 dark:text-white">
                <p className="mb-1 font-bold">Bank charge</p>
                <p>The bank's transfer charge is taken from what you send. After each funding you will see the amount sent, the charge, and exactly what was added to your wallet.</p>
              </div>
            )}
            {feeInfo?.mode !== 'monnify' && feeInfo?.charging && feeInfo.tiers.length > 0 && (
              <div className="mt-4 rounded-2xl border border-green-100 bg-green-50/60 p-4 dark:border-night-500 dark:bg-night-600">
                <p className="mb-2 text-xs font-bold text-green-800 dark:text-night-100">Funding fee (taken from what you send)</p>
                {feeInfo.tiers.map((t, i) => (
                  <motion.div key={i} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05, duration: 0.2 }} className="flex justify-between py-1 text-xs text-green-900 dark:text-white">
                    <span>{t.to === null ? `₦${t.from.toLocaleString()} and above` : `₦${t.from.toLocaleString()} – ₦${t.to.toLocaleString()}`}</span>
                    <b>₦{t.fee.toLocaleString()}</b>
                  </motion.div>
                ))}
              </div>
            )}

            <div className="mt-4 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-2xl p-4">
              <p className="text-amber-700 dark:text-amber-300 text-xs font-semibold mb-1">⚡ How it works</p>
              <p className="text-amber-600 dark:text-amber-300/80 text-xs leading-relaxed">
                Transfer any amount from your bank app to this account number. Your MonieKing wallet balance will update automatically within 60 seconds. 
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
  const qc = useQueryClient()
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const verified = !!(user?.nin_linked || user?.bvn_linked)
  const [nin, setNin] = useState('')
  const [needNin, setNeedNin] = useState(false)   // true only when we don't have their NIN on file
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const create = async () => {
    if (busy || (needNin && nin.length !== 11)) return
    setBusy(true); setErr('')
    try {
      await api.post('/wallets/me/virtual-account', needNin ? { nin } : {})
      await qc.invalidateQueries({ queryKey: ['wallet'] })
    } catch (e) {
      const st = (e as { response?: { status?: number } })?.response?.status
      if (!needNin && st === 422) setNeedNin(true)   // not on file: ask once
      else setErr(getErrorMessage(e))
    } finally { setBusy(false) }
  }
  if (!verified) {
    return (
      <div className="text-center py-8">
        <CreditCard className="w-12 h-12 text-green-200 dark:text-night-400 mx-auto mb-3" />
        <p className="text-green-700 dark:text-night-100 font-semibold">Verify your NIN to get your account number</p>
        <p className="text-green-400 dark:text-night-300 text-sm mt-1 mb-5 px-4">
          Nigerian banks only issue a personal account number to a verified identity. It takes about a minute, and your account number appears as soon as you finish.
        </p>
        <button onClick={() => { onClose(); navigate(kycPath(user?.role)) }}
          className="bg-green-900 dark:bg-night-100 text-white dark:text-night-900 font-bold text-sm rounded-full px-6 py-3 active:scale-95 transition-all">
          Verify my NIN
        </button>
      </div>
    )
  }
  return (
    <div className="text-center py-6">
      <CreditCard className="w-12 h-12 text-green-200 dark:text-night-400 mx-auto mb-3" />
      <p className="text-green-700 dark:text-night-100 font-semibold">{needNin ? 'Confirm your NIN' : 'Get your account number'}</p>
      <p className="text-green-400 dark:text-night-300 text-sm mt-1 mb-4 px-4">
        {needNin ? 'You verified earlier but we need your NIN once more to create the account. We store it encrypted.' : "You're verified. Tap below and your account number is created in a few seconds."}
      </p>
      {needNin && (
        <input value={nin} onChange={(e) => { setNin(e.target.value.replace(/\D/g, '').slice(0, 11)); setErr('') }} inputMode="numeric" placeholder="11-digit NIN"
          className="w-full max-w-xs mx-auto mb-3 rounded-2xl border-2 border-green-200 dark:border-night-500 bg-white dark:bg-night-800 px-4 py-3 text-center text-lg font-bold tracking-widest text-green-950 dark:text-white focus:outline-none focus:border-green-600" />
      )}
      {err && <p role="alert" className="text-red-600 text-xs font-semibold mb-3 px-4">{err}</p>}
      <button onClick={create} disabled={busy || (needNin && nin.length !== 11)}
        className="bg-green-900 dark:bg-night-100 text-white dark:text-night-900 font-bold text-sm rounded-full px-6 py-3 active:scale-95 transition-all disabled:opacity-40">
        {busy ? 'Creating…' : 'Get my account number'}
      </button>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────
export default function WalletPage() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const { wallet, transactions, isLoading, refetch } = useWallet()
  const [showFundSheet, setShowFundSheet] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [selectedTx, setSelectedTx] = useState<WalletTransaction | null>(null)
  const [statRange, setStatRange] = useState<'week' | 'month' | 'all' | 'custom'>('all')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')

  const { data: summary, isLoading: summaryLoading, isError: summaryError, refetch: refetchSummary } = useQuery({
    queryKey: ['wallet-summary', statRange, statRange === 'custom' ? customStart : null, statRange === 'custom' ? customEnd : null],
    queryFn: async () => {
      const { data } = await api.get<{ total_in_kobo: number; total_out_kobo: number; range_label: string }>(
        '/wallets/me/summary', {
          params: {
            range: statRange,
            ...(statRange === 'custom' && customStart ? { start_date: customStart } : {}),
            ...(statRange === 'custom' && customEnd ? { end_date: customEnd } : {}),
          },
        }
      )
      return data
    },
    // A custom range with no start date yet isn't a real query — wait
    // for the customer to actually pick one, rather than firing a
    // request for "custom, no dates" that the backend would just treat
    // as all-time anyway.
    enabled: statRange !== 'custom' || !!customStart,
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
        <BrandBlobLogo height={36} />
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

      <div className="flex-1 overflow-y-auto pb-safe-nav">

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
                  onClick={() => navigate('/customer/withdrawals/new')}
                  className="flex-1 min-w-0 flex items-center justify-center gap-2 border-2 border-green-500 dark:border-night-300 text-green-300 dark:text-night-300 font-bold text-sm rounded-full py-3 active:scale-95 transition-all"
                >
                  <ArrowUpRight className="w-4 h-4" /> Withdraw
                </button>
              </div>
            </div>
          </motion.div>
        </div>

        {/* Money in / out stats */}
        <div className="px-4 flex items-center gap-2 mb-3">
          {(['week', 'month', 'all', 'custom'] as const).map(r => (
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
              {r === 'week' ? '7 days' : r === 'month' ? '30 days' : r === 'all' ? 'All time' : 'Custom'}
            </button>
          ))}
        </div>
        {statRange === 'custom' && (
          <div className="px-4 flex items-center gap-2 mb-3">
            <input
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              max={customEnd || undefined}
              className="flex-1 bg-white dark:bg-night-700 border border-green-100 dark:border-night-500 rounded-xl px-3 py-2 text-xs font-semibold text-green-900 dark:text-white"
            />
            <span className="text-green-400 dark:text-night-300 text-xs">to</span>
            <input
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              min={customStart || undefined}
              className="flex-1 bg-white dark:bg-night-700 border border-green-100 dark:border-night-500 rounded-xl px-3 py-2 text-xs font-semibold text-green-900 dark:text-white"
            />
          </div>
        )}
        {summaryError ? (
          <div className="px-4 mb-5">
            <FallbackError
              title="Couldn't load your totals"
              onRetry={() => refetchSummary()}
            />
          </div>
        ) : (
        <div className="px-4 grid grid-cols-2 gap-3 mb-5">
          <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 bg-green-100 dark:bg-night-600 rounded-xl flex items-center justify-center">
                <TrendingUp className="w-4 h-4 text-green-600 dark:text-night-200" />
              </div>
              <p className="text-green-500 dark:text-night-200 text-xs font-semibold uppercase tracking-wide">Money in</p>
            </div>
            {summaryLoading ? (
              <>
                <div className="h-6 w-24 bg-green-100 dark:bg-night-600 rounded animate-pulse mb-1" />
                <div className="h-3 w-16 bg-green-100 dark:bg-night-600 rounded animate-pulse" />
              </>
            ) : (
              <>
                <p className="text-green-900 dark:text-white text-xl font-extrabold">{formatNaira(summary?.total_in_kobo ?? 0)}</p>
                <p className="text-green-400 dark:text-night-300 text-xs mt-0.5">{summary?.range_label ?? 'All time'}</p>
              </>
            )}
          </div>
          <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 bg-red-50 dark:bg-red-900/20 rounded-xl flex items-center justify-center">
                <TrendingDown className="w-4 h-4 text-red-400 dark:text-red-300" />
              </div>
              <p className="text-green-500 dark:text-night-200 text-xs font-semibold uppercase tracking-wide">Money out</p>
            </div>
            {summaryLoading ? (
              <>
                <div className="h-6 w-24 bg-green-100 dark:bg-night-600 rounded animate-pulse mb-1" />
                <div className="h-3 w-16 bg-green-100 dark:bg-night-600 rounded animate-pulse" />
              </>
            ) : (
              <>
                <p className="text-green-900 dark:text-white text-xl font-extrabold">{formatNaira(summary?.total_out_kobo ?? 0)}</p>
                <p className="text-green-400 dark:text-night-300 text-xs mt-0.5">{summary?.range_label ?? 'All time'}</p>
              </>
            )}
          </div>
        </div>
        )}

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

      <AnimatePresence>
        {showFundSheet && <FundWalletSheet onClose={() => setShowFundSheet(false)} />}
        {selectedTx && <TxDetailSheet tx={selectedTx} onClose={() => setSelectedTx(null)} />}
      </AnimatePresence>
    </div>
  )
}