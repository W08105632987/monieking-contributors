import { useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowLeft, Check, AlertCircle, Eye, EyeOff, Lock, Wallet as WalletIcon, ChevronRight, Fingerprint } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { api, getErrorMessage } from '@/lib/api'
import { useAuthStore } from '@/store/auth.store'
import { useWallet } from '@/hooks/useWallet'
import { formatNaira, idempotencyKey } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { isBiometricAvailable, getStepUpAssertion } from '@/lib/webauthn'
import type { ContributionCard } from '@/types'
import { FEATURE_FLAGS } from '@/config/featureFlags'

const WALLET_WITHDRAWAL_CHARGE_KOBO = 5_000 // ₦50, flat

function WalletWithdrawSheet({ onClose }: { onClose: () => void }) {
  const { user } = useAuthStore()
  const { wallet, refetch } = useWallet()
  const qc = useQueryClient()
  const [amountNaira, setAmountNaira] = useState('')
  const [password, setPassword]       = useState('')
  const [showPwd, setShowPwd]         = useState(false)
  const [loading, setLoading]         = useState(false)
  const [bioAvailable, setBioAvailable] = useState(false)
  const [bioLoading, setBioLoading]     = useState(false)
  const autoPromptedRef = useRef(false)

  useEffect(() => { if (FEATURE_FLAGS.BIOMETRICS_ENABLED) isBiometricAvailable().then(setBioAvailable) }, [])

  const amountKobo  = Math.round(parseFloat(amountNaira || '0') * 100)
  const netPayable  = amountKobo - WALLET_WITHDRAWAL_CHARGE_KOBO
  const canSubmitAmount = amountKobo > 0
    && amountKobo <= (wallet?.balance_kobo ?? 0)
    && netPayable > 0
  const canSubmit = canSubmitAmount && password.length >= 6

  const submit = async (authPayload: Record<string, any>) => {
    try {
      await api.post('/wallets/me/withdraw', {
        amount_kobo: amountKobo,
        ...authPayload,
      })
      toast.success('Withdrawal successful ✓')
      await refetch()
      qc.invalidateQueries({ queryKey: ['wallet-transactions'] })
      onClose()
    } catch (err) {
      toast.error(getErrorMessage(err))
    }
  }

  const handleSubmit = async () => {
    if (!canSubmit) return
    setLoading(true)
    try {
      await submit({ auth_method: 'password', withdrawal_password: password })
    } finally {
      setLoading(false)
    }
  }

  const submitWithBiometric = async (silent = false) => {
    if (!canSubmitAmount) return
    setBioLoading(true)
    try {
      const assertion = await getStepUpAssertion()
      await submit({ auth_method: 'biometric', webauthn_assertion: assertion })
    } catch (err) {
      // Silent = auto-triggered on password-field focus. A dismissed or
      // failed prompt there just means "let them type the password
      // instead" — no error toast. Only the explicit tap gets one.
      if (!silent) toast.error(getErrorMessage(err))
    } finally {
      setBioLoading(false)
    }
  }

  const handlePasswordFocus = () => {
    if (autoPromptedRef.current) return
    if (!bioAvailable || !canSubmitAmount) return
    autoPromptedRef.current = true
    submitWithBiometric(true)
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
          <WalletIcon className="w-6 h-6 text-green-700 dark:text-night-100" />
          <h2 className="text-green-900 dark:text-white font-extrabold text-lg leading-tight">Withdraw to my account</h2>
        </div>
        <p className="text-green-500 dark:text-night-200 text-xs mb-5">Sent instantly — no approval wait, unlike card withdrawals.</p>

        <p className="text-green-700 dark:text-night-100 text-xs font-bold uppercase tracking-wide mb-2">Amount (₦)</p>
        <div className="relative mb-2">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-green-500 dark:text-night-200 font-bold text-lg">₦</span>
          <input
            type="text"
            inputMode="decimal"
            name="wallet-withdraw-amount"
            autoComplete="off"
            value={amountNaira}
            onChange={e => setAmountNaira(e.target.value.replace(/[^0-9.]/g, ''))}
            placeholder={`Max: ${(wallet?.balance_kobo ?? 0) / 100}`}
            className="w-full border-2 border-green-200 dark:border-night-500 rounded-xl pl-9 pr-4 py-4 text-xl text-green-900 dark:text-white font-bold focus:outline-none focus:border-green-500 dark:focus:border-night-200 bg-white dark:bg-night-700"
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
              <span className="text-red-400 dark:text-red-300 font-semibold">- {formatNaira(WALLET_WITHDRAWAL_CHARGE_KOBO)}</span>
            </div>
            <div className="h-px bg-green-100 dark:bg-night-600 mb-2" />
            <div className="flex justify-between">
              <span className="text-green-900 dark:text-white font-bold">You receive</span>
              <span className={cn('font-extrabold text-lg', netPayable > 0 ? 'text-green-700 dark:text-night-100' : 'text-red-400 dark:text-red-300')}>
                {formatNaira(Math.max(0, netPayable))}
              </span>
            </div>
          </div>
        )}

        <div className="bg-green-50 dark:bg-night-600 border border-green-200 dark:border-night-500 rounded-2xl p-4 mb-5">
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
                name="customer-card-withdrawal-pin"
                autoComplete="off"
                style={{ WebkitTextSecurity: showPwd ? 'none' : 'disc' } as React.CSSProperties}
                value={password}
                onChange={e => setPassword(e.target.value)}
                onFocus={handlePasswordFocus}
                placeholder="Enter your withdrawal password"
                className="w-full border-2 border-green-200 dark:border-night-500 rounded-xl px-4 py-3.5 pr-16 text-sm text-green-900 dark:text-white focus:outline-none focus:border-green-500 dark:focus:border-night-200 bg-white dark:bg-night-700"
              />
          {bioAvailable && (
            <button
              type="button"
              onClick={() => submitWithBiometric(false)}
              disabled={bioLoading || !canSubmitAmount}
              aria-label="Confirm with fingerprint"
              className="absolute right-9 top-1/2 -translate-y-1/2 text-green-600 dark:text-night-200 disabled:opacity-40"
            >
              <Fingerprint className={`w-4 h-4 ${bioLoading ? 'animate-pulse' : ''}`} />
            </button>
          )}
          <button type="button" onClick={() => setShowPwd(v => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-green-400 dark:text-night-300">
            {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>

        <button
          onClick={handleSubmit}
          disabled={!canSubmit || loading || bioLoading}
          className="w-full bg-green-900 dark:bg-night-100 text-white dark:text-night-900 font-bold text-base rounded-full py-4 active:scale-95 transition-all disabled:opacity-40 shadow-card"
        >
          {loading ? 'Sending…' : bioLoading ? 'Confirm with fingerprint…' : 'Withdraw instantly'}
        </button>
      </motion.div>
    </div>
  )
}

interface WithdrawalPreview {
  days_to_withdraw: number
  months_touched:   number
  charge_kobo:      number
  net_payable_kobo: number
  is_risky:         boolean
}

export default function WithdrawalPage() {
  const navigate       = useNavigate()
  const [params]       = useSearchParams()
  const idemKeyRef = useRef(idempotencyKey())
  const { user }       = useAuthStore()
  const qc             = useQueryClient()
  const preselectedCard = params.get('card')

  const [selectedCardId, setSelectedCardId] = useState<string>(preselectedCard ?? '')
  const [amountNaira, setAmountNaira]       = useState('')
  const [debouncedAmountKobo, setDebouncedAmountKobo] = useState(0)
  const [password, setPassword]             = useState('')
  const [showPwd, setShowPwd]               = useState(false)
  const [loading, setLoading]               = useState(false)
  const [bioAvailable, setBioAvailable]     = useState(false)
  const [bioLoading, setBioLoading]         = useState(false)
  const [showRiskConfirm, setShowRiskConfirm] = useState(false)
  const [showWalletWithdraw, setShowWalletWithdraw] = useState(false)
  const autoPromptedRef = useRef(false)
  // Holds which auth method to use once "Proceed anyway" is confirmed on
  // the risk modal — biometric assertions are single-use, so we can't
  // just re-run the same submit function; we remember which path got us
  // there.
  const pendingAuthRef = useRef<Record<string, any> | null>(null)

  useEffect(() => { if (FEATURE_FLAGS.BIOMETRICS_ENABLED) isBiometricAvailable().then(setBioAvailable) }, [])

  const { data: cards = [], isLoading: cardsLoading } = useQuery({
    queryKey: ['cards-for-withdrawal'],
    queryFn: async () => {
      const { data } = await api.get<ContributionCard[]>('/cards?include_completed=true')
      return data.filter(c => c.card_type === 'regular' && c.total_contributed_kobo > 0)
    },
  })

  const selectedCard = cards.find(c => c.id === selectedCardId) ?? null
  const amountKobo   = Math.round(parseFloat(amountNaira || '0') * 100)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedAmountKobo(amountKobo), 400)
    return () => clearTimeout(t)
  }, [amountKobo])

  const isValidMultiple = !!selectedCard && debouncedAmountKobo > 0 && debouncedAmountKobo % selectedCard.rate_kobo === 0

  const { data: preview, isFetching: previewLoading } = useQuery({
    queryKey: ['withdrawal-preview', selectedCard?.id, debouncedAmountKobo],
    queryFn: async () => {
      const { data } = await api.get<WithdrawalPreview>(
        `/cards/${selectedCard!.id}/withdrawal-preview?amount_kobo=${debouncedAmountKobo}`
      )
      return data
    },
    enabled: isValidMultiple,
  })

  const charge      = preview?.charge_kobo ?? 0
  const netPayable  = preview?.net_payable_kobo ?? 0
  const canWithdrawAmount = selectedCard && isValidMultiple && !!preview && preview.net_payable_kobo > 0
  const canWithdraw = canWithdrawAmount && password.length >= 6

  const submitWithdrawal = async (authPayload: Record<string, any>) => {
    if (!selectedCard) return
    setLoading(true)
    try {
      await api.post('/withdrawals', {
        card_id:     selectedCard.id,
        amount_kobo: amountKobo,
        ...authPayload,
      }, {
        headers: { 'Idempotency-Key': idemKeyRef.current },
      })
      toast.success('Withdrawal request submitted! Processing within 24 hours.')
      qc.invalidateQueries({ queryKey: ['cards'] })
      navigate('/customer/cards')
    } catch (err) {
      toast.error(getErrorMessage(err))
    } finally {
      setLoading(false)
      setShowRiskConfirm(false)
    }
  }

  const handleSubmit = () => {
    if (!canWithdraw) return
    const authPayload = { auth_method: 'password', withdrawal_password: password }
    if (preview?.is_risky) {
      pendingAuthRef.current = authPayload
      setShowRiskConfirm(true)
      return
    }
    submitWithdrawal(authPayload)
  }

  const submitWithBiometric = async (silent = false) => {
    if (!canWithdrawAmount) return
    setBioLoading(true)
    try {
      const assertion = await getStepUpAssertion()
      const authPayload = { auth_method: 'biometric', webauthn_assertion: assertion }
      if (preview?.is_risky) {
        pendingAuthRef.current = authPayload
        setShowRiskConfirm(true)
      } else {
        await submitWithdrawal(authPayload)
      }
    } catch (err) {
      // Silent = auto-triggered on password-field focus — a dismissed or
      // failed prompt there just means "type the password instead", no
      // error toast. Only the explicit fingerprint tap shows one.
      if (!silent) toast.error(getErrorMessage(err))
    } finally {
      setBioLoading(false)
    }
  }

  const handlePasswordFocus = () => {
    if (autoPromptedRef.current) return
    if (!bioAvailable || !canWithdrawAmount) return
    autoPromptedRef.current = true
    submitWithBiometric(true)
  }

  return (
    <div className="min-h-dvh flex flex-col bg-green-50 dark:bg-night-800">
      <header className="flex items-center gap-3 px-4 py-3 bg-green-50 dark:bg-night-800">
        <button onClick={() => navigate(-1)}
          className="w-9 h-9 bg-white dark:bg-night-700 border border-green-200 dark:border-night-500 rounded-xl flex items-center justify-center active:scale-95 transition-all">
          <ArrowLeft className="w-5 h-5 text-green-700 dark:text-night-100" />
        </button>
        <h1 className="text-green-900 dark:text-white font-extrabold text-lg">Request withdrawal</h1>
      </header>

      <div className="flex-1 px-4 pb-10 overflow-y-auto">
        {/* Info banner */}
        <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-2xl p-3 mb-5 mt-2">
          <p className="text-amber-700 dark:text-amber-300 text-xs font-semibold">⏱ Processing time</p>
          <p className="text-amber-600 dark:text-amber-300/80 text-xs mt-0.5">Withdrawals are processed by directors within 24 hours. A one-day charge applies per request.</p>
        </div>

        {/* Select card */}
        <p className="text-green-700 dark:text-night-100 text-xs font-bold uppercase tracking-wide mb-2">Select card</p>
        {cardsLoading ? (
          <div className="h-14 bg-green-100 dark:bg-night-600 rounded-2xl animate-pulse mb-5" />
        ) : cards.length === 0 ? (
          <div className="bg-white dark:bg-night-700 border border-green-100 dark:border-night-500 rounded-2xl p-4 mb-5 text-center">
            <p className="text-green-600 dark:text-night-200 text-sm font-semibold">No eligible cards</p>
            <p className="text-green-400 dark:text-night-300 text-xs mt-0.5">Only regular cards with contributions can be withdrawn</p>
          </div>
        ) : (
          <div className="space-y-2 mb-5">
            {cards.map(card => (
              <button key={card.id} onClick={() => setSelectedCardId(card.id)}
                className={cn('w-full flex items-center justify-between p-4 rounded-2xl border-2 text-left transition-all',
                  selectedCardId === card.id ? 'border-green-900 dark:border-night-200 bg-green-50 dark:bg-night-600' : 'border-green-100 dark:border-night-500 bg-white dark:bg-night-700'
                )}
              >
                <div>
                  <p className="text-green-900 dark:text-white font-semibold text-sm">📋 Regular · {formatNaira(card.rate_kobo)}/day</p>
                  <p className="text-green-400 dark:text-night-300 text-xs mt-0.5">Available: {formatNaira(card.total_contributed_kobo)}</p>
                </div>
                {selectedCardId === card.id && <Check className="w-4 h-4 text-green-700 dark:text-night-100" />}
              </button>
            ))}
          </div>
        )}

        {/* Withdraw directly from wallet — instant, no approval wait */}
        <button
          onClick={() => FEATURE_FLAGS.INSTANT_WITHDRAWAL_ENABLED && setShowWalletWithdraw(true)}
          disabled={!FEATURE_FLAGS.INSTANT_WITHDRAWAL_ENABLED}
          className="relative w-full flex items-center justify-between p-4 rounded-2xl border-2 border-dashed border-green-300 dark:border-night-500 bg-white dark:bg-night-700 mb-5 text-left active:scale-[0.99] transition-all disabled:opacity-50 disabled:active:scale-100"
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-green-100 dark:bg-night-600 flex items-center justify-center flex-shrink-0">
              <WalletIcon className="w-4 h-4 text-green-700 dark:text-night-100" />
            </div>
            <div>
              <p className="text-green-900 dark:text-white font-semibold text-sm">Withdraw to my account</p>
              <p className="text-green-400 dark:text-night-300 text-xs mt-0.5">
                {FEATURE_FLAGS.INSTANT_WITHDRAWAL_ENABLED ? 'Instant — straight from your wallet balance' : 'Coming soon — instant wallet withdrawal'}
              </p>
            </div>
          </div>
          {FEATURE_FLAGS.INSTANT_WITHDRAWAL_ENABLED ? (
            <ChevronRight className="w-4 h-4 text-green-300 dark:text-night-300" />
          ) : (
            <span className="text-[9px] font-bold text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-500/20 px-2 py-1 rounded-full flex-shrink-0">SOON</span>
          )}
        </button>

        {/* Amount */}
        {selectedCard && (
          <>
            <p className="text-green-700 dark:text-night-100 text-xs font-bold uppercase tracking-wide mb-2">Amount to withdraw (₦)</p>
            <div className="relative mb-3">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-green-500 dark:text-night-200 font-bold text-lg">₦</span>
              <input
                type="text"
                inputMode="decimal"
                name="card-withdraw-amount"
                autoComplete="off"
                value={amountNaira}
                onChange={e => setAmountNaira(e.target.value.replace(/[^0-9.]/g, ''))}
                placeholder={`Max: ${selectedCard.total_contributed_kobo / 100}`}
                className="w-full border-2 border-green-200 dark:border-night-500 rounded-xl pl-9 pr-4 py-4 text-xl text-green-900 dark:text-white font-bold focus:outline-none focus:border-green-500 dark:focus:border-night-200 bg-white dark:bg-night-700"
              />
            </div>

            {/* Breakdown */}
            {amountKobo > 0 && (
              <motion.div
                layout
                initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                transition={{ layout: { duration: 0.25, ease: 'easeOut' } }}
                className="bg-white dark:bg-night-700 border border-green-100 dark:border-night-500 rounded-2xl p-4 mb-5 shadow-card"
              >
                {!isValidMultiple ? (
                  <p className="text-red-400 dark:text-red-300 text-xs font-semibold">
                    Amount must be a multiple of {formatNaira(selectedCard.rate_kobo)}
                  </p>
                ) : previewLoading ? (
                  <p className="text-green-400 dark:text-night-300 text-xs">Calculating charge…</p>
                ) : preview ? (
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-green-600 dark:text-night-200">Requested amount</span>
                      <span className="text-green-900 dark:text-white font-semibold">{formatNaira(amountKobo)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-green-600 dark:text-night-200">
                        Processing charge ({preview.months_touched} month{preview.months_touched > 1 ? 's' : ''})
                      </span>
                      <span className="text-red-400 dark:text-red-300 font-semibold">- {formatNaira(charge)}</span>
                    </div>
                    <div className="h-px bg-green-100 dark:bg-night-600" />
                    <div className="flex justify-between">
                      <span className="text-green-900 dark:text-white font-bold">You receive</span>
                      <span className={cn('font-extrabold text-lg', netPayable > 0 ? 'text-green-700 dark:text-night-100' : 'text-red-400 dark:text-red-300')}>
                        {formatNaira(Math.max(0, netPayable))}
                      </span>
                    </div>
                    {preview.is_risky && (
                      <div className="flex items-center gap-1.5 mt-1">
                        <AlertCircle className="w-3.5 h-3.5 text-amber-500 dark:text-amber-300 flex-shrink-0" />
                        <p className="text-amber-600 dark:text-amber-300 text-xs font-semibold">This withdrawal may lead to an extra charge later</p>
                      </div>
                    )}
                  </div>
                ) : null}
                {amountKobo > selectedCard.total_contributed_kobo && (
                  <div className="flex items-center gap-1.5 mt-3">
                    <AlertCircle className="w-3.5 h-3.5 text-red-400 dark:text-red-300 flex-shrink-0" />
                    <p className="text-red-400 dark:text-red-300 text-xs font-semibold">Exceeds available balance</p>
                  </div>
                )}
              </motion.div>
            )}

            {/* Bank details preview */}
            <div className="bg-green-50 dark:bg-night-600 border border-green-200 dark:border-night-500 rounded-2xl p-4 mb-5">
              <p className="text-green-500 dark:text-night-200 text-xs font-bold uppercase tracking-wide mb-2">Payout to</p>
              <p className="text-green-900 dark:text-white font-bold text-sm">{user?.account_name}</p>
              <p className="text-green-700 dark:text-night-100 text-sm font-semibold tracking-widest mt-0.5">{user?.account_number}</p>
              <p className="text-green-500 dark:text-night-200 text-xs mt-0.5">{user?.bank_name}</p>
            </div>

            {/* Withdrawal password */}
            <p className="text-green-700 dark:text-night-100 text-xs font-bold uppercase tracking-wide mb-2">
              <Lock className="w-3 h-3 inline mr-1" />Withdrawal password
            </p>
            <div className="relative mb-6">
              <input
                type="text"
                name="customer-wallet-withdrawal-pin"
                autoComplete="off"
                style={{ WebkitTextSecurity: showPwd ? 'none' : 'disc' } as React.CSSProperties}
                value={password}
                onChange={e => setPassword(e.target.value)}
                onFocus={handlePasswordFocus}
                placeholder="Enter your withdrawal password"
                className="w-full border-2 border-green-200 dark:border-night-500 rounded-xl px-4 py-3.5 pr-16 text-sm text-green-900 dark:text-white focus:outline-none focus:border-green-500 dark:focus:border-night-200 bg-white dark:bg-night-700"
              />
              {bioAvailable && (
                <button
                  type="button"
                  onClick={() => submitWithBiometric(false)}
                  disabled={bioLoading || !canWithdrawAmount}
                  aria-label="Confirm with fingerprint"
                  className="absolute right-9 top-1/2 -translate-y-1/2 text-green-600 dark:text-night-200 disabled:opacity-40"
                >
                  <Fingerprint className={`w-4 h-4 ${bioLoading ? 'animate-pulse' : ''}`} />
                </button>
              )}
              <button type="button" onClick={() => setShowPwd(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-green-400 dark:text-night-300">
                {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            <button
              onClick={handleSubmit}
              disabled={!canWithdraw || loading || bioLoading}
              className="w-full bg-green-900 dark:bg-night-100 text-white dark:text-night-900 font-bold text-base rounded-full py-4 active:scale-95 transition-all disabled:opacity-40 shadow-card"
            >
              {loading ? 'Submitting…' : bioLoading ? 'Confirm with fingerprint…' : `Submit withdrawal request`}
            </button>
          </>
        )}
      </div>

      <AnimatePresence>
        {showWalletWithdraw && (
          <WalletWithdrawSheet onClose={() => setShowWalletWithdraw(false)} />
        )}
      </AnimatePresence>

      {showRiskConfirm && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={() => setShowRiskConfirm(false)}>
          <div className="absolute inset-0 bg-green-950/60 backdrop-blur-sm" />
          <motion.div
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="relative bg-white dark:bg-night-700 rounded-t-3xl w-full max-w-lg p-6 pb-10"
            onClick={e => e.stopPropagation()}
          >
            <div className="w-10 h-1 bg-green-200 dark:bg-night-500 rounded-full mx-auto mb-5" />
            <div className="flex items-center gap-3 mb-3">
              <AlertCircle className="w-8 h-8 text-amber-500 dark:text-amber-300 flex-shrink-0" />
              <h2 className="text-green-900 dark:text-white font-extrabold text-lg leading-tight">Heads up before you continue</h2>
            </div>
            <p className="text-green-600 dark:text-night-200 text-sm leading-relaxed mb-5">
              This withdrawal only partially empties a month on your card. If you come back later to withdraw
              the rest of that same month separately, you'll be charged the processing fee again for it.
              To avoid this, withdraw the full amount you need in one request. You can still proceed if you understand this.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowRiskConfirm(false)}
                className="flex-1 border-2 border-green-200 dark:border-night-500 text-green-700 dark:text-night-100 font-bold text-sm rounded-full py-3.5 active:scale-95 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={() => pendingAuthRef.current && submitWithdrawal(pendingAuthRef.current)}
                disabled={loading}
                className="flex-1 bg-green-900 dark:bg-night-100 text-white dark:text-night-900 font-bold text-sm rounded-full py-3.5 active:scale-95 transition-all disabled:opacity-40"
              >
                {loading ? 'Submitting…' : 'Proceed anyway'}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  )
}