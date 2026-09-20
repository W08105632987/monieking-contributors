import { motion } from 'framer-motion'
import { Avatar } from '@/components/ui/Avatar'
import { Plus, ArrowUpRight, ArrowDownLeft, TrendingUp, Copy, Eye, EyeOff, CheckCircle2, Bell } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useAuthStore } from '@/store/auth.store'
import { useNotificationsStore } from '@/store/notifications.store'
import { useBalanceVisibility } from '@/hooks/useBalanceVisibility'
import { useWallet } from '@/hooks/useWallet'
import { useCards } from '@/hooks/useCards'
import { BottomNav } from '@/components/layout/BottomNav'
import { QuickActionsGrid } from '@/components/dashboard/QuickActionsGrid'
import { CardCarousel } from '@/components/dashboard/CardCarousel'
import { Badge } from '@/components/ui/Badge'
import { SkeletonCard, Skeleton } from '@/components/ui/Skeleton'
import { formatNaira, formatDate, copyToClipboard } from '@/lib/utils'
import { BrandBlobLogo } from '@/components/brand/BrandBlobLogo'

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  show: (i: number) => ({
    opacity: 1, y: 0,
    transition: { delay: i * 0.07, type: 'spring', stiffness: 300, damping: 30 },
  }),
}

export default function DashboardPage() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const { unreadCount } = useNotificationsStore()
  const { visible: showBalance, toggle: toggleBalance } = useBalanceVisibility(user?.id)
  const { wallet, isLoading: walletLoading } = useWallet()
  const { cards, isLoading: cardsLoading } = useCards()

  const activeCards    = cards.filter((c) => c.status === 'active')
  const completedCards = cards.filter((c) => c.status === 'completed')

  return (
    <div className="min-h-dvh flex flex-col bg-green-50 dark:bg-night-800">
      {/* ── Top bar ── */}
      <header className="flex items-center justify-between px-4 py-3 bg-green-50 dark:bg-night-800">
        <BrandBlobLogo height={36} />
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/customer/notifications')}
            className="relative w-10 h-10 flex items-center justify-center"
            aria-label="Notifications"
          >
            <Bell className="w-5.5 h-5.5 text-green-800 dark:text-white" />
            {unreadCount > 0 && (
              <span className="absolute top-1 right-1.5 w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center leading-none">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>
          <button onClick={() => navigate('/customer/profile')} className="rounded-full shadow-card">
            <Avatar name={user?.full_name ?? 'U'} avatarUrl={user?.avatar_url} size={40} />
          </button>
        </div>
      </header>

      {/* ── Scrollable content ── */}
      <div className="flex-1 overflow-y-auto pb-40 px-4">

        {/* Greeting */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="mb-4 mt-3"
        >
          <p className="text-green-500 dark:text-night-200 text-xs font-semibold uppercase tracking-widest">
            Good {getGreeting()}
          </p>
          <h1 className="text-green-900 dark:text-white text-2xl font-extrabold mt-0.5">
            {user?.full_name.split(' ').slice(0, 2).join(' ')}
          </h1>
        </motion.div>

        {/* ── Wallet balance card ── */}
        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.35, delay: 0.05 }}
          className="relative rounded-3xl overflow-hidden mb-4 bg-hero-gradient dark:bg-night-gradient"
        >
          {/* Decorative blobs — green in light mode, toned down to the
              night palette in dark so they don't clash against navy */}
          <div className="absolute rounded-full opacity-30 dark:opacity-20 bg-green-600 dark:bg-night-400"
               style={{ width: 160, height: 160, top: -40, right: -30 }} />
          <div className="absolute rounded-full opacity-20 dark:opacity-10 bg-green-400 dark:bg-night-300"
               style={{ width: 110, height: 110, top: 10, right: 20 }} />

          <div className="relative z-10 p-5">
            <div className="flex items-center justify-between mb-1">
              <p className="text-green-300 dark:text-night-200 text-xs font-semibold uppercase tracking-widest">
                Wallet balance
              </p>
              <button
                onClick={toggleBalance}
                className="text-green-300 dark:text-night-200 hover:text-white transition-colors"
                aria-label={showBalance ? 'Hide balance' : 'Show balance'}
              >
                {showBalance ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
              </button>
            </div>
            {walletLoading ? (
              <Skeleton className="h-9 w-40 bg-green-700 dark:bg-night-500 mb-1" />
            ) : (
              <p className="text-white text-4xl font-extrabold tracking-tight mb-1">
                {showBalance ? formatNaira(wallet?.balance_kobo ?? 0) : '••••••'}
              </p>
            )}
            <div className="flex items-center gap-1.5 mb-4">
              <p className="text-green-400 dark:text-night-300 text-xs">
                VA: {wallet?.virtual_account_number ?? '—'} · {wallet?.virtual_account_bank ?? 'Pending setup'}
              </p>
              {wallet?.virtual_account_number && (
                <button
                  onClick={async () => {
                    const ok = await copyToClipboard(wallet.virtual_account_number!)
                    if (ok) toast.success('Account number copied!')
                    else toast.error('Could not copy — try selecting it manually')
                  }}
                  className="text-copper-400 hover:text-copper-300 dark:text-night-200 dark:hover:text-night-100 transition-colors flex-shrink-0"
                  aria-label="Copy account number"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => navigate('/customer/wallet')}
                className="flex-1 min-w-0 flex items-center justify-center gap-2 bg-amber-400 dark:bg-night-100 text-green-900 dark:text-night-900 font-bold text-sm rounded-full py-2.5 active:scale-95 transition-all shadow-copper dark:shadow-none"
              >
                <ArrowDownLeft className="w-4 h-4" />
                Fund wallet
              </button>
              <button
                onClick={() => navigate('/customer/withdrawals/new')}
                className="flex-1 min-w-0 flex items-center justify-center gap-2 border-2 border-green-500 dark:border-night-300 text-green-300 dark:text-night-200 font-bold text-sm rounded-full py-2.5 active:scale-95 transition-all hover:bg-green-800/30 dark:hover:bg-white/10"
              >
                <ArrowUpRight className="w-4 h-4" />
                Withdraw
              </button>
            </div>
          </div>
        </motion.div>

        {/* ── Quick actions — replaces the old stat cards + promo carousel ── */}
        <QuickActionsGrid />

        {/* ── My cards ── */}
        <div className="flex items-center justify-between mb-3 mt-9">
          <h2 className="text-green-900 dark:text-white font-bold text-base">My cards</h2>
          <button
            onClick={() => navigate('/customer/cards')}
            className="flex items-center gap-1 text-green-700 dark:text-night-100 text-sm font-semibold hover:text-green-900 dark:hover:text-white"
          >
            <Plus className="w-4 h-4" />
            New card
          </button>
        </div>

        {cardsLoading ? (
          <div className="space-y-3">
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : activeCards.length === 0 ? (
          <motion.div
            custom={1} variants={fadeUp} initial="hidden" animate="show"
            className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card text-center py-10 px-4"
          >
            <TrendingUp className="w-10 h-10 text-green-300 dark:text-night-400 mx-auto mb-3" />
            <p className="text-green-800 dark:text-white font-semibold">No active cards yet</p>
            <p className="text-green-400 dark:text-night-300 text-sm mt-1 mb-4">
              Create your first contribution card to get started
            </p>
            <button
              onClick={() => navigate('/customer/cards')}
              className="bg-amber-400 dark:bg-night-100 text-green-900 dark:text-night-900 font-bold text-sm rounded-full px-6 py-2.5 active:scale-95 transition-all"
            >
              Create card
            </button>
          </motion.div>
        ) : (
          <CardCarousel cards={activeCards} />
        )}

        {/* ── Completed cards ── */}
        {completedCards.length > 0 && (
          <motion.div custom={5} variants={fadeUp} initial="hidden" animate="show" className="mt-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-green-900 dark:text-white font-bold text-base">Completed</h2>
              <button
                onClick={() => navigate('/customer/cards?tab=completed')}
                className="text-xs text-green-600 dark:text-night-200 font-semibold hover:underline"
              >
                View all
              </button>
            </div>
            <div className="space-y-2">
              {completedCards.slice(0, 2).map((card) => (
                <div key={card.id} className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-3.5 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-green-100 dark:bg-night-600 flex items-center justify-center flex-shrink-0">
                    <CheckCircle2 className="w-4.5 h-4.5 text-green-700 dark:text-night-100" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-green-900 dark:text-white text-sm font-semibold truncate">
                      {card.card_type === 'food' ? 'Food' : 'Regular'} · {formatNaira(card.rate_kobo)}/day
                    </p>
                    <p className="text-green-400 dark:text-night-300 text-xs mt-0.5">
                      {formatNaira(card.total_contributed_kobo)} · {card.completed_at ? formatDate(card.completed_at) : '—'}
                    </p>
                  </div>
                  <Badge
                    variant={
                      card.completion_status === 'paid' ? 'green'
                      : card.completion_status === 'partially_paid' ? 'copper'
                      : 'gray'
                    }
                  >
                    {card.completion_status === 'paid' ? 'Paid'
                      : card.completion_status === 'partially_paid' ? 'Partially paid'
                      : 'Unpaid'}
                  </Badge>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </div>

      <BottomNav />
    </div>
  )
}

function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'morning'
  if (hour < 17) return 'afternoon'
  return 'evening'
}