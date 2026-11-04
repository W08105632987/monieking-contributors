import { useMemo, useState } from 'react'
import toast from '@/lib/notify'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Search, ChevronRight, Wallet, Check, ArrowRightLeft } from 'lucide-react'
import { StatusTag } from '@/components/ui/StatusTag'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, getErrorMessage } from '@/lib/api'
import { MoveSheet } from '@/components/director/ZoneCustomersOverview'
import { cn } from '@/lib/utils'
import { Avatar } from '@/components/ui/Avatar'
import type { User } from '@/types'

type CustomerFilter = 'all' | 'regular' | 'food'
type StatusFilter = 'any' | 'active' | 'pending_verification' | 'suspended' | 'no_zone'
type SortKey = 'az' | 'newest' | 'oldest'

export default function AllCustomersPage() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<CustomerFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('any')
  const [sort, setSort] = useState<SortKey>('az')
  const qc = useQueryClient()
  const [selecting, setSelecting] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [moving, setMoving] = useState(false)
  const toggle = (id: string) => setPicked(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const move = useMutation({
    mutationFn: (b: { zone_id: string; clear_commission: boolean }) => api.post('/director-zones/customers/move', { customer_ids: [...picked], ...b }),
    onSuccess: (r: any) => {
      toast.success(`${r.data.moved} customer(s) moved to ${r.data.zone_name}`)
      setMoving(false); setSelecting(false); setPicked(new Set())
      qc.invalidateQueries({ queryKey: ['all-customers'] })
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const { data: customers = [], isLoading } = useQuery({
    queryKey: ['all-customers', filter],
    queryFn: async () => {
      const cardTypeParam = filter !== 'all' ? `&card_type=${filter}` : ''
      const { data } = await api.get<User[]>(`/users?role=customer&page_size=500${cardTypeParam}`)
      return data
    },
  })

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = customers.filter(c =>
      (statusFilter === 'any' || (statusFilter === 'no_zone' ? !c.zone_id : c.status === statusFilter)) &&
      (!q || c.full_name.toLowerCase().includes(q) || c.phone_number.includes(search.trim())),
    )
    return [...list].sort((a, b) => {
      if (sort === 'az') return a.full_name.localeCompare(b.full_name, undefined, { sensitivity: 'base' })
      const diff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      return sort === 'newest' ? -diff : diff
    })
  }, [customers, search, statusFilter, sort])

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


      <div className="px-4 mb-3 flex gap-2 overflow-x-auto no-scrollbar">
        {([
          { value: 'any', label: 'Any status' },
          { value: 'active', label: 'Active' },
          { value: 'pending_verification', label: 'Pending verification' },
          { value: 'suspended', label: 'Suspended' },
          { value: 'no_zone', label: 'No zone' },
        ] as { value: StatusFilter; label: string }[]).map(opt => (
          <button
            key={opt.value}
            onClick={() => setStatusFilter(opt.value)}
            className={cn(
              'flex-shrink-0 whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-bold',
              statusFilter === opt.value ? 'bg-green-900 dark:bg-night-100 text-white dark:text-night-900' : 'bg-white dark:bg-night-700 border border-green-200 dark:border-night-500 text-green-600 dark:text-night-200',
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div className="px-4 mb-4 flex items-center gap-2">
        <label htmlFor="customer-sort" className="text-xs font-semibold text-green-500 dark:text-night-200">Sort</label>
        <select
          id="customer-sort"
          value={sort}
          onChange={e => setSort(e.target.value as SortKey)}
          className="rounded-full border border-green-200 bg-white px-3 py-1.5 text-xs font-bold text-green-700 dark:border-night-500 dark:bg-night-700 dark:text-night-100"
        >
          <option value="az">A–Z</option>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
        </select>
        <span className="text-xs text-green-500 dark:text-night-200">{filtered.length} shown</span>
        <button
          onClick={() => { setSelecting(v => !v); setPicked(new Set()) }}
          className={cn('ml-auto rounded-full px-3 py-1.5 text-xs font-bold', selecting ? 'bg-amber-400 text-green-950' : 'border border-green-200 bg-white text-green-700 dark:border-night-500 dark:bg-night-700 dark:text-night-100')}
        >{selecting ? 'Cancel' : 'Select'}</button>
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
                onClick={() => selecting ? toggle(customer.id) : navigate(`/director/customers/${customer.customer_number}`)}
                className="w-full flex items-center gap-3 py-3.5 border-b border-green-50 dark:border-night-600 last:border-0 active:bg-green-50/50 dark:bg-night-600/50 transition-all text-left"
              >
                {selecting && (
                  <span className={cn('flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border-2', picked.has(customer.id) ? 'border-green-700 bg-green-700 text-white' : 'border-green-300 dark:border-night-400')}>
                    {picked.has(customer.id) && <Check className="h-3.5 w-3.5" />}
                  </span>
                )}
                <Avatar name={customer.full_name} avatarUrl={customer.avatar_url} size={40} className="text-sm" />
                <div className="flex-1 min-w-0">
                  <p className="text-green-900 dark:text-white text-sm font-semibold truncate">{customer.full_name}</p>
                  <p className="text-green-400 dark:text-night-300 text-xs mt-0.5">{customer.phone_number}{!customer.zone_id && ' · no zone'}</p>
                </div>
                <StatusTag status={customer.status} />
                <span role="button" aria-label={`Wallet history of ${customer.full_name}`} title="Wallet funding history"
                  onClick={(e) => { e.stopPropagation(); navigate(`/director/customers/${customer.customer_number}/wallet`) }}
                  className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-300"><Wallet className="h-4 w-4" /></span>
                <ChevronRight className="w-4 h-4 text-green-300 dark:text-night-300 flex-shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>
      {selecting && picked.size > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-safe-nav">
          <button onClick={() => setMoving(true)} className="flex items-center gap-2 rounded-full bg-amber-400 px-5 py-3 text-sm font-extrabold text-green-950 shadow-lg">
            <ArrowRightLeft className="h-4 w-4" /> Move {picked.size} to a zone
          </button>
        </div>
      )}
      {moving && (
        <MoveSheet count={picked.size} currentZoneId={null} affiliated={false} busy={move.isPending}
          onClose={() => setMoving(false)} onMove={(zone_id, clear_commission) => move.mutate({ zone_id, clear_commission })} />
      )}
    </div>
  )
}
