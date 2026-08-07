import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowLeft, Plus, ArrowUpRight, RotateCcw, Lock, Calendar, TrendingUp, Clock, XCircle, Eye, EyeOff } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { api, getErrorMessage } from '@/lib/api'
import { formatNaira, formatDate, formatDateTime, MONTH_NAMES } from '@/lib/utils'
import { cn } from '@/lib/utils'
import type { ContributionCard, CardGrid, GridCell, ContributionRecord } from '@/types'
import { ContributionHistoryModal } from '@/components/cards/ContributionHistoryModal'
import { DisputeModal } from '@/components/disputes/DisputeModal'
import { FEATURE_FLAGS } from '@/config/featureFlags'

export default function CardDetailPage() {
  const navigate    = useNavigate()
  const { cardId }  = useParams<{ cardId: string }>()
  const qc = useQueryClient()
  const [flipped, setFlipped] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [showCloseModal, setShowCloseModal] = useState(false)
  const [showDispute, setShowDispute] = useState(false)
  const [closePassword, setClosePassword] = useState('')
  const [showClosePwd, setShowClosePwd] = useState(false)
  const [converting, setConverting] = useState(false)
  const [closing, setClosing] = useState(false)

  const { data: card, isLoading: cardLoading } = useQuery({
    queryKey: ['card', cardId],
    queryFn: async () => {
      const { data } = await api.get<ContributionCard>(`/cards/${cardId}`)
      return data
    },
    enabled: !!cardId,
  })

  const { data: gridResponse } = useQuery({
    queryKey: ['card-grid', cardId],
    queryFn: async () => {
      const { data } = await api.get<{ card_id: string; grid: CardGrid }>(`/cards/${cardId}/grid`)
      return data
    },
    enabled: !!cardId,
  })
  const grid = gridResponse?.grid

  const { data: contributions = [] } = useQuery({
    queryKey: ['contributions', cardId],
    queryFn: async () => {
      const { data } = await api.get<ContributionRecord[]>(`/contributions/${cardId}`)
      return data
    },
    enabled: !!cardId,
  })

  const handleConvert = async () => {
    if (!window.confirm('Convert this Food Card to a Regular Card? You will permanently lose food eligibility. This cannot be undone.')) return
    setConverting(true)
    try {
      await api.post(`/cards/${cardId}/convert`)
      toast.success('Card converted to Regular')
      qc.invalidateQueries({ queryKey: ['card', cardId] })
      qc.invalidateQueries({ queryKey: ['cards'] })
    } catch (err) {
      toast.error(getErrorMessage(err))
    } finally {
      setConverting(false)
    }
  }

  const handleClose = async () => {
    if (closePassword.length < 6) return
    setClosing(true)
    try {
      await api.post(`/cards/${cardId}/close`, { withdrawal_password: closePassword })
      toast.success('Card closed — funds are now withdrawable')
      qc.invalidateQueries({ queryKey: ['card', cardId] })
      qc.invalidateQueries({ queryKey: ['cards'] })
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
  // Once a withdrawal has been requested (or paid), the days-progress bar
  // has nothing left to communicate — it would otherwise show a
  // confusing "0/372" once the money's gone. Only show it while the
  // card is still open, or completed-but-not-yet-withdrawn.
  const showProgress = !isComplete || card.completion_status === 'unpaid'

  // Build flat grid array from API response
  const cellGrid: (GridCell | undefined)[][] = Array.from({ length: 12 }, (_, m) =>
    Array.from({ length: 31 }, (_, d) => grid?.[m]?.[d])
  )

  return (
    <div className="min-h-dvh flex flex-col bg-green-50 dark:bg-night-800">

      {/* Top bar */}
      <header className="flex items-center gap-3 px-4 py-3 bg-green-50 dark:bg-night-800">
        <button onClick={() => navigate(-1)}
          className="w-9 h-9 bg-white dark:bg-night-700 border border-green-200 dark:border-night-500 rounded-xl flex items-center justify-center active:scale-95 transition-all">
          <ArrowLeft className="w-5 h-5 text-green-700 dark:text-night-100" />
        </button>
        <div>
          <h1 className="text-green-900 dark:text-white font-extrabold text-lg leading-tight">
            {isFood ? '🍱 Food Card' : '📋 Regular Card'}
          </h1>
          <p className="text-green-400 dark:text-night-300 text-xs font-semibold">Card #{card.card_number}</p>
        </div>
        <span className={cn('ml-auto text-xs font-bold px-2.5 py-1 rounded-full',
          isComplete ? 'bg-green-100 dark:bg-night-600 text-green-700 dark:text-night-100' : 'bg-amber-100 dark:bg-amber-500/15 text-amber-700'
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
            {/* Front */}
            <div className="absolute inset-0 rounded-3xl overflow-hidden" style={{ backfaceVisibility: 'hidden' }}>
              <div className="w-full h-full p-5 flex flex-col justify-between relative overflow-hidden bg-hero-gradient dark:bg-night-gradient">
                <div className="absolute rounded-full opacity-25 dark:opacity-20 bg-green-600 dark:bg-night-400" style={{ width: 150, height: 150, top: -40, right: -30 }} />
                <div className="absolute rounded-full opacity-15 dark:opacity-10 bg-green-400 dark:bg-night-300" style={{ width: 90, height: 90, top: 10, right: 20 }} />
                <div className="relative z-10 flex items-start justify-between">
                  <div>
                    <p className="text-green-300 dark:text-night-300 text-xs font-semibold tracking-widest uppercase">MonieKing</p>
                    <p className="text-green-500 dark:text-night-200 text-xs mt-0.5">Contributors</p>
                  </div>
                  <span className={cn('text-xs font-bold px-3 py-1 rounded-full',
                    isFood ? 'bg-green-700 text-green-200 dark:text-night-400' : 'bg-amber-500/20 dark:bg-night-500/30 text-amber-400 dark:text-night-100'
                  )}>
                    {isFood ? '🍱 Food' : '📋 Regular'}
                  </span>
                </div>
                <div className="relative z-10">
                  <p className="text-green-400 dark:text-night-300 text-xs uppercase tracking-wide mb-1">Daily Rate</p>
                  <p className="text-amber-400 dark:text-night-100 text-3xl font-extrabold tracking-tight">{formatNaira(card.rate_kobo)}</p>
                  {showProgress && (
                    <>
                      <div className="mt-3 h-1.5 bg-green-800 dark:bg-night-600 rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${progress}%`, background: isFood ? '#34D399' : '#F59E0B' }} />
                      </div>
                      <div className="flex justify-between mt-1.5">
                        <p className="text-green-400 dark:text-night-300 text-xs">{card.total_days_contributed} / 372 days</p>
                        <p className="text-green-400 dark:text-night-300 text-xs">{progress}%</p>
                      </div>
                    </>
                  )}
                  <div className="flex items-center gap-1 mt-2">
                    <RotateCcw className="w-3 h-3 text-green-500 dark:text-night-200" />
                    <p className="text-green-500 dark:text-night-200 text-xs">Tap to see contribution grid</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Back — 12×31 grid */}
            <div className="absolute inset-0 rounded-3xl overflow-hidden bg-green-50 dark:bg-night-600 border border-green-200 dark:border-night-500"
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
              { label: 'Card type',    value: isFood ? 'Food Card' : 'Regular Card' },
              { label: 'Daily rate',   value: `${formatNaira(card.rate_kobo)}/day` },
              { label: 'Created',      value: formatDate(card.created_at) },
              { label: 'Status',       value: card.status.charAt(0).toUpperCase() + card.status.slice(1) },
              ...(isComplete && card.completed_at ? [{ label: 'Completed', value: formatDate(card.completed_at) }] : []),
              ...(isFood && card.food_eligibility_lost_at ? [{ label: 'Food eligibility', value: 'Lost (converted)' }] : []),
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
            <p className="text-amber-600 dark:text-amber-300/80 text-xs leading-relaxed">
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
              onClick={() => navigate(`/customer/cards/${cardId}/contribute`)}
              className="flex-1 min-w-0 flex items-center justify-center gap-2 bg-green-900 dark:bg-night-100 text-white dark:text-night-900 font-bold text-sm rounded-full py-3.5 active:scale-95 transition-all shadow-card"
            >
              {isFood ? <Lock className="w-4 h-4 shrink-0" /> : <Plus className="w-4 h-4 shrink-0" />}
              Contribute
            </button>
            {!isFood && (
              <button
                onClick={() => FEATURE_FLAGS.WITHDRAWALS_ENABLED && navigate(`/customer/withdrawals/new?card=${cardId}`)}
                disabled={!FEATURE_FLAGS.WITHDRAWALS_ENABLED}
                className="relative flex-1 min-w-0 flex items-center justify-center gap-2 border-2 border-green-200 dark:border-night-500 text-green-700 dark:text-night-100 font-bold text-sm rounded-full py-3.5 active:scale-95 transition-all disabled:opacity-50 disabled:active:scale-100"
              >
                <ArrowUpRight className="w-4 h-4 shrink-0" /> Withdraw
                {!FEATURE_FLAGS.WITHDRAWALS_ENABLED && (
                  <span className="absolute -top-2 -right-2 text-[9px] font-bold text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-500/20 px-1.5 py-0.5 rounded-full">SOON</span>
                )}
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

        {isComplete && card.completion_status === 'unpaid' && !isFood && (
          <button
            onClick={() => FEATURE_FLAGS.WITHDRAWALS_ENABLED && navigate(`/customer/withdrawals/new?card=${cardId}`)}
            disabled={!FEATURE_FLAGS.WITHDRAWALS_ENABLED}
            className="relative w-full flex items-center justify-center gap-2 bg-green-900 dark:bg-night-100 text-white dark:text-night-900 font-bold text-sm rounded-full py-4 active:scale-95 transition-all shadow-card mb-5 disabled:opacity-50 disabled:active:scale-100"
          >
            <ArrowUpRight className="w-4 h-4" /> {FEATURE_FLAGS.WITHDRAWALS_ENABLED ? 'Request withdrawal' : 'Withdrawals coming soon'}
          </button>
        )}

        {isComplete && card.completion_status === 'withdrawal_pending' && !isFood && (
          <button
            disabled
            className="w-full flex items-center justify-center gap-2 bg-green-100 dark:bg-night-700 text-green-500 dark:text-night-300 font-bold text-sm rounded-full py-4 mb-5 cursor-not-allowed"
          >
            <Clock className="w-4 h-4" /> Pending approval
          </button>
        )}

        {isComplete && card.completion_status === 'paid' && card.latest_withdrawal_id && !isFood && (
          <button
            onClick={() => setShowDispute(true)}
            className="w-full text-red-400 dark:text-red-300 font-bold text-sm py-3.5 rounded-full border-2 border-red-100 dark:border-red-900/40 active:scale-95 transition-all mb-5"
          >
            Dispute this withdrawal
          </button>
        )}

        {showDispute && card.latest_withdrawal_id && (
          <DisputeModal entityType="withdrawal" entityId={card.latest_withdrawal_id} onClose={() => setShowDispute(false)} />
        )}

        {isComplete && card.completion_status === 'paid' && card.latest_withdrawal_id && !isFood && (
          <button
            onClick={() => setShowDispute(true)}
            className="w-full text-red-400 dark:text-red-300 font-bold text-sm py-3.5 rounded-full border-2 border-red-100 dark:border-red-900/40 active:scale-95 transition-all mb-5"
          >
            Dispute this withdrawal
          </button>
        )}

        {showDispute && card.latest_withdrawal_id && (
          <DisputeModal entityType="withdrawal" entityId={card.latest_withdrawal_id} onClose={() => setShowDispute(false)} />
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
              {contributions.slice(0, 2).map((c) => (
                <div key={c.id} className="flex items-center justify-between py-3 border-b border-green-50 dark:border-night-600 last:border-0">
                  <div>
                    <p className="text-green-900 dark:text-white text-sm font-semibold">
                      {MONTH_NAMES[c.logical_month - 1]} Day {c.logical_day}
                    </p>
                    <p className="text-green-400 dark:text-night-300 text-xs mt-0.5">
                      {c.method === 'cash_via_officer' ? 'Cash via officer' : 'Digital'} · {formatDateTime(c.created_at).split(',')[0]}
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
              You've saved {formatNaira(card.total_contributed_kobo)} so far. Closing now stops further
              contributions on this card and makes that amount available to withdraw right away — the
              remaining unfilled days are simply given up. This can't be undone.
            </p>
            <p className="text-green-700 dark:text-night-100 text-xs font-bold uppercase tracking-wide mb-2">
              <Lock className="w-3 h-3 inline mr-1" />Your withdrawal password
            </p>
            <div className="relative mb-5">
              <input
                type="text"
                name="close-card-withdrawal-pin"
                autoComplete="off"
                style={{ WebkitTextSecurity: showClosePwd ? 'none' : 'disc' } as React.CSSProperties}
                value={closePassword}
                onChange={e => setClosePassword(e.target.value)}
                placeholder="Enter your withdrawal password"
                className="w-full border-2 border-green-200 dark:border-night-500 rounded-xl px-4 py-3 pr-10 text-sm text-green-900 dark:text-white focus:outline-none focus:border-green-500 dark:focus:border-night-200"
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
    </div>
  )
}