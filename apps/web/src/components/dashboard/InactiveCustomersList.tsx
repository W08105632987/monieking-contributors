import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Phone, Megaphone, CheckCircle2, Clock, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { api, getErrorMessage } from '@/lib/api'
import { formatDate, cn } from '@/lib/utils'
import type { InactiveCustomersPage } from '@/types'

const PAGE_SIZE = 20

export function InactiveCustomersList({
  officerId, canCall, canBulkPing,
}: {
  officerId?: string
  canCall: boolean
  canBulkPing: boolean
}) {
  const qc = useQueryClient()
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const { data, isLoading } = useQuery({
    queryKey: ['inactive-customers', officerId ?? 'self-scope', page],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE) })
      if (officerId) params.set('officer_id', officerId)
      const { data } = await api.get<InactiveCustomersPage>(`/customer-stats/inactive-customers?${params}`)
      return data
    },
  })

  const markContactedMutation = useMutation({
    mutationFn: (customerId: string) => api.post(`/customer-stats/mark-contacted/${customerId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inactive-customers'] }),
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const bulkPingMutation = useMutation({
    mutationFn: (customerIds: string[]) => api.post('/customer-stats/bulk-ping', {
      customer_ids: customerIds,
      title: 'Reminder from MonieKing',
      body: "We noticed it's been a while — reach out to your officer or top up your card whenever you're ready.",
    }),
    onSuccess: (res: any) => {
      toast.success(`Pinged ${res.data?.sent ?? selected.size} customer(s)`)
      setSelected(new Set())
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  if (isLoading || !data) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map(i => <div key={i} className="h-14 bg-green-50 dark:bg-night-600 rounded-xl animate-pulse" />)}
      </div>
    )
  }

  if (data.customers.length === 0) {
    return <p className="text-green-400 dark:text-night-300 text-xs text-center py-4">No inactive customers in this scope. 🎉</p>
  }

  const totalPages = Math.max(1, Math.ceil(data.total / data.page_size))

  return (
    <div>
      {canBulkPing && (
        <div className="flex items-center justify-between mb-3">
          <button
            onClick={() => setSelected(new Set(data.customers.map(c => c.id)))}
            className="text-green-600 dark:text-night-200 text-xs font-semibold"
          >
            Select all on page
          </button>
          <button
            onClick={() => bulkPingMutation.mutate(Array.from(selected))}
            disabled={selected.size === 0 || bulkPingMutation.isPending}
            className="flex items-center gap-1.5 bg-amber-400 text-green-900 font-bold text-xs rounded-full px-3.5 py-2 disabled:opacity-40 active:scale-95 transition-all"
          >
            {bulkPingMutation.isPending
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <Megaphone className="w-3.5 h-3.5" />}
            Ping {selected.size > 0 ? `(${selected.size})` : ''}
          </button>
        </div>
      )}

      <div className="space-y-2">
        {data.customers.map(c => (
          <div key={c.id} className="bg-green-50 dark:bg-night-600 rounded-xl px-3 py-2.5">
            <div className="flex items-start gap-2">
              {canBulkPing && (
                <input
                  type="checkbox"
                  checked={selected.has(c.id)}
                  onChange={() => toggle(c.id)}
                  className="mt-1 accent-green-700"
                />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-green-900 dark:text-white text-sm font-semibold truncate">{c.full_name}</p>
                  <p className="text-green-400 dark:text-night-300 text-xs flex-shrink-0">#{c.customer_number}</p>
                </div>
                <p className="text-green-500 dark:text-night-200 text-xs mt-0.5">{c.phone_number}</p>

                <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                  {c.withdrawn_all && (
                    <span className="text-[10px] font-bold text-red-500 bg-red-50 px-2 py-0.5 rounded-full">
                      All withdrawn
                    </span>
                  )}
                  {c.no_recent_contribution && (
                    <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                      No contribution 30+ days
                    </span>
                  )}
                  {c.last_contacted_at && (
                    <span className="text-[10px] font-semibold text-green-600 dark:text-night-200 flex items-center gap-1">
                      <Clock className="w-2.5 h-2.5" /> Contacted {formatDate(c.last_contacted_at)}
                    </span>
                  )}
                </div>
              </div>

              {canCall && (
                <div className="flex flex-col items-center gap-1.5 flex-shrink-0">
                  <a
                    href={`tel:${c.phone_number}`}
                    className="w-8 h-8 rounded-full bg-green-900 dark:bg-night-100 flex items-center justify-center"
                  >
                    <Phone className="w-3.5 h-3.5 text-white dark:text-night-800" />
                  </a>
                  <button
                    onClick={() => markContactedMutation.mutate(c.id)}
                    disabled={markContactedMutation.isPending}
                    title="Mark as contacted"
                    className={cn(
                      'w-8 h-8 rounded-full flex items-center justify-center border-2',
                      c.last_contacted_at ? 'border-green-200 dark:border-night-500 bg-green-50 dark:bg-night-600' : 'border-green-100 dark:border-night-500 bg-white dark:bg-night-700',
                    )}
                  >
                    <CheckCircle2 className={cn('w-3.5 h-3.5', c.last_contacted_at ? 'text-green-600 dark:text-night-200' : 'text-green-300 dark:text-night-400')} />
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-3">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="text-green-600 dark:text-night-200 text-xs font-semibold disabled:opacity-30"
          >
            ← Prev
          </button>
          <p className="text-green-400 dark:text-night-300 text-xs">Page {page} of {totalPages}</p>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="text-green-600 dark:text-night-200 text-xs font-semibold disabled:opacity-30"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  )
}
