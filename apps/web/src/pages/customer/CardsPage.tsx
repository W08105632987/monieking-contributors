import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, CreditCard, ChevronRight, RotateCcw, Lock, CheckCircle, Clock } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useCards } from '@/hooks/useCards'
import { BottomNav } from '@/components/layout/BottomNav'
import { useAuthStore } from '@/store/auth.store'
import { formatNaira, formatDate, MONTH_NAMES } from '@/lib/utils'
import { Avatar } from '@/components/ui/Avatar'
import { cn } from '@/lib/utils'
import type { ContributionCard, CardGrid } from '@/types'
import { BrandBlobLogo } from '@/components/brand/BrandBlobLogo'
import { FoodCardRulesModal } from '@/components/food/FoodCardRulesModal'
import { FoodQrDisplayModal } from '@/components/food/FoodQrDisplayModal'
import { QrCode } from 'lucide-react'
import { toast } from 'react-hot-toast'

// ── Flippable card ────────────────────────────────────────────────
function CardItem({ card, grid, onOpenFoodPass }: { card: ContributionCard; grid?: CardGrid; onOpenFoodPass?: (card: ContributionCard) => void }) {
  const [flipped, setFlipped] = useState(false)

  // Grid data comes from a single batched GET /cards/grids call made once
  // at the CardsPage level (see below) instead of each card fetching its
  // own grid independently. Previously this was `enabled: flipped` (grid
  // only loaded once you tapped the card — laggy on tap), then changed to
  // fetch unconditionally per-card (fast on tap, but N cards meant N
  // separate slow requests firing at once on page load). Batching gets
  // both: one request total, and it's already in the cache before anyone
  // taps a card.
  const navigate = useNavigate()
  const progress = Math.min(100, Math.round((card.total_days_contributed / 372) * 100))
  const isFood   = card.card_type === 'food'

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-4"
    >
      {/* Flip container */}
      <div
        className="w-full mb-3 cursor-pointer flip-card"
        style={{ perspective: '1000px', height: '180px' }}
        onClick={() => setFlipped(f => !f)}
      >
        <motion.div
          className="w-full h-full relative"
          animate={{ rotateY: flipped ? 180 : 0 }}
          transition={{ duration: 0.55, type: 'spring', stiffness: 200, damping: 25 }}
          style={{ transformStyle: 'preserve-3d' }}
        >
          {/* ── FRONT ── */}
          <div
            className="absolute inset-0 rounded-3xl overflow-hidden"
            style={{ backfaceVisibility: 'hidden' }}
          >
            <div
              className="w-full h-full p-5 flex flex-col justify-between relative overflow-hidden bg-hero-gradient dark:bg-night-gradient"
            >
              {/* Decorative blobs */}
              <div className="absolute rounded-full opacity-25 dark:opacity-20 bg-green-600 dark:bg-night-400" style={{ width: 140, height: 140, top: -40, right: -30 }} />
              <div className="absolute rounded-full opacity-15 dark:opacity-10 bg-green-400 dark:bg-night-300" style={{ width: 90, height: 90, top: 10, right: 20 }} />

              <div className="relative z-10 flex items-start justify-between">
                <div>
                  <p className="text-green-300 dark:text-night-300 text-xs font-semibold tracking-widest uppercase">MonieKing</p>
                  <p className="text-green-500 dark:text-night-200 text-xs mt-0.5">Contributors</p>
                </div>
                <span className={cn(
                  'text-xs font-bold px-3 py-1 rounded-full',
                  isFood ? 'bg-green-700 dark:bg-night-500/30 text-green-200 dark:text-night-100' : 'bg-amber-500/20 dark:bg-night-500/30 text-amber-400 dark:text-night-100'
                )}>
                  {isFood ? '🍱 Food' : '📋 Regular'}
                </span>
              </div>

              <div className="relative z-10">
                <p className="text-green-400 dark:text-night-300 text-xs uppercase tracking-wide mb-1">Daily Rate</p>
                <p className="text-amber-400 dark:text-night-100 text-3xl font-extrabold tracking-tight">{formatNaira(card.rate_kobo)}</p>
                <div className="mt-3 h-1.5 bg-green-800 dark:bg-night-600 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${progress}%`,
                      background: isFood ? '#34D399' : '#F59E0B',
                    }}
                  />
                </div>
                <div className="flex justify-between mt-1.5">
                  <p className="text-green-400 dark:text-night-300 text-xs">{card.total_days_contributed} / 372 days</p>
                  <p className="text-green-400 dark:text-night-300 text-xs">{progress}%</p>
                </div>
                <div className="flex items-center gap-1 mt-2">
                  <RotateCcw className="w-3 h-3 text-green-500 dark:text-night-200" />
                  <p className="text-green-500 dark:text-night-200 text-xs">Tap to see grid</p>
                </div>
              </div>
            </div>
          </div>

          {/* ── BACK — 12×31 grid ── */}
          <div
            className="absolute inset-0 rounded-3xl overflow-hidden bg-green-50 dark:bg-night-600 border border-green-200 dark:border-night-500"
            style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
          >
            <div className="w-full h-full p-3 flex flex-col">
              <div className="flex items-center justify-between mb-2">
                <p className="text-green-700 dark:text-night-100 text-xs font-bold uppercase tracking-wide">Contribution Grid</p>
                <div className="flex items-center gap-2 text-xs text-green-500 dark:text-night-200">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-green-600 inline-block" /> Filled</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-red-400 inline-block" /> Withdrawn</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-green-100 dark:bg-night-500 inline-block" /> Empty</span>
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
                      {Array.from({ length: 31 }, (_, dIdx) => {
                        const cell = grid?.[mIdx]?.[dIdx]
                        return (
                          <div
                            key={dIdx}
                            className={cn(
                              'flex-1 rounded-sm',
                              cell?.withdrawn ? 'bg-red-400' : cell?.filled ? 'bg-green-600' : 'bg-green-100 dark:bg-night-500'
                            )}
                            style={{ aspectRatio: '1' }}
                          />
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-center text-green-400 dark:text-night-300 mt-1" style={{ fontSize: '9px' }}>Tap to flip back</p>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Card actions */}
      <div className="flex gap-2 px-1">
        {card.status === 'active' ? (
          <>
            <button
              onClick={() => navigate(`/customer/cards/${card.card_number}/contribute`)}
              className="flex-1 flex items-center justify-center gap-2 bg-green-900 dark:bg-night-100 text-white dark:text-night-900 text-sm font-bold rounded-full py-3 active:scale-95 transition-all"
            >
              {isFood ? <Lock className="w-4 h-4" /> : <Plus className="w-4 h-4" />} Contribute
            </button>
            <button
              onClick={() => navigate(`/customer/cards/${card.card_number}`)}
              className="flex items-center justify-center gap-1 border-2 border-green-200 dark:border-night-500 text-green-700 dark:text-night-100 text-sm font-bold rounded-full px-5 py-3 active:scale-95 transition-all"
            >
              Details <ChevronRight className="w-4 h-4" />
            </button>
          </>
        ) : (
          <>
            {isFood && (
              <button
                onClick={() => onOpenFoodPass && onOpenFoodPass(card)}
                className="flex-1 flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-600 text-green-950 text-sm font-bold rounded-full py-3 active:scale-95 transition-all shadow-card"
              >
                <QrCode className="w-4 h-4" /> Food Pass (QR)
              </button>
            )}
            {card.completion_status !== 'paid' && !isFood && (
              <button
                onClick={() => navigate(`/customer/withdrawals/new?card=${card.id}`)}
                className="flex-1 flex items-center justify-center gap-2 bg-green-900 dark:bg-night-100 text-white dark:text-night-900 text-sm font-bold rounded-full py-3 active:scale-95 transition-all"
              >
                Request withdrawal
              </button>
            )}
            <button
              onClick={() => navigate(`/customer/cards/${card.card_number}`)}
              className={cn(
                'flex items-center justify-center gap-1 border-2 border-green-200 dark:border-night-500 text-green-700 dark:text-night-100 text-sm font-bold rounded-full py-3 active:scale-95 transition-all',
                (card.completion_status !== 'paid' && !isFood) ? 'px-5' : 'flex-1'
              )}
            >
              {(card.completion_status !== 'paid' && !isFood) ? <>Details <ChevronRight className="w-4 h-4" /></> : 'View details & history'}
            </button>
          </>
        )}
      </div>
    </motion.div>
  )
}

// ── Status badge for completed cards ─────────────────────────────
function CompletionBadge({ status }: { status: string | null }) {
  if (status === 'paid') return (
    <span className="flex items-center gap-1 text-xs font-bold bg-green-100 dark:bg-night-600 text-green-700 dark:text-night-100 px-2.5 py-1 rounded-full">
      <CheckCircle className="w-3 h-3" /> Paid
    </span>
  )
  if (status === 'partially_paid') return (
    <span className="flex items-center gap-1 text-xs font-bold bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 px-2.5 py-1 rounded-full">
      <Clock className="w-3 h-3" /> Partially paid
    </span>
  )
  return (
    <span className="flex items-center gap-1 text-xs font-bold bg-gray-100 dark:bg-night-600 text-gray-600 dark:text-night-200 px-2.5 py-1 rounded-full">
      Unpaid
    </span>
  )
}

// ── Create Card Modal ─────────────────────────────────────────────
function CreateCardModal({ onClose }: { onClose: () => void }) {
  const { createCard } = useCards()
  const [cardType, setCardType] = useState<'regular' | 'food'>('regular')
  const [rateNaira, setRateNaira] = useState('')
  const [loading, setLoading] = useState(false)
  const [foodRulesAccepted, setFoodRulesAccepted] = useState(false)
  const [showRulesModal, setShowRulesModal] = useState(false)

  const { data: foodWindow } = useQuery({
    queryKey: ['food-card-window'],
    queryFn: async () => {
      const { data } = await api.get<{
        open_from: string | null
        open_until: string | null
        is_open: boolean
        today: string
      }>('/settings/food-card-window')
      return data
    },
  })

  const isFoodOpen = foodWindow ? foodWindow.is_open : true

  const FOOD_RATE_KOBO = 100000
  const rateKobo = cardType === 'food' ? FOOD_RATE_KOBO : Math.round(parseFloat(rateNaira || '0') * 100)
  const isValid  = cardType === 'food' ? isFoodOpen : (rateKobo >= 5000 && rateKobo % 5000 === 0)

  const handleCreate = async () => {
    if (!isValid) return
    if (cardType === 'food') {
      if (!isFoodOpen) {
        toast.error('Food Card registration is currently closed.')
        return
      }
      if (!foodRulesAccepted) {
        setShowRulesModal(true)
        return
      }
    }
    setLoading(true)
    try {
      await createCard.mutateAsync({ card_type: cardType, rate_kobo: rateKobo })
      onClose()
    } finally {
      setLoading(false)
    }
  }

  const handleRulesAccepted = () => {
    setFoodRulesAccepted(true)
    setShowRulesModal(false)
  }

  return (
    <>
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
          <h2 className="text-green-900 dark:text-white font-extrabold text-xl mb-1">Create new card</h2>
          <p className="text-green-500 dark:text-night-200 text-sm mb-6">Choose your card type and daily contribution rate</p>

          {/* Card type */}
          <p className="text-green-700 dark:text-night-100 text-xs font-bold uppercase tracking-wide mb-3">Card type</p>
          <div className="grid grid-cols-2 gap-3 mb-6">
            {[
              { type: 'regular' as const, label: 'Regular Card', desc: 'Choose your daily rate', icon: '📋', badge: null },
              {
                type: 'food' as const,
                label: 'Food Card',
                desc: isFoodOpen ? 'Fixed ₦1,000/day · Locked' : 'Enrollment Closed',
                icon: '🍱',
                badge: !isFoodOpen ? 'Closed' : null,
              },
            ].map(opt => (
              <button
                key={opt.type}
                onClick={() => {
                  if (opt.type === 'food' && !isFoodOpen) {
                    const windowText = foodWindow?.open_from && foodWindow?.open_until
                      ? ` (${formatDate(foodWindow.open_from)} – ${formatDate(foodWindow.open_until)})`
                      : ''
                    toast.error(`Food Card registration is currently closed${windowText}.`)
                    return
                  }
                  setCardType(opt.type)
                  if (opt.type === 'food' && !foodRulesAccepted) {
                    setShowRulesModal(true)
                  }
                }}
                className={cn(
                  'relative p-4 rounded-2xl border-2 text-left transition-all',
                  cardType === opt.type
                    ? 'border-green-900 dark:border-night-200 bg-green-50 dark:bg-night-600'
                    : 'border-green-100 dark:border-night-500 bg-white dark:bg-night-700',
                  opt.type === 'food' && !isFoodOpen && 'opacity-80'
                )}
              >
                {opt.badge && (
                  <span className="absolute top-3 right-3 text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300">
                    {opt.badge}
                  </span>
                )}
                <span className="text-2xl block mb-2">{opt.icon}</span>
                <p className={cn('font-bold text-sm', cardType === opt.type ? 'text-green-900 dark:text-white' : 'text-green-700 dark:text-night-100')}>{opt.label}</p>
                <p className="text-green-400 dark:text-night-300 text-xs mt-0.5">{opt.desc}</p>
              </button>
            ))}
          </div>

          {/* Rate input — only for regular */}
          {cardType === 'regular' && (
            <>
              <p className="text-green-700 dark:text-night-100 text-xs font-bold uppercase tracking-wide mb-3">Daily rate (₦)</p>
              <div className="relative mb-2">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-green-500 dark:text-night-200 font-bold">₦</span>
                <input
                  type="text"
                  inputMode="decimal"
                  name="customer-create-card-rate"
                  autoComplete="off"
                  value={rateNaira}
                  onChange={e => setRateNaira(e.target.value.replace(/[^0-9.]/g, ''))}
                  placeholder="e.g. 500"
                  className="w-full border-2 border-green-200 dark:border-night-500 rounded-xl pl-8 pr-4 py-3 text-sm text-green-900 dark:text-white font-semibold focus:outline-none focus:border-green-500 dark:focus:border-night-200"
                />
              </div>
              {rateNaira && (
                <div className={cn('text-xs font-semibold mb-6', isValid ? 'text-green-600 dark:text-night-200' : 'text-red-500')}>
                  {isValid ? 'Looks good' : 'Rate must be a multiple of ₦50'}
                </div>
              )}
            </>
          )}

          {cardType === 'food' && (
            <div className="bg-green-50 dark:bg-night-600 rounded-2xl p-4 mb-6 border border-green-200 dark:border-night-500">
              {!isFoodOpen ? (
                <div className="flex items-center gap-2 text-amber-700 dark:text-amber-300 text-xs font-semibold">
                  <Lock className="w-4 h-4 shrink-0" />
                  <span>
                    Enrollment closed. Registration window is {foodWindow?.open_from ? formatDate(foodWindow.open_from) : 'TBD'} to {foodWindow?.open_until ? formatDate(foodWindow.open_until) : 'TBD'}.
                  </span>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-green-700 dark:text-night-100 text-sm font-semibold">🔒 Food Card Rules</p>
                    {foodRulesAccepted ? (
                      <span className="text-[11px] font-bold text-green-700 dark:text-green-400 bg-green-200/60 dark:bg-green-900/40 px-2 py-0.5 rounded-full">
                        ✓ Accepted
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setShowRulesModal(true)}
                        className="text-xs font-bold text-amber-700 dark:text-amber-300 underline"
                      >
                        View 5 Rules
                      </button>
                    )}
                  </div>
                  <p className="text-green-600 dark:text-night-200 text-xs leading-relaxed">
                    Fixed at ₦1,000/day. Complete all 372 days by Nov 30 to qualify for Dec 10 food distribution.
                  </p>
                </>
              )}
            </div>
          )}

          <button
            onClick={handleCreate}
            disabled={loading || !isValid}
            className="w-full bg-green-900 dark:bg-night-100 text-white dark:text-night-900 font-bold text-sm rounded-full py-4 active:scale-95 transition-all disabled:opacity-50 shadow-card"
          >
            {loading
              ? 'Creating card…'
              : cardType === 'food' && !isFoodOpen
              ? 'Food Card Enrollment Closed'
              : `Create ${cardType === 'food' ? 'Food' : 'Regular'} Card`}
          </button>
        </motion.div>
      </div>

      <FoodCardRulesModal
        isOpen={showRulesModal}
        onClose={() => setShowRulesModal(false)}
        onAccept={handleRulesAccepted}
      />
    </>
  )
}


// ── Tab types ─────────────────────────────────────────────────────
type Tab = 'active' | 'completed'

// ── Main page ─────────────────────────────────────────────────────
export default function CardsPage() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const { cards, isLoading } = useCards()
  const [searchParams] = useSearchParams()
  const [tab, setTab] = useState<Tab>(searchParams.get('tab') === 'completed' ? 'completed' : 'active')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [foodPassData, setFoodPassData] = useState<any | null>(null)
  const [showFoodPass, setShowFoodPass] = useState(false)

  const handleOpenFoodPass = async (_card: ContributionCard) => {
    try {
      const { data } = await api.get('/food-collections/me')
      if (data.has_entitlement) {
        setFoodPassData(data)
        setShowFoodPass(true)
      } else {
        toast.error('Food Collection Pass is unlocked upon completing all 372 contribution days before November 30.')
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Could not load food collection pass.')
    }
  }

  const activeCards    = cards.filter(c => c.status === 'active')
  const completedCards = cards.filter(c => c.status === 'completed' || c.status === 'archived')

  // One request for every active card's grid, instead of one request per
  // card. See GET /cards/grids on the backend.
  const { data: allGrids } = useQuery({
    queryKey: ['card-grids'],
    queryFn: async () => {
      const { data } = await api.get<{ card_id: string; grid: CardGrid }[]>('/cards/grids')
      return data
    },
    enabled: cards.length > 0,
    staleTime: 30_000,
  })
  const gridsByCardId: Record<string, CardGrid> = {}
  for (const g of allGrids ?? []) gridsByCardId[g.card_id] = g.grid

  return (
    <div className="min-h-dvh flex flex-col bg-green-50 dark:bg-night-800">

      {/* ── Top bar ── */}
      <header className="flex items-center justify-between px-4 py-3 bg-green-50 dark:bg-night-800">
        <BrandBlobLogo height={36} />
        <button onClick={() => navigate('/customer/profile')} className="rounded-full shadow-card">
          <Avatar name={user?.full_name ?? 'U'} avatarUrl={user?.avatar_url} size={40} />
        </button>
      </header>

      {/* ── Page title + create button ── */}
      <div className="px-4 mt-2 mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-green-900 dark:text-white text-2xl font-extrabold">My Cards</h1>
          <p className="text-green-500 dark:text-night-200 text-sm mt-0.5">
            {activeCards.length} active · {completedCards.length} completed
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 bg-green-900 dark:bg-night-100 text-white dark:text-night-900 text-sm font-bold rounded-full px-4 py-2.5 active:scale-95 transition-all shadow-card"
        >
          <Plus className="w-4 h-4" /> New card
        </button>
      </div>

      {/* ── Tabs ── */}
      <div className="px-4 mb-4">
        <div className="flex bg-green-100 dark:bg-night-600 rounded-2xl p-1 gap-1">
          {(['active', 'completed'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'flex-1 py-2 rounded-xl text-sm font-bold transition-all duration-200',
                tab === t
                  ? 'bg-green-900 dark:bg-night-100 text-white dark:text-night-900 shadow-card'
                  : 'text-green-600 dark:text-night-200 hover:text-green-800 dark:text-white'
              )}
            >
              {t === 'active' ? `Active (${activeCards.length})` : `Completed (${completedCards.length})`}
            </button>
          ))}
        </div>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-y-auto px-4 pb-40">
        <AnimatePresence mode="wait">

          {/* Active tab */}
          {tab === 'active' && (
            <motion.div
              key="active"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              transition={{ duration: 0.2 }}
            >
              {isLoading ? (
                <div className="space-y-4">
                  {[1, 2].map(i => (
                    <div key={i} className="h-44 bg-green-100 dark:bg-night-600 rounded-3xl animate-pulse" />
                  ))}
                </div>
              ) : activeCards.length === 0 ? (
                <div className="bg-white dark:bg-night-700 rounded-3xl border border-green-100 dark:border-night-500 shadow-card text-center pt-12 pb-10 px-8">
                  <div className="w-16 h-16 bg-green-50 dark:bg-night-600 rounded-2xl flex items-center justify-center mx-auto mb-6">
                    <CreditCard className="w-8 h-8 text-green-400 dark:text-night-300" />
                  </div>
                  <p className="text-green-900 dark:text-white font-bold text-xl mb-2">No cards yet</p>
                  <p className="text-green-400 dark:text-night-300 text-sm leading-relaxed mb-8">
                    Create your first contribution card to start saving towards your goal
                  </p>
                  <button
                    onClick={() => setShowCreateModal(true)}
                    className="w-full bg-green-900 dark:bg-night-100 text-white dark:text-night-900 font-bold text-sm rounded-full py-4 active:scale-95 transition-all shadow-card"
                  >
                    Create first card
                  </button>
                </div>
              ) : (
                activeCards.map(card => <CardItem key={card.id} card={card} grid={gridsByCardId[card.id]} />)
              )}
            </motion.div>
          )}

          {/* Completed tab */}
          {tab === 'completed' && (
            <motion.div
              key="completed"
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.2 }}
            >
              {completedCards.length === 0 ? (
                <div className="bg-white dark:bg-night-700 rounded-3xl border border-green-100 dark:border-night-500 shadow-card text-center py-16 px-6">
                  <CheckCircle className="w-12 h-12 text-green-200 dark:text-night-400 mx-auto mb-4" />
                  <p className="text-green-800 dark:text-white font-bold text-lg">No completed cards</p>
                  <p className="text-green-400 dark:text-night-300 text-sm mt-1">
                    Completed cards will appear here once you finish all 372 days
                  </p>
                </div>
              ) : (
                completedCards.map(card => (
                  <div key={card.id} className="relative">
                    <div className="absolute top-2 right-2 z-10">
                      <CompletionBadge status={card.completion_status} />
                    </div>
                    <CardItem card={card} grid={gridsByCardId[card.id]} onOpenFoodPass={handleOpenFoodPass} />
                  </div>
                ))
              )}
            </motion.div>
          )}

        </AnimatePresence>
      </div>

      <BottomNav />

      <AnimatePresence>
        {showCreateModal && <CreateCardModal onClose={() => setShowCreateModal(false)} />}
      </AnimatePresence>

      <FoodQrDisplayModal
        isOpen={showFoodPass && !!foodPassData}
        onClose={() => setShowFoodPass(false)}
        qrToken={foodPassData?.qr_token || ''}
        collectionPin={foodPassData?.collection_pin || ''}
        cardNumber={foodPassData?.card_number ?? null}
        packageName={foodPassData?.package_name || 'Standard Holiday Food Package'}
        status={foodPassData?.status || 'active'}
      />

    </div>
  )
}


