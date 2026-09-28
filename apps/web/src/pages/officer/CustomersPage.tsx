import { useState, useRef } from 'react'
import { Avatar } from '@/components/ui/Avatar'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Users, Search, UserPlus, Phone, Building2,
  CreditCard, ChevronRight,
  X, Check, Wallet, AlertTriangle,
} from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { api, getErrorMessage } from '@/lib/api'
import { showFeedback } from '@/store/feedback.store'
import { useAuthStore } from '@/store/auth.store'
import { useWallet } from '@/hooks/useWallet'
import { formatNaira, initials, idempotencyKey } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { PleaseHold } from '@/components/ui/PleaseHold'
import type { User, ContributionCard } from '@/types'
import { User as UserIcon } from 'lucide-react'
import { BrandBlobLogo } from '@/components/brand/BrandBlobLogo'

// ── Customer card (compact) ───────────────────────────────────────
function CustomerCard({ customer }: { customer: User }) {
  const navigate = useNavigate()

  return (
    <motion.button
      layout
      onClick={() => navigate(`/officer/customers/${customer.customer_number}`)}
      className="w-full bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card mb-3 flex items-center gap-3 p-4 text-left active:scale-[0.99] transition-all"
    >
      <div className="w-10 h-10 rounded-full bg-green-900 flex items-center justify-center font-bold text-amber-400 text-sm flex-shrink-0">
        {initials(customer.full_name)}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-green-900 dark:text-white font-semibold text-sm truncate">{customer.full_name}</p>
        <p className="text-green-400 dark:text-night-300 text-xs mt-0.5">{customer.phone_number}</p>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold bg-green-100 dark:bg-night-600 text-green-700 dark:text-night-100 px-2 py-0.5 rounded-full">
          Active
        </span>
        <ChevronRight className="w-4 h-4 text-green-300 dark:text-night-300" />
      </div>
    </motion.button>
  )
}

// ── Post contribution sheet ───────────────────────────────────────
export function PostContributionSheet({
  customer,
  onClose,
}: {
  customer: User
  onClose: () => void
}) {
  const { wallet } = useWallet()
  const qc = useQueryClient()

  const { data: cards = [], isLoading: cardsLoading } = useQuery({
    queryKey: ['customer-cards', customer.id],
    queryFn: async () => {
      const { data } = await api.get<ContributionCard[]>(`/cards?owner_id=${customer.id}`)
      return data.filter(c => c.status === 'active')
    },
  })

  const idemKeyRef = useRef(idempotencyKey())
  const [selectedCard, setSelectedCard] = useState<ContributionCard | null>(null)
  const [amountNaira, setAmountNaira]   = useState('')
  const [loading, setLoading]           = useState(false)

  const amountKobo = Math.round(parseFloat(amountNaira || '0') * 100)
  const isValid    = selectedCard && amountKobo > 0 && amountKobo % selectedCard.rate_kobo === 0
  const daysCount  = selectedCard && amountKobo > 0 ? Math.floor(amountKobo / selectedCard.rate_kobo) : 0
  const hasBalance = wallet ? wallet.balance_kobo >= amountKobo : false

  const handleSubmit = async () => {
    if (!selectedCard || !isValid || !hasBalance) return
    setLoading(true)
    try {
      await api.post('/contributions', {
        card_id:     selectedCard.id,
        amount_kobo: amountKobo,
      }, {
        headers: { 'Idempotency-Key': idemKeyRef.current },
      })
      toast.success(`${daysCount} day(s) contributed for ${customer.full_name}`)
      qc.invalidateQueries({ queryKey: ['officer-cards'] })
      qc.invalidateQueries({ queryKey: ['wallet'] })
      qc.invalidateQueries({ queryKey: ['customer-cards', customer.id] })
      qc.invalidateQueries({ queryKey: ['card-detail', selectedCard.id] })
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
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        className="relative bg-white dark:bg-night-700 rounded-t-3xl w-full max-w-lg p-6 pb-10"
        onClick={e => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-green-200 dark:bg-night-500 rounded-full mx-auto mb-5" />
        {loading && <PleaseHold message={`Please hold while we mark ${customer.full_name.split(' ')[0]}'s card…`} />}

        {/* Header */}
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-full bg-green-900 flex items-center justify-center font-bold text-amber-400 text-sm flex-shrink-0">
            {initials(customer.full_name)}
          </div>
          <div>
            <h2 className="text-green-900 dark:text-white font-extrabold text-lg leading-tight">Post contribution</h2>
            <p className="text-green-500 dark:text-night-200 text-xs">{customer.full_name} · {customer.phone_number}</p>
          </div>
        </div>

        {/* Officer wallet balance */}
        <div className="bg-green-50 border border-green-200 dark:border-night-500 rounded-2xl p-3 mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wallet className="w-4 h-4 text-green-600 dark:text-night-200" />
            <span className="text-green-700 dark:text-night-100 text-xs font-semibold">Your wallet balance</span>
          </div>
          <span className="text-green-900 dark:text-white font-extrabold text-sm">{formatNaira(wallet?.balance_kobo ?? 0)}</span>
        </div>

        {/* Select card */}
        <p className="text-green-700 dark:text-night-100 text-xs font-bold uppercase tracking-wide mb-2">Select card</p>
        {cardsLoading ? (
          <div className="h-12 bg-green-50 dark:bg-night-600 rounded-xl animate-pulse mb-4" />
        ) : cards.length === 0 ? (
          <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-xl p-3 mb-4 text-center">
            <p className="text-amber-700 dark:text-amber-300 text-xs font-semibold">This customer has no active cards</p>
          </div>
        ) : (
          <div className="space-y-2 mb-4">
            {cards.map(card => (
              <button
                key={card.id}
                onClick={() => setSelectedCard(card)}
                className={cn(
                  'w-full flex items-center justify-between p-3 rounded-xl border-2 text-left transition-all',
                  selectedCard?.id === card.id
                    ? 'border-green-900 dark:border-night-200 bg-green-50 dark:bg-night-600'
                    : 'border-green-100 dark:border-night-500 bg-white dark:bg-night-700',
                )}
              >
                <div>
                  <p className="text-green-900 dark:text-white text-sm font-semibold">
                    {card.card_type === 'food' ? '🍱 Food' : '📋 Regular'} · {formatNaira(card.rate_kobo)}/day
                  </p>
                  <p className="text-green-400 dark:text-night-300 text-xs mt-0.5">{card.total_days_contributed} days contributed</p>
                </div>
                {selectedCard?.id === card.id && (
                  <Check className="w-4 h-4 text-green-700 dark:text-night-100 flex-shrink-0" />
                )}
              </button>
            ))}
          </div>
        )}

        {/* Amount input */}
        {selectedCard && (
          <>
            <p className="text-green-700 dark:text-night-100 text-xs font-bold uppercase tracking-wide mb-2">Amount (₦)</p>
            <div className="relative mb-2">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-green-500 dark:text-night-200 font-bold">₦</span>
              <input
                type="text"
                inputMode="decimal"
                name="officer-post-contribution-amount"
                autoComplete="off"
                value={amountNaira}
                onChange={e => setAmountNaira(e.target.value.replace(/[^0-9.]/g, ''))}
                placeholder={`${selectedCard.rate_kobo / 100} minimum`}
                className="w-full border-2 border-green-200 dark:border-night-500 rounded-xl pl-8 pr-4 py-3 text-sm text-green-900 dark:text-white font-semibold focus:outline-none focus:border-green-500"
              />
            </div>

            {amountKobo > 0 && (
              <div className={cn('text-xs font-semibold mb-4 flex items-center gap-1',
                isValid && hasBalance ? 'text-green-600 dark:text-night-200' : 'text-red-500'
              )}>
                {isValid && hasBalance
                  ? <><Check className="w-3 h-3" /> {daysCount} day(s) will be marked · Wallet debit: {formatNaira(amountKobo)}</>
                  : !isValid
                  ? `Amount must be a multiple of ${formatNaira(selectedCard.rate_kobo)}`
                  : 'Insufficient wallet balance'
                }
              </div>
            )}
          </>
        )}

        <button
          onClick={handleSubmit}
          disabled={!isValid || !hasBalance || loading || cards.length === 0}
          className="w-full bg-green-900 text-white font-bold text-sm rounded-full py-4 active:scale-95 transition-all disabled:opacity-40"
        >
          {loading ? 'Posting…' : 'Confirm contribution'}
        </button>
      </motion.div>
    </div>
  )
}

// ── Create / add card sheet ───────────────────────────────────────
export function CreateCardSheet({
  customer,
  hasCards,
  onClose,
}: {
  customer: User
  hasCards: boolean
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [cardType, setCardType]   = useState<'regular' | 'food'>('regular')
  const [rateNaira, setRateNaira] = useState('')
  const [loading, setLoading]     = useState(false)

  const FOOD_RATE_KOBO = 100_000
  const rateKobo = cardType === 'food' ? FOOD_RATE_KOBO : Math.round(parseFloat(rateNaira || '0') * 100)
  const isValid  = cardType === 'food' ? true : (rateKobo >= 5_000 && rateKobo % 5_000 === 0)

  const handleSubmit = async () => {
    if (!isValid) { toast.error('Rate must be a multiple of ₦50'); return }
    setLoading(true)
    try {
      await api.post('/cards', {
        owner_id:  customer.id,
        card_type: cardType,
        rate_kobo: rateKobo,
      })
      toast.success(`Card created for ${customer.full_name}`)
      qc.invalidateQueries({ queryKey: ['customer-cards', customer.id] })
      qc.invalidateQueries({ queryKey: ['officer-cards'] })
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
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        className="relative bg-white dark:bg-night-700 rounded-t-3xl w-full max-w-lg p-6 pb-10"
        onClick={e => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-green-200 dark:bg-night-500 rounded-full mx-auto mb-5" />

        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-full bg-green-900 flex items-center justify-center font-bold text-amber-400 text-sm flex-shrink-0">
            {initials(customer.full_name)}
          </div>
          <div>
            <h2 className="text-green-900 dark:text-white font-extrabold text-lg leading-tight">
              {hasCards ? 'Add card' : 'Create card'}
            </h2>
            <p className="text-green-500 dark:text-night-200 text-xs">{customer.full_name} · {customer.phone_number}</p>
          </div>
        </div>

        <p className="text-green-700 dark:text-night-100 text-xs font-bold uppercase tracking-wide mb-2">Card type</p>
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setCardType('regular')}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 p-3 rounded-xl border-2 text-sm font-semibold transition-all',
              cardType === 'regular' ? 'border-green-900 bg-green-50 text-green-900 dark:text-white' : 'border-green-100 dark:border-night-500 text-green-500 dark:text-night-200',
            )}
          >
            📋 Regular
          </button>
          <button
            onClick={() => setCardType('food')}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 p-3 rounded-xl border-2 text-sm font-semibold transition-all',
              cardType === 'food' ? 'border-green-900 bg-green-50 text-green-900 dark:text-white' : 'border-green-100 dark:border-night-500 text-green-500 dark:text-night-200',
            )}
          >
            🍱 Food
          </button>
        </div>

        {cardType === 'regular' ? (
          <>
            <p className="text-green-700 dark:text-night-100 text-xs font-bold uppercase tracking-wide mb-2">Daily rate (₦)</p>
            <div className="relative mb-2">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-green-500 dark:text-night-200 font-bold">₦</span>
              <input
                type="text"
                inputMode="decimal"
                name="officer-create-card-rate"
                autoComplete="off"
                value={rateNaira}
                onChange={e => setRateNaira(e.target.value.replace(/[^0-9.]/g, ''))}
                placeholder="e.g. 500"
                className="w-full border-2 border-green-200 dark:border-night-500 rounded-xl pl-8 pr-4 py-3 text-sm text-green-900 dark:text-white font-semibold focus:outline-none focus:border-green-500"
              />
            </div>

            {rateNaira && (
              <div className={cn('text-xs font-semibold mb-4', isValid ? 'text-green-600 dark:text-night-200' : 'text-red-500')}>
                {isValid ? 'Looks good' : 'Rate must be a multiple of ₦50'}
              </div>
            )}

            <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-2xl p-3 mb-5">
              <p className="text-amber-700 dark:text-amber-300 text-xs font-semibold">ℹ️ Note</p>
              <p className="text-amber-600 dark:text-amber-300 text-xs mt-0.5 leading-relaxed">
                This is the amount the customer contributes per day on this card.
              </p>
            </div>
          </>
        ) : (
          <div className="bg-green-50 dark:bg-night-600 rounded-2xl p-4 mb-5 border border-green-200 dark:border-night-500">
            <p className="text-green-700 dark:text-night-100 text-sm font-semibold mb-1">🔒 Food Card rules</p>
            <p className="text-green-500 dark:text-night-200 text-xs leading-relaxed">
              Fixed at ₦1,000/day. Funds are locked until December. Complete all contributions by Nov 30 to
              qualify for food distribution.
            </p>
          </div>
        )}

        <button
          onClick={handleSubmit}
          disabled={!isValid || loading}
          className="w-full bg-green-900 text-white font-bold text-sm rounded-full py-4 active:scale-95 transition-all disabled:opacity-40"
        >
          {loading ? 'Creating…' : hasCards ? 'Add card' : 'Create card'}
        </button>
      </motion.div>
    </div>
  )
}

// ── Register customer sheet ───────────────────────────────────────
function RegisterCustomerSheet({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    full_name: '', phone_number: '', bank_name: '', account_number: '',
    account_name: '', next_of_kin_name: '', next_of_kin_phone: '',
  })
  const [loading, setLoading] = useState(false)

  const set = (key: string, val: string) => setForm(f => ({ ...f, [key]: val }))

  const handleRegister = async () => {
    if (!form.full_name || !form.phone_number) {
      toast.error('Full name and phone number are required')
      return
    }
    setLoading(true)
    try {
      await api.post('/users/customers', {
        ...form,
        password:            form.phone_number,
        withdrawal_password: `${form.phone_number}MK`,
        // The backend requires this on every registration (self-signup
        // included) — it was never being sent here at all, which is
        // exactly the "field required" 422 you were hitting. An
        // officer registering a manual cash customer is attesting to
        // this on the customer's behalf, same as they already do for
        // setting up the customer's initial password below.
        accepted_terms: true,
      })
      showFeedback.success('Customer registered', `${form.full_name} has been added to your zone.`)
      qc.invalidateQueries({ queryKey: ['officer-customers'] })
      onClose()
    } catch (err) {
      showFeedback.error('Registration failed', getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  const fields = [
    { key: 'full_name',        label: 'Full name',            placeholder: 'e.g. Emeka Okafor',    icon: UserIcon },
    { key: 'phone_number',     label: 'Phone number',         placeholder: '08012345678',           icon: Phone },
    { key: 'bank_name',        label: 'Bank name',            placeholder: 'e.g. Zenith Bank',      icon: Building2 },
    { key: 'account_number',   label: 'Account number',       placeholder: '10-digit number',       icon: CreditCard },
    { key: 'account_name',     label: 'Account name',         placeholder: 'Name on account',       icon: UserIcon },
    { key: 'next_of_kin_name', label: 'Next of kin name',     placeholder: 'e.g. Ngozi Okafor',     icon: Users },
    { key: 'next_of_kin_phone',label: 'Next of kin phone',    placeholder: '08098765432',           icon: Phone },
  ]

  return (
    <motion.div
      initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
      transition={{ type: 'spring', damping: 18, stiffness: 260, mass: 0.9 }}
      className="fixed inset-0 z-50 bg-white dark:bg-night-700 overflow-y-auto"
    >
      {loading && <PleaseHold message="Please hold while we register your account…" />}

      <div className="sticky top-0 bg-white dark:bg-night-700 flex items-center gap-3 px-5 pt-5 pb-3 border-b border-green-50 z-10">
        <button onClick={onClose} className="w-9 h-9 rounded-full bg-green-50 dark:bg-night-600 flex items-center justify-center">
          <X className="w-4 h-4 text-green-700 dark:text-night-100" />
        </button>
        <div>
          <h2 className="text-green-900 dark:text-white font-extrabold text-lg leading-tight">Register customer</h2>
          <p className="text-green-500 dark:text-night-200 text-xs">Cash-paying customer managed by you</p>
        </div>
      </div>

      <div className="px-5 pt-4 pb-10">
        <div className="space-y-4 mb-6">
          {fields.map(({ key, label, placeholder, icon: Icon }) => (
            <div key={key}>
              <label className="text-green-700 dark:text-night-100 text-xs font-bold uppercase tracking-wide block mb-1.5">{label}</label>
              <div className="relative">
                <Icon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-green-400 dark:text-night-300" />
                <input
                  type={key.includes('phone') ? 'tel' : key === 'account_number' ? 'text' : 'text'}
                  inputMode={key === 'account_number' ? 'numeric' : undefined}
                  name={`register-${key}`}
                  autoComplete="off"
                  value={form[key as keyof typeof form]}
                  onChange={e => set(key, key === 'account_number' ? e.target.value.replace(/[^0-9]/g, '') : e.target.value)}
                  placeholder={placeholder}
                  className="w-full border border-green-200 dark:border-night-500 rounded-xl pl-10 pr-4 py-3 text-sm text-green-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                />
              </div>
            </div>
          ))}
        </div>

        <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-2xl p-3 mb-5">
          <p className="text-amber-700 dark:text-amber-300 text-xs font-semibold">ℹ️ Note</p>
          <p className="text-amber-600 dark:text-amber-300 text-xs mt-0.5 leading-relaxed">
            The customer's default login password will be their phone number. default withdrawal pin will be the same phone number but with MK appended.
            They can change it after their first login.
          </p>
        </div>

        <button
          onClick={handleRegister}
          disabled={loading}
          className="w-full bg-green-900 text-white font-bold text-sm rounded-full py-4 active:scale-95 transition-all disabled:opacity-50"
        >
          {loading ? 'Registering…' : 'Register customer'}
        </button>
      </div>
    </motion.div>
  )
}

// ── Main page ─────────────────────────────────────────────────────
export default function CustomersPage() {
  const navigate  = useNavigate()
  const { user }  = useAuthStore()
  const [search, setSearch]                         = useState('')
  const [showRegisterSheet, setShowRegisterSheet]   = useState(false)

  const { data: customers = [], isLoading } = useQuery({
    queryKey: ['officer-customers'],
    queryFn: async () => {
      const { data } = await api.get<User[]>('/users?role=customer&page_size=100')
      return data
    },
  })

  const filtered = customers.filter(c =>
    c.full_name.toLowerCase().includes(search.toLowerCase()) ||
    c.phone_number.includes(search)
  )

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

      {/* Page title */}
      <div className="px-4 mt-2 mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-green-900 dark:text-white text-2xl font-extrabold">My Customers</h1>
          <p className="text-green-500 dark:text-night-200 text-sm mt-0.5">{customers.length} in your zone</p>
        </div>
        <button
          onClick={() => user?.zone_id ? setShowRegisterSheet(true) : toast.error('You are not assigned to a zone yet. Contact your director before registering customers.')}
          disabled={!user?.zone_id}
          className="flex items-center gap-2 bg-green-900 text-white text-sm font-bold rounded-full px-4 py-2.5 active:scale-95 transition-all shadow-card disabled:opacity-40 disabled:active:scale-100"
        >
          <UserPlus className="w-4 h-4" /> Register
        </button>
      </div>

      {/* Unassigned-zone banner — matches the backend's own rejection
          message, so an officer sees the reason before they even try to
          submit, not just as a failed-request toast afterward. */}
      {!user?.zone_id && (
        <div className="mx-4 mb-4 bg-amber-50 dark:bg-night-600 rounded-2xl px-4 py-3 flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <p className="text-amber-700 dark:text-night-100 text-xs font-semibold">
            You are not assigned to a zone yet. Contact your director — customer registration is disabled until you have one.
          </p>
        </div>
      )}

      {/* Search bar */}
      <div className="px-4 mb-4">
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-green-400 dark:text-night-300" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or phone…"
            className="w-full bg-white dark:bg-night-700 border border-green-200 dark:border-night-500 rounded-2xl pl-10 pr-4 py-3 text-sm text-green-900 dark:text-white placeholder:text-green-300 dark:text-night-300 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent shadow-card"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3.5 top-1/2 -translate-y-1/2">
              <X className="w-4 h-4 text-green-400 dark:text-night-300" />
            </button>
          )}
        </div>
      </div>

      {/* Customer list */}
      <div className="flex-1 overflow-y-auto px-4 pb-safe-nav">
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 p-4 flex gap-3">
                <div className="w-10 h-10 bg-green-100 dark:bg-night-600 rounded-full animate-pulse flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 bg-green-100 dark:bg-night-600 rounded animate-pulse w-2/3" />
                  <div className="h-2 bg-green-50 dark:bg-night-600 rounded animate-pulse w-1/3" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-white dark:bg-night-700 rounded-3xl border border-green-100 dark:border-night-500 shadow-card text-center py-14 px-6">
            <div className="w-16 h-16 bg-green-50 dark:bg-night-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Users className="w-8 h-8 text-green-300 dark:text-night-300" />
            </div>
            <p className="text-green-900 dark:text-white font-bold text-lg">
              {search ? 'No customers found' : 'No customers yet'}
            </p>
            <p className="text-green-400 dark:text-night-300 text-sm mt-1 mb-5">
              {search ? `No results for "${search}"` : 'Register your first cash customer to get started'}
            </p>
            {!search && (
              <button
                onClick={() => user?.zone_id ? setShowRegisterSheet(true) : toast.error('You are not assigned to a zone yet. Contact your director before registering customers.')}
                disabled={!user?.zone_id}
                className="bg-green-900 text-white font-bold text-sm rounded-full px-8 py-3 active:scale-95 transition-all disabled:opacity-40 disabled:active:scale-100"
              >
                Register first customer
              </button>
            )}
          </div>
        ) : (
          <>
            {search && (
              <p className="text-green-400 dark:text-night-300 text-xs mb-3">{filtered.length} result{filtered.length !== 1 ? 's' : ''} for "{search}"</p>
            )}
            {filtered.map(customer => (
              <CustomerCard
                key={customer.id}
                customer={customer}
              />
            ))}
          </>
        )}
      </div>

      <AnimatePresence>
        {showRegisterSheet && (
          <RegisterCustomerSheet onClose={() => setShowRegisterSheet(false)} />
        )}
      </AnimatePresence>
    </div>
  )
}