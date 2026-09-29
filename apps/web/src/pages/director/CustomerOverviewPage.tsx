import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import { ArrowLeft, Wallet, TrendingUp, TrendingDown, Coins, MoreVertical } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { formatNaira, formatDate, cn } from '@/lib/utils'
import { Avatar } from '@/components/ui/Avatar'
import { ManageMemberSheet } from '@/components/settings/ManageMemberSheet'
import type { CustomerOverview } from '@/types'

export default function CustomerOverviewPage() {
  const { customerId } = useParams()
  const navigate = useNavigate()
  const [managing, setManaging] = useState(false)

  const { data: overview, isLoading } = useQuery({
    queryKey: ['customer-overview', customerId],
    queryFn: async () => {
      const { data } = await api.get<CustomerOverview>(`/users/${customerId}/overview`)
      return data
    },
    enabled: !!customerId,
  })

  if (isLoading || !overview) {
    return (
      <div className="min-h-dvh bg-green-50 dark:bg-night-800 p-4">
        <div className="h-10 bg-green-100 dark:bg-night-600 rounded-xl animate-pulse mb-4 w-24" />
        <div className="h-24 bg-white dark:bg-night-700 rounded-2xl animate-pulse mb-4" />
        <div className="h-40 bg-white dark:bg-night-700 rounded-2xl animate-pulse mb-4" />
        <div className="h-32 bg-white dark:bg-night-700 rounded-2xl animate-pulse" />
      </div>
    )
  }

  const { profile, wallet_balance_kobo, cards } = overview
  const totalContributed = cards.reduce((s, c) => s + c.total_contributed_kobo, 0)
  const totalWithdrawn   = cards.reduce((s, c) => s + c.total_withdrawn_kobo, 0)

  return (
    <div className="min-h-dvh flex flex-col bg-green-50 dark:bg-night-800">
      <header className="flex items-center gap-3 px-4 py-3 bg-green-50 dark:bg-night-800">
        <button onClick={() => navigate(-1)} className="w-9 h-9 rounded-full bg-white dark:bg-night-700 border border-green-100 dark:border-night-500 flex items-center justify-center">
          <ArrowLeft className="w-4 h-4 text-green-700 dark:text-night-100" />
        </button>
        <h1 className="text-green-900 dark:text-white font-extrabold text-lg">Customer detail</h1>
        <button
          onClick={() => setManaging(true)}
          className="ml-auto w-9 h-9 rounded-full bg-white dark:bg-night-700 border border-green-100 dark:border-night-500 flex items-center justify-center"
          aria-label="Manage customer"
        >
          <MoreVertical className="w-4 h-4 text-green-700 dark:text-night-100" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 pb-safe-nav">
        {/* Profile card */}
        <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-5 mb-4 flex items-center gap-4">
          <Avatar name={profile.full_name} avatarUrl={profile.avatar_url} size={56} className="text-lg" />
          <div className="min-w-0">
            <p className="text-green-900 dark:text-white font-extrabold text-base truncate">{profile.full_name}</p>
            <p className="text-green-500 dark:text-night-200 text-sm">{profile.phone_number} · Customer #{profile.customer_number}</p>
            <p className="text-green-400 dark:text-night-300 text-xs mt-0.5">Joined {formatDate(profile.created_at)}</p>
          </div>
          <span className={cn(
            'ml-auto text-xs font-bold px-2.5 py-1 rounded-full flex-shrink-0',
            profile.status === 'active' ? 'bg-green-100 dark:bg-night-600 text-green-700 dark:text-night-100' : 'bg-red-50 dark:bg-red-900 text-red-500 dark:text-red-300',
          )}>
            {profile.status}
          </span>
        </div>

        {/* Financial summary */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <Wallet className="w-4 h-4 text-green-600 dark:text-night-200" />
              <p className="text-green-500 dark:text-night-200 text-xs font-semibold uppercase">Wallet</p>
            </div>
            <p className="text-green-900 dark:text-white text-xl font-extrabold">{formatNaira(wallet_balance_kobo)}</p>
          </div>
          <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <Coins className="w-4 h-4 text-amber-500 dark:text-amber-300" />
              <p className="text-green-500 dark:text-night-200 text-xs font-semibold uppercase">Cards</p>
            </div>
            <p className="text-green-900 dark:text-white text-xl font-extrabold">{cards.length}</p>
          </div>
          <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="w-4 h-4 text-green-600 dark:text-night-200" />
              <p className="text-green-500 dark:text-night-200 text-xs font-semibold uppercase">Contributed</p>
            </div>
            <p className="text-green-900 dark:text-white text-lg font-extrabold">{formatNaira(totalContributed)}</p>
          </div>
          <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <TrendingDown className="w-4 h-4 text-red-400 dark:text-red-300" />
              <p className="text-green-500 dark:text-night-200 text-xs font-semibold uppercase">Withdrawn</p>
            </div>
            <p className="text-green-900 dark:text-white text-lg font-extrabold">{formatNaira(totalWithdrawn)}</p>
          </div>
        </div>

        {/* Cards */}
        <h2 className="text-green-900 dark:text-white font-bold text-base mb-3">Contribution cards</h2>
        {cards.length === 0 ? (
          <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card text-center py-10 px-6">
            <p className="text-green-500 dark:text-night-200 text-sm">No cards opened yet</p>
          </div>
        ) : (
          <div className="space-y-3">
            {cards.map(card => (
              <div key={card.id} className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className={cn(
                    'text-xs font-bold px-2.5 py-1 rounded-full',
                    card.card_type === 'food' ? 'bg-amber-100 dark:bg-amber-500 text-amber-700 dark:text-amber-300' : 'bg-blue-100 text-blue-700',
                  )}>
                    {card.card_type === 'food' ? 'Food Card' : 'Regular Card'}
                  </span>
                  <span className="text-green-500 dark:text-night-200 text-xs">{card.status}</span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center mb-3">
                  <div>
                    <p className="text-green-400 dark:text-night-300 text-xs">Contributed</p>
                    <p className="text-green-900 dark:text-white font-bold text-sm">{formatNaira(card.total_contributed_kobo)}</p>
                  </div>
                  <div>
                    <p className="text-green-400 dark:text-night-300 text-xs">Withdrawn</p>
                    <p className="text-green-900 dark:text-white font-bold text-sm">{formatNaira(card.total_withdrawn_kobo)}</p>
                  </div>
                  <div>
                    <p className="text-green-400 dark:text-night-300 text-xs">Available</p>
                    <p className="text-green-900 dark:text-white font-bold text-sm">{formatNaira(card.available_balance_kobo)}</p>
                  </div>
                </div>
                <div className="h-1.5 bg-green-50 dark:bg-night-600 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-green-600 dark:bg-night-400 rounded-full"
                    style={{ width: `${Math.min(100, (card.total_days_contributed / 372) * 100)}%` }}
                  />
                </div>
                <p className="text-green-400 dark:text-night-300 text-xs mt-1.5">
                  {card.total_days_contributed}/372 days · rate {formatNaira(card.rate_kobo)}/day
                </p>

                {card.withdrawal_history.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-green-50 dark:border-night-600">
                    <p className="text-green-500 dark:text-night-200 text-xs font-bold uppercase mb-2">Withdrawal history</p>
                    {card.withdrawal_history.map(w => (
                      <div key={w.id} className="flex items-center justify-between text-xs py-1">
                        <span className="text-green-600 dark:text-night-200">{formatDate(w.requested_at)} · {w.status}</span>
                        <span className="text-green-900 dark:text-white font-semibold">{formatNaira(w.net_payable_kobo)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <AnimatePresence>
        {managing && (
          <ManageMemberSheet
            member={profile}
            onClose={() => setManaging(false)}
            invalidateKeys={[['customer-overview', customerId ?? ''], ['all-customers']]}
            onDeleted={() => navigate('/director/customers', { replace: true })}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
