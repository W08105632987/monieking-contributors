import { useState } from 'react'
import { Avatar } from '@/components/ui/Avatar'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence, type Variants } from 'framer-motion'
import {
  Users, Wallet, ArrowUpRight, ArrowDownLeft,
  TrendingUp, UserPlus, ClipboardList,
  Eye, EyeOff, Lock, AlertCircle, X, Copy, MapPin, Scan,
} from 'lucide-react'
import { FoodQrScannerModal } from '@/components/food/FoodQrScannerModal'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { api, getErrorMessage } from '@/lib/api'
import { useAuthStore } from '@/store/auth.store'
import { useWallet } from '@/hooks/useWallet'
import { PromoBannerCarousel } from '@/components/dashboard/PromoBannerCarousel'
import { CustomerStatsPanel } from '@/components/dashboard/CustomerStatsPanel'
import { formatNaira, initials, formatDate, copyToClipboard } from '@/lib/utils'
import { cn } from '@/lib/utils'
import type { ContributionCard, User } from '@/types'
import { BrandBlobLogo } from '@/components/brand/BrandBlobLogo'

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
    <motion.div
      initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
      transition={{ type: 'spring', damping: 18, stiffness: 260, mass: 0.9 }}
      className="fixed inset-0 z-50 bg-white dark:bg-night-700 overflow-y-auto"
    >
      <div className="sticky top-0 bg-white dark:bg-night-700 flex items-center gap-3 px-5 pt-5 pb-3 border-b border-green-50 z-10">
        <button onClick={onClose} className="w-9 h-9 rounded-full bg-green-50 dark:bg-night-600 flex items-center justify-center">
          <X className="w-4 h-4 text-green-700 dark:text-night-100" />
        </button>
        <div className="flex items-center gap-2">
          <Wallet className="w-5 h-5 text-green-700 dark:text-night-100" />
          <h2 className="text-green-900 dark:text-white font-extrabold text-lg leading-tight">Withdraw to my account</h2>
        </div>
      </div>

      <div className="px-5 pt-4 pb-10">
        <p className="text-green-500 dark:text-night-200 text-xs mb-5">Sent instantly — no approval wait.</p>

        <p className="text-green-700 dark:text-night-100 text-xs font-bold uppercase tracking-wide mb-2">Amount (₦)</p>
        <div className="relative mb-2">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-green-500 dark:text-night-200 font-bold text-lg">₦</span>
          <input
            type="text"
            inputMode="decimal"
            name="officer-wallet-withdraw-amount"
            autoComplete="off"
            value={amountNaira}
            onChange={e => setAmountNaira(e.target.value.replace(/[^0-9.]/g, ''))}
            placeholder={`Max: ${(wallet?.balance_kobo ?? 0) / 100}`}
            className="w-full border-2 border-green-200 dark:border-night-500 rounded-xl pl-9 pr-4 py-4 text-xl text-green-900 dark:text-white font-bold focus:outline-none focus:border-green-500 bg-white"
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
            name="officer-dashboard-withdrawal-pin"
            autoComplete="off"
            style={{ WebkitTextSecurity: showPwd ? 'none' : 'disc' } as React.CSSProperties}
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Enter your withdrawal password"
            className="w-full border-2 border-green-200 dark:border-night-500 rounded-xl px-4 py-3.5 pr-10 text-sm text-green-900 dark:text-white focus:outline-none focus:border-green-500 bg-white"
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
      </div>
    </motion.div>
  )
}

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: (i: number) => ({
    opacity: 1, y: 0,
    transition: { delay: i * 0.07, type: 'spring', stiffness: 300, damping: 28 },
  }),
}

export default function OfficerDashboardPage() {
  const navigate    = useNavigate()
  const { user }    = useAuthStore()
  const { wallet, isLoading: walletLoading } = useWallet()
  const [showWalletWithdraw, setShowWalletWithdraw] = useState(false)
  const [showFoodScanner, setShowFoodScanner] = useState(false)

  // Fetch zone customers
  const { data: customers = [], isLoading: customersLoading } = useQuery({
    queryKey: ['officer-customers'],
    queryFn: async () => {
      const { data } = await api.get<User[]>('/users?role=customer&page_size=100')
      return data
    },
  })

  // Fetch all cards for zone customers
  const { data: cards = [], isLoading: cardsLoading } = useQuery({
    queryKey: ['officer-cards'],
    queryFn: async () => {
      const { data } = await api.get<ContributionCard[]>('/cards?include_completed=false')
      return data
    },
  })

  const activeCards           = cards.filter(c => c.status === 'active').length
  const regularCards          = cards.filter(c => c.card_type === 'regular').length
  const foodCards             = cards.filter(c => c.card_type === 'food').length

  return (
    <div className="min-h-dvh flex flex-col bg-green-50 dark:bg-night-800">

      {/* Top bar */}
      <header className="flex items-center justify-between px-4 py-3 bg-green-50 dark:bg-night-800">
        <BrandBlobLogo height={36} />
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold bg-green-900 text-amber-400 px-2.5 py-1 rounded-full">Officer</span>
          <button onClick={() => navigate('/officer/profile')} className="rounded-full shadow-card">
          <Avatar name={user?.full_name ?? 'O'} avatarUrl={user?.avatar_url} size={40} />
        </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto pb-safe-nav px-4">

        {/* Greeting */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-2 mb-4">
          <p className="text-green-500 dark:text-night-200 text-xs font-semibold uppercase tracking-widest">Officer portal</p>
          <h1 className="text-green-900 dark:text-white text-2xl font-extrabold mt-0.5">
            {user?.full_name.split(' ').slice(0, 2).join(' ')}
          </h1>
          {/* Zone badge — persistent, so an officer always knows which
              zone they're working with, and immediately sees if they
              have none (which now also blocks customer registration —
              see CustomersPage.tsx). */}
          {user?.zone_id ? (
            <div className="inline-flex items-center gap-1.5 mt-2 bg-green-100 dark:bg-night-600 rounded-full px-3 py-1.5">
              <MapPin className="w-3.5 h-3.5 text-green-700 dark:text-night-100" />
              <span className="text-green-800 dark:text-night-100 text-xs font-bold">{user.zone_name}</span>
            </div>
          ) : (
            <div className="inline-flex items-center gap-1.5 mt-2 bg-amber-50 dark:bg-night-600 rounded-full px-3 py-1.5">
              <MapPin className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
              <span className="text-amber-700 dark:text-amber-300 text-xs font-bold">No zone assigned</span>
            </div>
          )}
        </motion.div>

        {/* Officer wallet card */}
        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.35 }}
          className="relative rounded-3xl overflow-hidden mb-4"
          style={{ background: 'linear-gradient(135deg, #052E16 0%, #064E3B 60%, #065F46 100%)' }}
        >
          <div className="absolute rounded-full opacity-25" style={{ width: 160, height: 160, background: '#059669', top: -40, right: -30 }} />
          <div className="absolute rounded-full opacity-15" style={{ width: 100, height: 100, background: '#34D399', top: 10, right: 20 }} />

          <div className="relative z-10 p-5">
            <div className="flex items-center gap-2 mb-1">
              <Wallet className="w-4 h-4 text-green-400 dark:text-night-300" />
              <p className="text-green-300 dark:text-night-300 text-xs font-semibold uppercase tracking-widest">Officer wallet</p>
            </div>
            {walletLoading ? (
              <div className="h-9 w-36 bg-green-700 rounded-xl animate-pulse mb-1" />
            ) : (
              <p className="text-white text-4xl font-extrabold tracking-tight mb-1">
                {formatNaira(wallet?.balance_kobo ?? 0)}
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
                  className="text-copper-400 hover:text-copper-300 transition-colors flex-shrink-0"
                  aria-label="Copy account number"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => navigate('/officer/wallet')}
                className="flex-1 min-w-0 flex items-center justify-center gap-2 bg-amber-400 text-green-900 dark:text-white font-bold text-sm rounded-full py-3 active:scale-95 transition-all"
              >
                <ArrowDownLeft className="w-4 h-4" /> Fund wallet
              </button>
              <button
                onClick={() => setShowWalletWithdraw(true)}
                className="flex-1 min-w-0 flex items-center justify-center gap-2 border-2 border-green-500 text-green-300 dark:text-night-300 font-bold text-sm rounded-full py-3 active:scale-95 transition-all"
              >
                <ArrowUpRight className="w-4 h-4" /> Withdraw
              </button>
            </div>
          </div>
        </motion.div>

        {/* Zone stats */}
        <motion.div custom={0} variants={fadeUp} initial="hidden" animate="show" className="grid grid-cols-2 gap-3 mb-4">
          <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 bg-green-100 dark:bg-night-600 rounded-xl flex items-center justify-center">
                <Users className="w-4 h-4 text-green-600 dark:text-night-200" />
              </div>
              <p className="text-green-500 dark:text-night-200 text-xs font-semibold uppercase tracking-wide">My customers</p>
            </div>
            <p className="text-green-900 dark:text-white text-2xl font-extrabold">
              {customersLoading ? '—' : customers.length}
            </p>
            <p className="text-green-400 dark:text-night-300 text-xs mt-0.5">in your zone</p>
          </div>
          <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 bg-green-100 dark:bg-night-600 rounded-xl flex items-center justify-center">
                <TrendingUp className="w-4 h-4 text-green-600 dark:text-night-200" />
              </div>
              <p className="text-green-500 dark:text-night-200 text-xs font-semibold uppercase tracking-wide">Active cards</p>
            </div>
            <p className="text-green-900 dark:text-white text-2xl font-extrabold">
              {cardsLoading ? '—' : activeCards}
            </p>
            <p className="text-green-400 dark:text-night-300 text-xs mt-0.5">{regularCards} regular · {foodCards} food</p>
          </div>
        </motion.div>

        {/* Customer statistics — All time by default, with a compact
            dropdown (same style as the director's hero-card period
            picker) to narrow to Today / 7 days / Custom. Inactive-list
            + bulk-ping stays behind "See more" to keep this card
            compact on the dashboard. */}
        {user?.zone_id && (
          <motion.div custom={1} variants={fadeUp} initial="hidden" animate="show" className="mb-4">
            <CustomerStatsPanel
              scope={{ kind: 'my_zone' }}
              showInactiveList={false}
              title="Customer statistics"
            />
            <button
              onClick={() => navigate('/officer/customer-stats')}
              className="w-full text-center bg-white dark:bg-night-700 border border-green-100 dark:border-night-500 text-green-700 dark:text-night-100 font-bold text-xs rounded-2xl py-3 -mt-1 active:scale-95 transition-all"
            >
              See more
            </button>
          </motion.div>
        )}

        {/* Promo banners */}
        <PromoBannerCarousel />

        {/* Quick actions */}
        <motion.div custom={1} variants={fadeUp} initial="hidden" animate="show" className="mb-4">
          <h2 className="text-green-900 dark:text-white font-bold text-base mb-3">Quick actions</h2>
          <div className="grid grid-cols-2 gap-3">
            {[
              {
                icon: UserPlus,
                label: 'Register customer',
                sublabel: 'Add a new cash customer',
                color: 'bg-green-900',
                textColor: 'text-white',
                onClick: () => navigate('/officer/customers'),
              },
              {
                icon: ClipboardList,
                label: 'Post contribution',
                sublabel: 'Record a cash payment',
                color: 'bg-amber-400',
                textColor: 'text-green-950',
                onClick: () => navigate('/officer/customers'),
              },
              {
                icon: ArrowUpRight,
                label: 'Request withdrawal',
                sublabel: 'On behalf of customer',
                color: 'bg-white dark:bg-night-700',
                textColor: 'text-green-900 dark:text-white',
                border: true,
                onClick: () => navigate('/officer/customers'),
              },
              {
                icon: Scan,
                label: 'Food QR Scanner',
                sublabel: 'Verify Dec 10 collection',
                color: 'bg-green-900 dark:bg-night-600',
                textColor: 'text-white',
                onClick: () => setShowFoodScanner(true),
              },
              {
                icon: ClipboardList,
                label: 'My Food Ledger',
                sublabel: 'What you\'ve distributed',
                color: 'bg-white dark:bg-night-700',
                textColor: 'text-green-900 dark:text-white',
                border: true,
                onClick: () => navigate('/officer/food-ledger'),
              },
              {
                icon: Users,
                label: 'View customers',
                sublabel: 'See your full zone list',
                color: 'bg-white dark:bg-night-700',
                textColor: 'text-green-900 dark:text-white',
                border: true,
                onClick: () => navigate('/officer/customers'),
              },
            ].map(({ icon: Icon, label, sublabel, color, textColor, border, onClick }) => (
              <button
                key={label}
                onClick={onClick}
                className={cn(
                  'rounded-2xl p-4 text-left active:scale-95 transition-all shadow-card',
                  color,
                  border ? 'border-2 border-green-100 dark:border-night-500' : '',
                )}
              >
                <div className={cn('w-8 h-8 rounded-xl flex items-center justify-center mb-3',
                  color.includes('bg-green-900') ? 'bg-green-800 dark:bg-night-500' :
                  color === 'bg-amber-400' ? 'bg-amber-500/30' : 'bg-green-50 dark:bg-night-600'
                )}>
                  <Icon className={cn('w-4 h-4', color.includes('bg-white') ? 'text-green-600 dark:text-night-200' : textColor)} />
                </div>
                <p className={cn('font-bold text-sm', textColor)}>{label}</p>
                <p className={cn('text-xs mt-0.5', color.includes('bg-white') ? 'text-green-400 dark:text-night-300' : 'opacity-75', textColor)}>{sublabel}</p>
              </button>
            ))}
          </div>
        </motion.div>

        {/* Recent customers */}
        <motion.div custom={2} variants={fadeUp} initial="hidden" animate="show">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-green-900 dark:text-white font-bold text-base">Recent customers</h2>
            <button
              onClick={() => navigate('/officer/customers')}
              className="text-green-600 dark:text-night-200 text-xs font-semibold"
            >
              View all
            </button>
          </div>

          {customersLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => (
                <div key={i} className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 p-4 flex gap-3">
                  <div className="w-10 h-10 bg-green-100 dark:bg-night-600 rounded-full animate-pulse flex-shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 bg-green-100 dark:bg-night-600 rounded animate-pulse w-2/3" />
                    <div className="h-2 bg-green-50 dark:bg-night-600 rounded animate-pulse w-1/3" />
                  </div>
                </div>
              ))}
            </div>
          ) : customers.length === 0 ? (
            <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card text-center py-10 px-6">
              <Users className="w-10 h-10 text-green-200 dark:text-night-400 mx-auto mb-3" />
              <p className="text-green-700 dark:text-night-100 font-semibold text-sm">No customers yet</p>
              <p className="text-green-400 dark:text-night-300 text-xs mt-1 mb-4">Register your first cash customer to get started</p>
              <button
                onClick={() => navigate('/officer/customers')}
                className="bg-green-900 text-white font-bold text-xs rounded-full px-6 py-2.5 active:scale-95 transition-all"
              >
                Register customer
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {customers.slice(0, 5).map((customer, i) => (
                <motion.button
                  key={customer.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  onClick={() => navigate(`/officer/customers/${customer.customer_number}`)}
                  className="w-full bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-4 flex items-center gap-3 active:scale-99 transition-all text-left"
                >
                  <div className="w-10 h-10 rounded-full bg-green-900 flex items-center justify-center font-bold text-amber-400 text-sm flex-shrink-0">
                    {initials(customer.full_name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-green-900 dark:text-white font-semibold text-sm truncate">{customer.full_name}</p>
                    <p className="text-green-400 dark:text-night-300 text-xs mt-0.5">{customer.phone_number}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <span className="text-xs font-bold bg-green-100 dark:bg-night-600 text-green-700 dark:text-night-100 px-2 py-0.5 rounded-full">
                      Active
                    </span>
                    <p className="text-green-300 dark:text-night-300 text-xs mt-1">{formatDate(customer.created_at)}</p>
                  </div>
                </motion.button>
              ))}
            </div>
          )}
        </motion.div>
      </div>

      <AnimatePresence>
        {showWalletWithdraw && (
          <OfficerWalletWithdrawSheet onClose={() => setShowWalletWithdraw(false)} />
        )}
      </AnimatePresence>

      <FoodQrScannerModal
        isOpen={showFoodScanner}
        onClose={() => setShowFoodScanner(false)}
      />
    </div>
  )
}