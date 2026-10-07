import { useState, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowLeft, Check, AlertCircle, Wallet } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { idempotencyKey } from '@/lib/utils'
import { api, getErrorMessage } from '@/lib/api'
import { useWallet } from '@/hooks/useWallet'
import { formatNaira, isValidContribution, daysFromContribution } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { PleaseHold } from '@/components/ui/PleaseHold'
import type { ContributionCard } from '@/types'

export default function ContributePage() {
  const navigate      = useNavigate()
  const { cardId }    = useParams<{ cardId: string }>()
  const idemKeyRef = useRef(idempotencyKey())
  const qc            = useQueryClient()
  const { wallet }    = useWallet()
  const [amountNaira, setAmountNaira] = useState('')
  const [loading, setLoading]         = useState(false)

  const { data: card, isLoading } = useQuery({
    queryKey: ['card', cardId],
    queryFn: async () => {
      const { data } = await api.get<ContributionCard>(`/cards/${cardId}`)
      return data
    },
    enabled: !!cardId,
  })

  const amountKobo  = Math.round(parseFloat(amountNaira || '0') * 100)
  const isValid     = card ? isValidContribution(amountKobo, card.rate_kobo) : false
  const days        = card && amountKobo > 0 ? daysFromContribution(amountKobo, card.rate_kobo) : 0
  const hasBalance  = wallet ? wallet.balance_kobo >= amountKobo : false
  const remaining   = card ? 372 - card.total_days_contributed : 0
  const wouldExceed = days > remaining

  const quickAmounts = card ? [1, 5, 10, 20].map(d => ({
    label: `${d} day${d > 1 ? 's' : ''}`,
    kobo:  d * card.rate_kobo,
  })) : []

  const handleContribute = async () => {
    if (!card || !isValid || !hasBalance || wouldExceed) return
    setLoading(true)
    try {
      await api.post('/contributions', { card_id: card.id, amount_kobo: amountKobo }, {
        headers: { 'Idempotency-Key': idemKeyRef.current },
      })
      toast.success(`${days} day${days > 1 ? 's' : ''} contributed successfully!`)
      qc.invalidateQueries({ queryKey: ['cards'] })
      qc.invalidateQueries({ queryKey: ['wallet'] })
      qc.invalidateQueries({ queryKey: ['card', cardId] })
      qc.invalidateQueries({ queryKey: ['card-grid', cardId] })
      qc.invalidateQueries({ queryKey: ['card-grids'] })
      qc.invalidateQueries({ queryKey: ['contributions', cardId] })
      // land on the card that was just marked (its grid is already refreshed)
      navigate(`/customer/cards/${card.id}`, { replace: true })
    } catch (err) {
      toast.error(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-dvh flex flex-col bg-green-50 dark:bg-night-800">
      {/* Top bar */}
      <header className="flex items-center gap-3 px-4 py-3 bg-green-50 dark:bg-night-800">
        <button onClick={() => navigate(-1)}
          className="w-9 h-9 bg-white dark:bg-night-700 border border-green-200 dark:border-night-500 rounded-xl flex items-center justify-center active:scale-95 transition-all">
          <ArrowLeft className="w-5 h-5 text-green-700 dark:text-night-100" />
        </button>
        <h1 className="text-green-900 dark:text-white font-extrabold text-lg">Contribute</h1>
      </header>

      <div className="relative flex-1 overflow-y-auto px-4 pb-safe-nav">
        {loading && <PleaseHold message="Please hold while we mark your card…" />}
        {isLoading ? (
          <div className="space-y-4 mt-4">
            <div className="h-32 bg-green-100 dark:bg-night-600 rounded-3xl animate-pulse" />
            <div className="h-16 bg-green-100 dark:bg-night-600 rounded-2xl animate-pulse" />
          </div>
        ) : !card ? (
          <div className="text-center py-16">
            <AlertCircle className="w-10 h-10 text-red-300 dark:text-red-400 mx-auto mb-3" />
            <p className="text-green-700 dark:text-night-100 font-semibold">Card not found</p>
          </div>
        ) : (
          <>
            {/* Card summary */}
            <motion.div
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              className="relative rounded-3xl overflow-hidden mb-5 mt-2 bg-hero-gradient dark:bg-night-gradient"
            >
              <div className="absolute rounded-full opacity-20 dark:opacity-15 bg-green-600 dark:bg-night-400" style={{ width: 120, height: 120, top: -30, right: -20 }} />
              <div className="relative z-10 p-5">
                <div className="flex items-center justify-between mb-3">
                  <span className={cn('text-xs font-bold px-3 py-1 rounded-full',
                    card.card_type === 'food' ? 'bg-green-700 dark:bg-night-500/30 text-green-200 dark:text-night-100' : 'bg-amber-500/20 dark:bg-night-500/30 text-amber-400 dark:text-night-100'
                  )}>
                    {card.card_type === 'food' ? '🍱 Food Card' : '📋 Regular Card'}
                  </span>
                  <p className="text-green-400 dark:text-night-300 text-xs">{remaining} days remaining</p>
                </div>
                <p className="text-amber-400 dark:text-night-100 text-3xl font-extrabold">{formatNaira(card.rate_kobo)}<span className="text-green-400 dark:text-night-300 text-sm font-normal">/day</span></p>
                <div className="mt-3 h-1.5 bg-green-800 dark:bg-night-600 rounded-full overflow-hidden">
                  <div className="h-full rounded-full bg-amber-400 dark:bg-night-100"
                    style={{ width: `${Math.min(100, (card.total_days_contributed / 372) * 100)}%` }} />
                </div>
                <div className="flex justify-between mt-1.5">
                  <p className="text-green-400 dark:text-night-300 text-xs">{card.total_days_contributed} / 372 days</p>
                  <p className="text-green-400 dark:text-night-300 text-xs">{formatNaira(card.total_contributed_kobo)} saved</p>
                </div>
              </div>
            </motion.div>

            {/* Wallet balance */}
            <div className="bg-white dark:bg-night-700 border border-green-100 dark:border-night-500 rounded-2xl p-4 mb-5 flex items-center justify-between shadow-card">
              <div className="flex items-center gap-2">
                <Wallet className="w-4 h-4 text-green-500 dark:text-night-200" />
                <span className="text-green-600 dark:text-night-200 text-sm font-medium">Wallet balance</span>
              </div>
              <span className="text-green-900 dark:text-white font-extrabold">{formatNaira(wallet?.balance_kobo ?? 0)}</span>
            </div>

            {/* Quick amounts */}
            <p className="text-green-700 dark:text-night-100 text-xs font-bold uppercase tracking-wide mb-2">Quick select</p>
            <div className="grid grid-cols-4 gap-2 mb-5">
              {quickAmounts.map(q => (
                <button key={q.kobo}
                  onClick={() => setAmountNaira(String(q.kobo / 100))}
                  className={cn('py-2.5 rounded-xl border-2 text-xs font-bold transition-all',
                    amountKobo === q.kobo
                      ? 'border-green-900 dark:border-night-200 bg-green-50 dark:bg-night-600 text-green-900 dark:text-white'
                      : 'border-green-100 dark:border-night-500 text-green-600 dark:text-night-200 bg-white dark:bg-night-700'
                  )}
                >
                  {q.label}
                </button>
              ))}
            </div>

            {/* Amount input */}
            <p className="text-green-700 dark:text-night-100 text-xs font-bold uppercase tracking-wide mb-2">Or enter amount</p>
            <div className="relative mb-3">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-green-500 dark:text-night-200 font-bold text-lg">₦</span>
              <input
                type="text"
                inputMode="decimal"
                name="customer-contribute-amount"
                autoComplete="off"
                value={amountNaira}
                onChange={e => setAmountNaira(e.target.value.replace(/[^0-9.]/g, ''))}
                placeholder={`${card.rate_kobo / 100} minimum`}
                className="w-full border-2 border-green-200 dark:border-night-500 rounded-xl pl-9 pr-4 py-4 text-xl text-green-900 dark:text-white font-bold focus:outline-none focus:border-green-500 dark:focus:border-night-200 bg-white dark:bg-night-700"
              />
            </div>

            {/* Validation feedback */}
            {amountKobo > 0 && (
              <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                className={cn('rounded-2xl p-3 mb-5 flex items-start gap-2',
                  isValid && hasBalance && !wouldExceed ? 'bg-green-50 dark:bg-night-600 border border-green-200 dark:border-night-500' : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/40'
                )}
              >
                {isValid && hasBalance && !wouldExceed
                  ? <Check className="w-4 h-4 text-green-600 dark:text-night-200 mt-0.5 flex-shrink-0" />
                  : <AlertCircle className="w-4 h-4 text-red-400 dark:text-red-300 mt-0.5 flex-shrink-0" />
                }
                <p className={cn('text-xs font-semibold',
                  isValid && hasBalance && !wouldExceed ? 'text-green-700 dark:text-night-100' : 'text-red-500 dark:text-red-300'
                )}>
                  {!isValid
                    ? `Amount must be a multiple of ${formatNaira(card.rate_kobo)}`
                    : !hasBalance
                    ? `Insufficient wallet balance. Fund your wallet first.`
                    : wouldExceed
                    ? `Only ${remaining} days remaining on this card`
                    : `${days} day${days > 1 ? 's' : ''} will be marked · Wallet debit: ${formatNaira(amountKobo)}`
                  }
                </p>
              </motion.div>
            )}

            {/* Submit */}
            <button
              onClick={handleContribute}
              disabled={!isValid || !hasBalance || wouldExceed || loading || amountKobo <= 0}
              className="w-full bg-green-900 dark:bg-night-100 text-white dark:text-night-900 font-bold text-base rounded-full py-4 active:scale-95 transition-all disabled:opacity-40 shadow-card"
            >
              {loading ? 'Processing…' : `Contribute ${amountKobo > 0 ? formatNaira(amountKobo) : ''}`}
            </button>
          </>
        )}
      </div>
    </div>
  )
}