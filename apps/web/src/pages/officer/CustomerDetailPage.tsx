import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import {
  ArrowLeft, Building2, CreditCard, Phone, Users, Plus,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { formatNaira, initials } from '@/lib/utils'
import type { User, ContributionCard } from '@/types'
import { PostContributionSheet, CreateCardSheet } from './CustomersPage'

export default function CustomerDetailPage() {
  const navigate = useNavigate()
  const { customerId } = useParams<{ customerId: string }>()
  const [showContribute, setShowContribute] = useState(false)
  const [showCardSheet, setShowCardSheet]   = useState(false)

  const { data: customer, isLoading: customerLoading } = useQuery({
    queryKey: ['customer', customerId],
    queryFn: async () => {
      const { data } = await api.get<User>(`/users/${customerId}`)
      return data
    },
    enabled: !!customerId,
    retry: false,
  })

  const { data: cards = [], isLoading: cardsLoading } = useQuery({
    queryKey: ['customer-cards', customer?.id],
    queryFn: async () => {
      const { data } = await api.get<ContributionCard[]>(`/cards?owner_id=${customer!.id}`)
      return data.filter(c => c.status === 'active')
    },
    enabled: !!customer?.id,
  })
  const hasCards = cards.length > 0

  if (customerLoading) {
    return (
      <div className="min-h-dvh bg-green-50 p-4">
        <div className="h-10 bg-green-100 dark:bg-night-600 rounded-xl animate-pulse mb-4 w-24" />
        <div className="h-24 bg-white dark:bg-night-700 rounded-2xl animate-pulse mb-4" />
        <div className="h-40 bg-white dark:bg-night-700 rounded-2xl animate-pulse" />
      </div>
    )
  }

  if (!customer) {
    return (
      <div className="min-h-dvh bg-green-50 flex flex-col items-center justify-center px-6 text-center">
        <Users className="w-10 h-10 text-green-200 dark:text-night-400 mb-3" />
        <p className="text-green-900 dark:text-white font-bold text-lg">Customer not found</p>
        <p className="text-green-400 dark:text-night-300 text-sm mt-1 mb-5">This customer may not be in your zone.</p>
        <button
          onClick={() => navigate('/officer/customers')}
          className="bg-green-900 text-white font-bold text-sm rounded-full px-6 py-2.5 active:scale-95 transition-all"
        >
          Back to customers
        </button>
      </div>
    )
  }

  return (
    <div className="min-h-dvh flex flex-col bg-green-50 dark:bg-night-800">
      {/* Top bar */}
      <header className="flex items-center gap-3 px-4 py-3">
        <button
          onClick={() => navigate('/officer/customers')}
          className="w-9 h-9 rounded-full bg-white dark:bg-night-700 shadow-card flex items-center justify-center"
        >
          <ArrowLeft className="w-4 h-4 text-green-700 dark:text-night-100" />
        </button>
        <h1 className="text-green-900 dark:text-white font-extrabold text-lg">Customer details</h1>
      </header>

      {/* Customer header card */}
      <div className="flex-1 overflow-y-auto px-4 pb-10">
        <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-4 mb-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-12 h-12 rounded-full bg-green-900 flex items-center justify-center font-bold text-amber-400 text-base flex-shrink-0">
              {initials(customer.full_name)}
            </div>
            <div className="min-w-0">
              <p className="text-green-900 dark:text-white font-bold text-base truncate">{customer.full_name}</p>
              <p className="text-green-400 dark:text-night-300 text-xs flex items-center gap-1 mt-0.5">
                <Phone className="w-3 h-3" /> {customer.phone_number} · Customer #{customer.customer_number}
              </p>
            </div>
          </div>
          <div className="space-y-1.5">
            {customer.bank_name && (
              <div className="flex items-center gap-2">
                <Building2 className="w-3.5 h-3.5 text-green-400 dark:text-night-300 flex-shrink-0" />
                <span className="text-green-600 dark:text-night-200 text-xs">{customer.bank_name}</span>
              </div>
            )}
            {customer.account_number && (
              <div className="flex items-center gap-2">
                <CreditCard className="w-3.5 h-3.5 text-green-400 dark:text-night-300 flex-shrink-0" />
                <span className="text-green-600 dark:text-night-200 text-xs">{customer.account_number} · {customer.account_name}</span>
              </div>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setShowCardSheet(true)}
            className="flex-1 min-w-0 flex items-center justify-center gap-1.5 border-2 border-green-200 dark:border-night-500 text-green-700 dark:text-night-100 text-xs font-bold rounded-full py-2.5 active:scale-95 transition-all"
          >
            <CreditCard className="w-3.5 h-3.5 shrink-0" /> {hasCards ? 'Add card' : 'Create card'}
          </button>
          <button
            onClick={() => setShowContribute(true)}
            className="flex-1 min-w-0 flex items-center justify-center gap-1.5 bg-green-900 text-white text-xs font-bold rounded-full py-2.5 active:scale-95 transition-all"
          >
            <Plus className="w-3.5 h-3.5 shrink-0" /> Post contribution
          </button>
        </div>

        {/* Cards list */}
        <p className="text-green-700 dark:text-night-100 text-xs font-bold uppercase tracking-wide mb-2">Cards</p>
        {cardsLoading ? (
          <div className="space-y-2">
            {[1, 2].map(i => <div key={i} className="h-16 bg-white dark:bg-night-700 rounded-2xl animate-pulse" />)}
          </div>
        ) : cards.length === 0 ? (
          <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card text-center py-8 px-4">
            <p className="text-green-500 dark:text-night-200 text-sm">No active cards yet</p>
          </div>
        ) : (
          <div className="space-y-2">
            {cards.map(card => (
              <button
                key={card.id}
                onClick={() => navigate(`/officer/customers/${customerId}/cards/${card.card_number}`)}
                className="w-full bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-4 flex items-center justify-between text-left active:scale-[0.99] transition-all"
              >
                <div>
                  <p className="text-green-900 dark:text-white text-sm font-semibold">
                    {card.card_type === 'food' ? '🍱 Food' : '📋 Regular'} · {formatNaira(card.rate_kobo)}/day
                  </p>
                  <p className="text-green-400 dark:text-night-300 text-xs mt-0.5">
                    {card.total_days_contributed} days · {formatNaira(card.total_contributed_kobo)} contributed
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <AnimatePresence>
        {showContribute && (
          <PostContributionSheet
            customer={customer}
            onClose={() => setShowContribute(false)}
          />
        )}
        {showCardSheet && (
          <CreateCardSheet
            customer={customer}
            hasCards={hasCards}
            onClose={() => setShowCardSheet(false)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}