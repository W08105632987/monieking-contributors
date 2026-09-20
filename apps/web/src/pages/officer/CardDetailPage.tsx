import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  ArrowLeft, Plus, ArrowUpRight, RotateCcw, Calendar, TrendingUp, Clock,
  Check, AlertCircle, Eye, EyeOff, Lock, XCircle, Fingerprint,
} from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { api, getErrorMessage } from '@/lib/api'
import { formatNaira, formatDate, MONTH_NAMES, cn, idempotencyKey } from '@/lib/utils'
import { isBiometricAvailable, getStepUpAssertion } from '@/lib/webauthn'
import { FEATURE_FLAGS } from '@/config/featureFlags'
import { PleaseHold } from '@/components/ui/PleaseHold'
import type { ContributionCard, CardGrid, GridCell, User, ContributionRecord } from '@/types'
import { ContributionHistoryModal } from '@/components/cards/ContributionHistoryModal'

interface WithdrawalPreview {
  days_to_withdraw: number
  months_touched:   number
  charge_kobo:      number
  net_payable_kobo: number
  is_risky:         boolean
}

export default function OfficerCardDetailPage() {
  const navigate = useNavigate()
  const { customerId, cardId } = useParams<{ customerId: string; cardId: string }>()
  const qc = useQueryClient()

  const [flipped, setFlipped]         = useState(false)
  const [activePanel, setActivePanel] = useState<'none' | 'contribute' | 'withdraw'>('none')
  const [amountNaira, setAmountNaira] = useState('')
  const [withdrawNaira, setWithdrawNaira] = useState('')
  const [debouncedWithdrawKobo, setDebouncedWithdrawKobo] = useState(0)
  const [password, setPassword]       = useState('')
  const [showPwd, setShowPwd]         = useState(false)
  const [loading, setLoading]         = useState(false)
  const contributeIdemKeyRef = useRef(idempotencyKey())
  const withdrawIdemKeyRef   = useRef(idempotencyKey())
  const [showRiskConfirm, setShowRiskConfirm] = useState(false)
  const [bioAvailable, setBioAvailable] = useState(false)
  const [bioLoading, setBioLoading]     = useState(false)
  const autoPromptedRef = useRef(false)
  const pendingAuthRef  = useRef<Record<string, any> | null>(null)
  const [showHistory, setShowHistory]         = useState(false)
  const [showCloseModal, setShowCloseModal]   = useState(false)
  const [closePassword, setClosePassword]     = useState('')
  const [showClosePwd, setShowClosePwd]       = useState(false)
  const [converting, setConverting]           = useState(false)
  const [closing, setClosing]                 = useState(false)

  // One request instead of three — GET /cards/{id}, GET /cards/{id}/grid,
  // and GET /contributions/{id} used to each independently re-fetch the
  // card row and re-run the same access check. The combined endpoint
  // does that once and returns all three pieces together.
  const { data: detail, isLoading: cardLoading } = useQuery({
    queryKey: ['card-detail', cardId],
    queryFn: async () => {
      const { data } = await api.get<{
        card: ContributionCard
        grid: CardGrid
        contributions: ContributionRecord[]
      }>(`/cards/${cardId}/detail`)
      return data
    },
    enabled: !!cardId,
  })
  const card = detail?.card
  const grid = detail?.grid
  const contributions = detail?.contributions ?? []

  const { data: customer } = useQuery({
    queryKey: ['customer', customerId],
    queryFn: async () => {
      const { data } = await api.get<User>(`/users/${customerId}`)
      return data
    },
    enabled: !!customerId,
    retry: false,
  })

  const amountKobo = Math.round(parseFloat(amountNaira || '0') * 100)
  const isContributeValid = !!card && amountKobo > 0 && amountKobo % card.rate_kobo === 0

  const withdrawKobo = Math.round(parseFloat(withdrawNaira || '0') * 100)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedWithdrawKobo(withdrawKobo), 400)
    return () => clearTimeout(t)
  }, [withdrawKobo])

  useEffect(() => { if (FEATURE_FLAGS.BIOMETRICS_ENABLED) isBiometricAvailable().then(setBioAvailable) }, [])

  const isValidWithdrawMultiple = !!card && debouncedWithdrawKobo > 0 && debouncedWithdrawKobo % card.rate_kobo === 0

  const { data: withdrawPreview, isFetching: withdrawPreviewLoading } = useQuery({
    queryKey: ['withdrawal-preview', cardId, debouncedWithdrawKobo],
    queryFn: async () => {
      const { data } = await api.get<WithdrawalPreview>(
        `/cards/${cardId}/withdrawal-preview?amount_kobo=${debouncedWithdrawKobo}`
      )
      return data
    },
    enabled: isValidWithdrawMultiple,
  })

  const charge      = withdrawPreview?.charge_kobo ?? 0
  const netPayable  = withdrawPreview?.net_payable_kobo ?? 0
  const canWithdrawAmount = !!card && isValidWithdrawMultiple && !!withdrawPreview && withdrawPreview.net_payable_kobo > 0
  const canWithdraw = canWithdrawAmount && password.length >= 6

  const handleContribute = async () => {
    if (!card || !isContributeValid) return
    setLoading(true)
    try {
      const { data } = await api.post<{ card: ContributionCard; wallet_balance_kobo: number; days_added: number }>(
        '/contributions', { card_id: card.id, amount_kobo: amountKobo },
        { headers: { 'Idempotency-Key': contributeIdemKeyRef.current } },
      )
      toast.success(`${data.days_added} day(s) added to ${customer ? `${customer.full_name}'s` : "the customer's"} card`)

      // Same fix as the customer side (useCards.ts) — patch every cache
      // that holds this card with the authoritative data the response
      // just gave us, instead of only invalidating and waiting for
      // four separate background refetches to eventually catch up.
      // cancelQueries first so a still-in-flight older refetch can't
      // land after this and overwrite it with stale data.
      await qc.cancelQueries({ queryKey: ['card-detail', cardId] })
      await qc.cancelQueries({ queryKey: ['customer-cards', customer?.id] })
      await qc.cancelQueries({ queryKey: ['officer-cards'] })
      await qc.cancelQueries({ queryKey: ['wallet'] })

      qc.setQueryData<{ card: ContributionCard; grid: CardGrid; contributions: ContributionRecord[] } | undefined>(
        ['card-detail', cardId],
        (old) => old ? { ...old, card: data.card } : old
      )
      qc.setQueryData<ContributionCard[] | undefined>(
        ['customer-cards', customer?.id],
        (old) => old?.map(c => c.id === data.card.id ? data.card : c) ?? old
      )
      qc.setQueryData<ContributionCard[] | undefined>(
        ['officer-cards'],
        (old) => old?.map(c => c.id === data.card.id ? data.card : c) ?? old
      )
      qc.setQueryData<{ balance_kobo: number } | undefined>(
        ['wallet'],
        (old: any) => old ? { ...old, balance_kobo: data.wallet_balance_kobo } : old
      )

      // The grid (day-by-day boxes) and the contribution history list
      // aren't in this response, so those still need a real refetch —
      // but the card summary fields (days, total, status) are already
      // correct on screen the instant this response comes back.
      qc.invalidateQueries({ queryKey: ['card-detail', cardId] })

      setAmountNaira('')
      setActivePanel('none')
    } catch (err) {
      toast.error(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  const submitWithdrawal = async (authPayload: Record<string, any>) => {
    if (!card) return
    setLoading(true)
    try {
      await api.post('/withdrawals', {
        card_id:     card.id,
        amount_kobo: withdrawKobo,
        ...authPayload,
      }, {
        headers: { 'Idempotency-Key': withdrawIdemKeyRef.current },
      })
      toast.success('Withdrawal request submitted')
      qc.invalidateQueries({ queryKey: ['card-detail', cardId] })
      qc.invalidateQueries({ queryKey: ['customer-cards', customer?.id] })
      setWithdrawNaira('')
      setPassword('')
      setActivePanel('none')
    } catch (err) {
      toast.error(getErrorMessage(err))
    } finally {
      setLoading(false)
      setShowRiskConfirm(false)
    }
  }

  const handleWithdraw = () => {
    if (!canWithdraw) return
    const authPayload = { auth_method: 'password', withdrawal_password: password }
    if (withdrawPreview?.is_risky) {
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
      if (withdrawPreview?.is_risky) {
        pendingAuthRef.current = authPayload
        setShowRiskConfirm(true)
      } else {
        await submitWithdrawal(authPayload)
      }
    } catch (err) {
      // Silent = auto-triggered on password-field focus; a dismissed or
      // failed prompt there just falls back to typing the password, no
      // error toast. Only the explicit fingerprint tap gets one.
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

  const handleConvert = async () => {
    if (!card) return
    if (!window.confirm('Convert this Food Card to a Regular Card? Food eligibility will be permanently lost. This cannot be undone.')) return
    setConverting(true)
    try {
      await api.post(`/cards/${cardId}/convert`)
      toast.success('Card converted to Regular')
      qc.invalidateQueries({ queryKey: ['card-detail', cardId] })
      qc.invalidateQueries({ queryKey: ['customer-cards', customer?.id] })
      qc.invalidateQueries({ queryKey: ['officer-cards'] })
    } catch (err) {
      toast.error(getErrorMessage(err))
    } finally {
      setConverting(false)
    }
  }

  const handleClose = async () => {
    if (!card || closePassword.length < 6) return
    setClosing(true)
    try {
      await api.post(`/cards/${cardId}/close`, { withdrawal_password: closePassword })
      toast.success('Card closed — funds are now withdrawable')
      qc.invalidateQueries({ queryKey: ['card-detail', cardId] })
      qc.invalidateQueries({ queryKey: ['customer-cards', customer?.id] })
      qc.invalidateQueries({ queryKey: ['officer-cards'] })
      setShowCloseModal(false)
      setClosePassword('')
    } catch (err) {
      toast.error(getErrorMessage(err))
    } finally {
      setClosing(false)
    }
  }

  if (cardLoading) return (
    <div className="min-h-dvh bg-green-50 dark:bg-night-800 flex flex-col">
      <header className="flex items-center gap-3 px-4 py-3">
        <button onClick={() => navigate(-1)} className="w-9 h-9 bg-white dark:bg-night-700 border border-green-200 dark:border-night-500 rounded-xl flex items-center justify-center">
          <ArrowLeft className="w-5 h-5 text-green-700 dark:text-night-100" />
        </button>
        <div className="h-6 w-32 bg-green-100 dark:bg-night-600 rounded animate-pulse" />
      </header>
      <div className="px-4 space-y-4">
        <div className="h-52 bg-green-100 dark:bg-night-600 rounded-3xl animate-pulse" />
        <div className="h-20 bg-green-100 dark:bg-night-600 rounded-2xl animate-pulse" />
        <div className="h-40 bg-green-100 dark:bg-night-600 rounded-2xl animate-pulse" />
      </div>
    </div>
  )

  if (!card) return (
    <div className="min-h-dvh bg-green-50 dark:bg-night-800 flex items-center justify-center">
      <p className="text-green-600 dark:text-night-200 font-semibold">Card not found</p>
    </div>
  )

  const isFood     = card.card_type === 'food'
  const progress   = Math.min(100, Math.round((card.total_days_contributed / 372) * 100))
  const remaining  = 372 - card.total_days_contributed
  const isComplete = card.status === 'completed'

  const cellGrid: (GridCell | undefined)[][] = Array.from({ length: 12 }, (_, m) =>
    Array.from({ length: 31 }, (_, d) => grid?.[m]?.[d])
  )

  return (
    <div className="min-h-dvh flex flex-col bg-green-50 dark:bg-night-800">
      {/* Top bar */}
      <header className="flex items-center gap-3 px-4 py-3 bg-green-50 dark:bg-night-800">
        <button onClick={() => navigate(`/officer/customers/${customerId}`)}
          className="w-9 h-9 bg-white dark:bg-night-700 border border-green-200 dark:border-night-500 rounded-xl flex items-center justify-center active:scale-95 transition-all">
          <ArrowLeft className="w-5 h-5 text-green-700 dark:text-night-100" />
        </button>
        <div>
          <h1 className="text-green-900 dark:text-white font-extrabold text-lg leading-tight">
            {isFood ? '🍱 Food Card' : '📋 Regular Card'}
          </h1>
          <p className="text-green-400 dark:text-night-300 text-xs">
            Card #{card.card_number}{customer ? ` · ${customer.full_name}` : ''}
          </p>
        </div>
        <span className={cn('ml-auto text-xs font-bold px-2.5 py-1 rounded-full',
          isComplete ? 'bg-green-100 dark:bg-night-600 text-green-700 dark:text-night-100' : 'bg-amber-100 text-amber-700'
        )}>
          {isComplete ? 'Completed' : 'Active'}
        </span>
      </header>

      <div className="flex-1 overflow-y-auto px-4 pb-10">

        {/* Flippable card */}
        <div className="w-full mb-5 mt-2 cursor-pointer flip-card" style={{ perspective: '1000px', height: '200px' }}
          onClick={() => setFlipped(f => !f)}>
          <motion.div className="w-full h-full relative"
            animate={{ rotateY: flipped ? 180 : 0 }}
            transition={{ duration: 0.55, type: 'spring', stiffness: 200, damping: 25 }}
            style={{ transformStyle: 'preserve-3d' }}
          >
            <div className="absolute inset-0 rounded-3xl overflow-hidden" style={{ backfaceVisibility: 'hidden' }}>
              <div className="w-full h-full p-5 flex flex-col justify-between relative overflow-hidden"
                style={{ background: 'linear-gradient(135deg, #052E16 0%, #064E3B 55%, #065F46 100%)' }}>
                <div className="absolute rounded-full opacity-25" style={{ width: 150, height: 150, background: '#059669', top: -40, right: -30 }} />
                <div className="absolute rounded-full opacity-15" style={{ width: 90, height: 90, background: '#34D399', top: 10, right: 20 }} />
                <div className="relative z-10 flex items-start justify-between">
                  <div>
                    <p className="text-green-300 dark:text-night-300 text-xs font-semibold tracking-widest uppercase">MonieKing</p>
                    <p className="text-green-500 dark:text-night-200 text-xs mt-0.5">Contributors</p>
                  </div>
                  <span className={cn('text-xs font-bold px-3 py-1 rounded-full',
                    isFood ? 'bg-green-700 text-green-200 dark:text-night-400' : 'bg-amber-500/20 text-amber-400'
                  )}>
                    {isFood ? '🍱 Food' : '📋 Regular'}
                  </span>
                </div>
                <div className="relative z-10">
                  <p className="text-green-400 dark:text-night-300 text-xs uppercase tracking-wide mb-1">Daily Rate</p>
                  <p className="text-amber-400 text-3xl font-extrabold tracking-tight">{formatNaira(card.rate_kobo)}</p>
                  <div className="mt-3 h-1.5 bg-green-800 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${progress}%`, background: isFood ? '#34D399' : '#F59E0B' }} />
                  </div>
                  <div className="flex justify-between mt-1.5">
                    <p className="text-green-400 dark:text-night-300 text-xs">{card.total_days_contributed} / 372 days</p>
                    <p className="text-green-400 dark:text-night-300 text-xs">{progress}%</p>
                  </div>
                  <div className="flex items-center gap-1 mt-2">
                    <RotateCcw className="w-3 h-3 text-green-500 dark:text-night-200" />
                    <p className="text-green-500 dark:text-night-200 text-xs">Tap to see contribution grid</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="absolute inset-0 rounded-3xl overflow-hidden bg-green-50 border border-green-200 dark:border-night-500"
              style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}>
              <div className="w-full h-full p-3 flex flex-col">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-green-700 dark:text-night-100 text-xs font-bold uppercase tracking-wide">Contribution Grid</p>
                  <div className="flex items-center gap-2 text-xs text-green-500 dark:text-night-200">
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-green-600 inline-block" /> Filled</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-red-400 inline-block" /> Withdrawn</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-green-100 dark:bg-night-600 inline-block" /> Empty</span>
                  </div>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar" onClick={e => e.stopPropagation()} style={{ WebkitOverflowScrolling: 'touch' }}>
                  <div className="flex gap-0.5 mb-1 ml-6">
                    {Array.from({ length: 31 }, (_, i) => (
                      <div key={i} className="flex-1 text-center text-green-400 dark:text-night-300" style={{ fontSize: '5px' }}>{i + 1}</div>
                    ))}
                  </div>
                  {MONTH_NAMES.map((month, mIdx) => (
                    <div key={mIdx} className="flex items-center gap-0.5 mb-0.5">
                      <span className="text-green-600 dark:text-night-200 font-semibold w-5 shrink-0 text-right" style={{ fontSize: '6px' }}>{month}</span>
                      <div className="flex gap-0.5 flex-1">
                        {Array.from({ length: 31 }, (_, dIdx) => (
                          <div key={dIdx}
                            className={cn(
                              'flex-1 rounded-sm',
                              cellGrid[mIdx]?.[dIdx]?.withdrawn ? 'bg-red-400' :
                              cellGrid[mIdx]?.[dIdx]?.filled    ? 'bg-green-600' : 'bg-green-100 dark:bg-night-600'
                            )}
                            style={{ aspectRatio: '1' }}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-center text-green-400 dark:text-night-300 mt-1" style={{ fontSize: '9px' }}>Tap to flip back</p>
              </div>
            </div>
          </motion.div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-3 mb-5">
          <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-3">
            <TrendingUp className="w-4 h-4 text-green-500 dark:text-night-200 mb-1" />
            <p className="text-green-900 dark:text-white font-extrabold text-lg">{card.total_days_contributed}</p>
            <p className="text-green-400 dark:text-night-300 text-xs">Days saved</p>
          </div>
          <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-3">
            <Calendar className="w-4 h-4 text-amber-500 dark:text-amber-300 mb-1" />
            <p className="text-green-900 dark:text-white font-extrabold text-lg">{remaining}</p>
            <p className="text-green-400 dark:text-night-300 text-xs">Days left</p>
          </div>
          <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-3">
            <Clock className="w-4 h-4 text-green-500 dark:text-night-200 mb-1" />
            <p className="text-green-900 dark:text-white font-extrabold text-sm">{formatNaira(card.total_contributed_kobo)}</p>
            <p className="text-green-400 dark:text-night-300 text-xs">Total saved</p>
          </div>
        </div>

        {/* Card info */}
        <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-4 mb-5">
          <p className="text-green-500 dark:text-night-200 text-xs font-bold uppercase tracking-widest mb-3">Card details</p>
          <div className="space-y-2.5">
            {[
              ...(customer ? [{ label: 'Card owner', value: customer.full_name }] : []),
              { label: 'Card type',  value: isFood ? 'Food Card' : 'Regular Card' },
              { label: 'Daily rate', value: `${formatNaira(card.rate_kobo)}/day` },
              { label: 'Created',    value: formatDate(card.created_at) },
              { label: 'Status',     value: card.status.charAt(0).toUpperCase() + card.status.slice(1) },
              ...(isComplete && card.completed_at ? [{ label: 'Completed', value: formatDate(card.completed_at) }] : []),
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between text-sm">
                <span className="text-green-500 dark:text-night-200">{label}</span>
                <span className="text-green-900 dark:text-white font-semibold">{value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Food card conversion warning */}
        {isFood && !isComplete && (
          <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-2xl p-4 mb-5">
            <p className="text-amber-700 dark:text-amber-300 text-sm font-semibold mb-1">🔒 Food Card — funds locked</p>
            <p className="text-amber-600 dark:text-amber-300 text-xs leading-relaxed">
              Complete all 372 days by November 30 to qualify for December food distribution. Converting to a Regular Card will permanently lose food eligibility.
            </p>
            <button
              onClick={handleConvert}
              disabled={converting}
              className="mt-3 text-xs font-bold text-amber-700 dark:text-amber-300 underline disabled:opacity-50"
            >
              {converting ? 'Converting…' : 'Convert to Regular Card'}
            </button>
          </div>
        )}

        {/* Action buttons */}
        {!isComplete && (
          <div className="flex gap-3 mb-3">
            <button
              onClick={() => setActivePanel(p => p === 'contribute' ? 'none' : 'contribute')}
              className="flex-1 min-w-0 flex items-center justify-center gap-2 bg-green-900 text-white font-bold text-sm rounded-full py-3.5 active:scale-95 transition-all shadow-card"
            >
              <Plus className="w-4 h-4 shrink-0" /> Post contribution
            </button>
            {!isFood && (
              <button
                onClick={() => setActivePanel(p => p === 'withdraw' ? 'none' : 'withdraw')}
                className="flex-1 min-w-0 flex items-center justify-center gap-2 border-2 border-green-200 dark:border-night-500 text-green-700 dark:text-night-100 font-bold text-sm rounded-full py-3.5 active:scale-95 transition-all"
              >
                <ArrowUpRight className="w-4 h-4 shrink-0" /> Withdraw
              </button>
            )}
          </div>
        )}

        {!isComplete && !isFood && card.total_contributed_kobo > 0 && (
          <button
            onClick={() => setShowCloseModal(true)}
            className="w-full flex items-center justify-center gap-1.5 text-red-400 dark:text-red-300 text-xs font-semibold mb-5"
          >
            <XCircle className="w-3.5 h-3.5" /> Close this card early
          </button>
        )}

        {isComplete && !isFood && (
          <button
            onClick={() => setActivePanel(p => p === 'withdraw' ? 'none' : 'withdraw')}
            className="w-full flex items-center justify-center gap-2 bg-green-900 text-white font-bold text-sm rounded-full py-4 active:scale-95 transition-all shadow-card mb-5"
          >
            <ArrowUpRight className="w-4 h-4" /> Request withdrawal
          </button>
        )}

        {/* Post contribution panel */}
        {activePanel === 'contribute' && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            className="relative bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-4 mb-5"
          >
            {loading && <PleaseHold message={`Please hold while we mark ${customer ? `${customer.full_name}'s` : 'this'} card…`} />}
            <p className="text-green-700 dark:text-night-100 text-xs font-bold uppercase tracking-wide mb-2">Amount (₦)</p>
            <div className="relative mb-2">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-green-500 dark:text-night-200 font-bold">₦</span>
              <input
                type="text"
                inputMode="decimal"
                name="officer-contribute-amount"
                autoComplete="off"
                value={amountNaira}
                onChange={e => setAmountNaira(e.target.value.replace(/[^0-9.]/g, ''))}
                placeholder={`${card.rate_kobo / 100} minimum`}
                className="w-full border-2 border-green-200 dark:border-night-500 rounded-xl pl-8 pr-4 py-3 text-sm text-green-900 dark:text-white font-semibold focus:outline-none focus:border-green-500"
              />
            </div>
            {amountKobo > 0 && (
              <div className={cn('text-xs font-semibold mb-4 flex items-center gap-1',
                isContributeValid ? 'text-green-600 dark:text-night-200' : 'text-red-500'
              )}>
                {isContributeValid
                  ? <><Check className="w-3 h-3" /> {amountKobo / card.rate_kobo} day(s) will be marked</>
                  : `Amount must be a multiple of ${formatNaira(card.rate_kobo)}`
                }
              </div>
            )}
            <button
              onClick={handleContribute}
              disabled={!isContributeValid || loading}
              className="w-full bg-green-900 text-white font-bold text-sm rounded-full py-3.5 active:scale-95 transition-all disabled:opacity-40"
            >
              {loading ? 'Posting…' : 'Confirm contribution'}
            </button>
          </motion.div>
        )}

        {/* Withdraw panel */}
        {activePanel === 'withdraw' && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-4 mb-5"
          >
            <p className="text-green-700 dark:text-night-100 text-xs font-bold uppercase tracking-wide mb-2">Amount to withdraw (₦)</p>
            <div className="relative mb-3">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-green-500 dark:text-night-200 font-bold">₦</span>
              <input
                type="text"
                inputMode="decimal"
                name="officer-card-withdraw-amount"
                autoComplete="off"
                value={withdrawNaira}
                onChange={e => setWithdrawNaira(e.target.value.replace(/[^0-9.]/g, ''))}
                placeholder={`Max: ${card.total_contributed_kobo / 100}`}
                className="w-full border-2 border-green-200 dark:border-night-500 rounded-xl pl-8 pr-4 py-3 text-sm text-green-900 dark:text-white font-semibold focus:outline-none focus:border-green-500"
              />
            </div>

            {withdrawKobo > 0 && (
              <div className="bg-green-50 border border-green-100 dark:border-night-500 rounded-2xl p-3 mb-4">
                {!isValidWithdrawMultiple ? (
                  <p className="text-red-400 dark:text-red-300 text-xs font-semibold">
                    Amount must be a multiple of {formatNaira(card.rate_kobo)}
                  </p>
                ) : withdrawPreviewLoading ? (
                  <p className="text-green-500 dark:text-night-200 text-xs">Calculating charge…</p>
                ) : withdrawPreview ? (
                  <>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-green-600 dark:text-night-200">Requested</span>
                      <span className="text-green-900 dark:text-white font-semibold">{formatNaira(withdrawKobo)}</span>
                    </div>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-green-600 dark:text-night-200">
                        Processing charge ({withdrawPreview.months_touched} month{withdrawPreview.months_touched > 1 ? 's' : ''})
                      </span>
                      <span className="text-red-400 dark:text-red-300 font-semibold">- {formatNaira(charge)}</span>
                    </div>
                    <div className="h-px bg-green-100 dark:bg-night-600 my-1" />
                    <div className="flex justify-between">
                      <span className="text-green-900 dark:text-white font-bold text-sm">Customer receives</span>
                      <span className={cn('font-extrabold', netPayable > 0 ? 'text-green-700 dark:text-night-100' : 'text-red-400')}>
                        {formatNaira(Math.max(0, netPayable))}
                      </span>
                    </div>
                    {withdrawPreview.is_risky && (
                      <div className="flex items-center gap-1.5 mt-2">
                        <AlertCircle className="w-3.5 h-3.5 text-amber-500 dark:text-amber-300 flex-shrink-0" />
                        <p className="text-amber-600 dark:text-amber-300 text-xs font-semibold">This may lead to an extra charge later</p>
                      </div>
                    )}
                  </>
                ) : null}
                {withdrawKobo > card.total_contributed_kobo && (
                  <div className="flex items-center gap-1.5 mt-2">
                    <AlertCircle className="w-3.5 h-3.5 text-red-400 dark:text-red-300 flex-shrink-0" />
                    <p className="text-red-400 dark:text-red-300 text-xs font-semibold">Exceeds available balance</p>
                  </div>
                )}
              </div>
            )}

            <p className="text-green-700 dark:text-night-100 text-xs font-bold uppercase tracking-wide mb-2">
              <Lock className="w-3 h-3 inline mr-1" />Your withdrawal password
            </p>
            <div className="relative mb-5">
              <input
                type="text"
                name="officer-card-withdrawal-pin"
                autoComplete="off"
                style={{ WebkitTextSecurity: showPwd ? 'none' : 'disc' } as React.CSSProperties}
                value={password}
                onChange={e => setPassword(e.target.value)}
                onFocus={handlePasswordFocus}
                placeholder="Enter your withdrawal password"
                className="w-full border-2 border-green-200 dark:border-night-500 rounded-xl px-4 py-3 pr-16 text-sm text-green-900 dark:text-white focus:outline-none focus:border-green-500"
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
              onClick={handleWithdraw}
              disabled={!canWithdraw || loading || bioLoading}
              className="w-full bg-green-900 text-white font-bold text-sm rounded-full py-3.5 active:scale-95 transition-all disabled:opacity-40"
            >
              {loading ? 'Submitting…' : bioLoading ? 'Confirm with fingerprint…' : 'Submit withdrawal request'}
            </button>
          </motion.div>
        )}

        {/* Recent contributions */}
        {contributions.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-green-900 dark:text-white font-bold text-base">Contribution history</p>
              {contributions.length > 2 && (
                <button onClick={() => setShowHistory(true)} className="text-green-700 dark:text-night-100 text-xs font-bold underline">
                  View more
                </button>
              )}
            </div>
            <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card px-4">
              {contributions.slice(0, 2).map(c => (
                <div key={c.id} className="flex items-center justify-between py-3 border-b border-green-50 dark:border-night-600 last:border-0">
                  <div>
                    <p className="text-green-900 dark:text-white text-sm font-semibold">
                      {MONTH_NAMES[c.logical_month - 1]} Day {c.logical_day}
                    </p>
                    <p className="text-green-400 dark:text-night-300 text-xs mt-0.5">
                      {c.method === 'cash_via_officer' ? 'Cash via officer' : 'Digital'} · {formatDate(c.created_at)}
                    </p>
                  </div>
                  <p className="text-green-700 dark:text-night-100 font-bold text-sm">{formatNaira(c.amount_kobo)}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <ContributionHistoryModal
        open={showHistory}
        onClose={() => setShowHistory(false)}
        contributions={contributions}
      />

      {showCloseModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={() => !closing && setShowCloseModal(false)}>
          <div className="absolute inset-0 bg-green-950/60 backdrop-blur-sm" />
          <motion.div
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="relative bg-white dark:bg-night-700 rounded-t-3xl w-full max-w-lg p-6 pb-10"
            onClick={e => e.stopPropagation()}
          >
            <div className="w-10 h-1 bg-green-200 dark:bg-night-500 rounded-full mx-auto mb-5" />
            <h2 className="text-green-900 dark:text-white font-extrabold text-lg leading-tight mb-2">Close this card early?</h2>
            <p className="text-green-600 dark:text-night-200 text-sm leading-relaxed mb-4">
              {customer ? `${customer.full_name} has` : 'This customer has'} saved {formatNaira(card.total_contributed_kobo)} so far.
              Closing now stops further contributions on this card and makes that amount available to withdraw
              right away — the remaining unfilled days are simply given up. This can't be undone.
            </p>
            <p className="text-green-700 dark:text-night-100 text-xs font-bold uppercase tracking-wide mb-2">
              <Lock className="w-3 h-3 inline mr-1" />Your withdrawal password
            </p>
            <div className="relative mb-5">
              <input
                type="text"
                name="officer-close-card-withdrawal-pin"
                autoComplete="off"
                style={{ WebkitTextSecurity: showClosePwd ? 'none' : 'disc' } as React.CSSProperties}
                value={closePassword}
                onChange={e => setClosePassword(e.target.value)}
                placeholder="Enter your withdrawal password"
                className="w-full border-2 border-green-200 dark:border-night-500 rounded-xl px-4 py-3 pr-10 text-sm text-green-900 dark:text-white focus:outline-none focus:border-green-500"
              />
              <button type="button" onClick={() => setShowClosePwd(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-green-400 dark:text-night-300">
                {showClosePwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowCloseModal(false)}
                disabled={closing}
                className="flex-1 border-2 border-green-200 dark:border-night-500 text-green-700 dark:text-night-100 font-bold text-sm rounded-full py-3.5 active:scale-95 transition-all disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                onClick={handleClose}
                disabled={closing || closePassword.length < 6}
                className="flex-1 bg-red-500 text-white font-bold text-sm rounded-full py-3.5 active:scale-95 transition-all disabled:opacity-40"
              >
                {closing ? 'Closing…' : 'Close card'}
              </button>
            </div>
          </motion.div>
        </div>
      )}

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
              This withdrawal only partially empties a month on this card. If a future withdrawal reaches into
              the rest of that same month separately, it gets charged the processing fee again for it.
              Advise the customer to withdraw everything they need in one request if possible. You can still
              proceed if this is intentional.
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
                className="flex-1 bg-green-900 text-white font-bold text-sm rounded-full py-3.5 active:scale-95 transition-all disabled:opacity-40"
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