import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Search, ChevronRight } from 'lucide-react'
import { api } from '@/lib/api'
import { formatDate, cn } from '@/lib/utils'
import type { CustomerListPage } from '@/types'

const PAGE_SIZE = 25

const STATUS_TINT: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  suspended: 'bg-red-50 text-red-500',
  pending_verification: 'bg-amber-50 text-amber-600',
}

export default function CustomersPage() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ['crm-customers', query, page],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE) })
      if (query.trim()) params.set('q', query.trim())
      return (await api.get<CustomerListPage>(`/admin/crm/customers?${params}`)).data
    },
  })

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1

  return (
    <div>
      <h1 className="text-green-900 dark:text-white font-extrabold text-2xl mb-1">Customers</h1>
      <p className="text-green-500 dark:text-night-200 text-sm mb-6">Search by name, phone, or customer number</p>

      <div className="relative mb-5 max-w-md">
        <Search className="w-4 h-4 text-green-400 dark:text-night-300 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          value={query}
          onChange={e => { setQuery(e.target.value); setPage(1) }}
          placeholder="Search customers…"
          className="w-full bg-white dark:bg-night-700 border border-green-200 dark:border-night-500 rounded-xl pl-10 pr-3 py-2.5 text-sm text-green-900 dark:text-white focus:outline-none focus:border-green-500"
        />
      </div>

      <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-green-100 dark:border-night-500 text-left">
              <th className="px-5 py-3 text-green-500 dark:text-night-200 text-xs font-semibold uppercase tracking-wide">#</th>
              <th className="px-5 py-3 text-green-500 dark:text-night-200 text-xs font-semibold uppercase tracking-wide">Name</th>
              <th className="px-5 py-3 text-green-500 dark:text-night-200 text-xs font-semibold uppercase tracking-wide">Phone</th>
              <th className="px-5 py-3 text-green-500 dark:text-night-200 text-xs font-semibold uppercase tracking-wide">Status</th>
              <th className="px-5 py-3 text-green-500 dark:text-night-200 text-xs font-semibold uppercase tracking-wide">Joined</th>
              <th className="px-5 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              [1, 2, 3, 4, 5].map(i => (
                <tr key={i} className="border-b border-green-50 dark:border-night-600">
                  <td colSpan={6} className="px-5 py-4"><div className="h-4 bg-green-50 dark:bg-night-600 rounded animate-pulse" /></td>
                </tr>
              ))
            )}
            {!isLoading && data?.customers.length === 0 && (
              <tr><td colSpan={6} className="px-5 py-8 text-center text-green-400 dark:text-night-300 text-sm">No customers found.</td></tr>
            )}
            {!isLoading && data?.customers.map(c => (
              <tr
                key={c.id}
                onClick={() => navigate(`/customers/${c.id}`)}
                className="border-b border-green-50 dark:border-night-600 last:border-0 hover:bg-green-50/60 dark:hover:bg-night-600/60 cursor-pointer transition-colors"
              >
                <td className="px-5 py-3 text-green-400 dark:text-night-300">#{c.customer_number}</td>
                <td className="px-5 py-3 text-green-900 dark:text-white font-semibold">{c.full_name}</td>
                <td className="px-5 py-3 text-green-600 dark:text-night-200">{c.phone_number}</td>
                <td className="px-5 py-3">
                  <span className={cn('text-[11px] font-bold px-2 py-0.5 rounded-full', STATUS_TINT[c.status] ?? 'bg-green-50 text-green-600')}>
                    {c.status.replace('_', ' ')}
                  </span>
                </td>
                <td className="px-5 py-3 text-green-500 dark:text-night-200">{formatDate(c.created_at)}</td>
                <td className="px-5 py-3 text-right"><ChevronRight className="w-4 h-4 text-green-300 dark:text-night-400 inline-block" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data && totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
            className="text-green-600 dark:text-night-200 text-xs font-semibold disabled:opacity-30">← Prev</button>
          <p className="text-green-400 dark:text-night-300 text-xs">Page {page} of {totalPages} · {data.total} customers</p>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
            className="text-green-600 dark:text-night-200 text-xs font-semibold disabled:opacity-30">Next →</button>
        </div>
      )}
    </div>
  )
}
