import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Search, ChevronRight } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Avatar } from '@/components/ui/Avatar'
import type { User } from '@/types'

type CustomerFilter = 'all' | 'regular' | 'food'

export default function AllCustomersPage() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<CustomerFilter>('all')

  const { data: customers = [], isLoading } = useQuery({
    queryKey: ['all-customers', filter],
    queryFn: async () => {
      const cardTypeParam = filter !== 'all' ? `&card_type=${filter}` : ''
      const { data } = await api.get<User[]>(`/users?role=customer&page_size=500${cardTypeParam}`)
      return data
    },
  })

  const filtered = customers.filter(c =>
    c.full_name.toLowerCase().includes(search.toLowerCase()) ||
    c.phone_number.includes(search)
  )

  return (
    <div className="min-h-dvh flex flex-col bg-green-50 dark:bg-night-800">
      <header className="flex items-center gap-3 px-4 py-3 bg-green-50 dark:bg-night-800">
        <button onClick={() => navigate(-1)} className="w-9 h-9 rounded-full bg-white dark:bg-night-700 border border-green-100 dark:border-night-500 flex items-center justify-center">
          <ArrowLeft className="w-4 h-4 text-green-700 dark:text-night-100" />
        </button>
        <h1 className="text-green-900 dark:text-white font-extrabold text-lg">All Customers</h1>
        <span className="ml-auto text-green-500 dark:text-night-200 text-xs font-semibold">{customers.length} total</span>
      </header>

      <div className="px-4 mb-3">
        <div className="relative">
          <Search className="w-4 h-4 text-green-400 dark:text-night-300 absolute left-4 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or phone…"
            className="w-full bg-white dark:bg-night-700 border border-green-200 dark:border-night-500 rounded-2xl pl-11 pr-4 py-3 text-sm text-green-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500"
          />
        </div>
      </div>

      <div className="px-4 mb-4 flex gap-2">
        {([
          { value: 'all', label: 'All' },
          { value: 'regular', label: 'Regular' },
          { value: 'food', label: 'Food' },
        ] as { value: CustomerFilter; label: string }[]).map(opt => (
          <button
            key={opt.value}
            onClick={() => setFilter(opt.value)}
            className={cn(
              'px-4 py-2 rounded-full text-xs font-bold',
              filter === opt.value ? 'bg-green-900 dark:bg-night-100 text-white' : 'bg-white dark:bg-night-700 border border-green-200 dark:border-night-500 text-green-600 dark:text-night-200',
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-safe-nav">
        {isLoading ? (
          <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card px-4">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="flex gap-3 py-3.5 border-b border-green-50 dark:border-night-600 last:border-0">
                <div className="w-10 h-10 bg-green-100 dark:bg-night-600 rounded-full animate-pulse flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 bg-green-100 dark:bg-night-600 rounded animate-pulse w-2/3" />
                  <div className="h-2 bg-green-50 dark:bg-night-600 rounded animate-pulse w-1/3" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card text-center py-12 px-6">
            <p className="text-green-700 dark:text-night-100 font-semibold text-sm">No customers found</p>
          </div>
        ) : (
          <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card px-4">
            {filtered.map(customer => (
              <button
                key={customer.id}
                onClick={() => navigate(`/director/customers/${customer.customer_number}`)}
                className="w-full flex items-center gap-3 py-3.5 border-b border-green-50 dark:border-night-600 last:border-0 active:bg-green-50/50 dark:bg-night-600/50 transition-all text-left"
              >
                <Avatar name={customer.full_name} avatarUrl={customer.avatar_url} size={40} className="text-sm" />
                <div className="flex-1 min-w-0">
                  <p className="text-green-900 dark:text-white text-sm font-semibold truncate">{customer.full_name}</p>
                  <p className="text-green-400 dark:text-night-300 text-xs mt-0.5">{customer.phone_number}</p>
                </div>
                <span className={cn(
                  'text-xs font-bold px-2 py-0.5 rounded-full flex-shrink-0',
                  customer.status === 'active' ? 'bg-green-100 dark:bg-night-600 text-green-700 dark:text-night-100' : 'bg-red-50 dark:bg-red-900 text-red-500 dark:text-red-300',
                )}>
                  {customer.status === 'active' ? 'Active' : customer.status}
                </span>
                <ChevronRight className="w-4 h-4 text-green-300 dark:text-night-300 flex-shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
