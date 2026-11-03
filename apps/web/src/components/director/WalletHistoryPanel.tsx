import { useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { ArrowDownLeft, ArrowUpRight, Landmark, UserCog, Wallet } from 'lucide-react'
import { api } from '@/lib/api'
import { cn, formatNaira, formatDateTime } from '@/lib/utils'

interface Item { id: string; type: 'credit' | 'debit'; category: string; amount_kobo: number; balance_after_kobo: number; reference: string; description: string | null; created_at: string; manual: boolean; by: string | null; by_role: string | null; source: string }
interface Res { balance_kobo: number; total_funded_kobo: number; manual_funded_kobo: number; total: number; items: Item[] }
const PAGE = 30

/** A customer's wallet story for the director: how it was funded (bank transfer or by which director) and every other transaction. */
export function WalletHistoryPanel({ customerId }: { customerId: string }) {
  const [kind, setKind] = useState<'funding' | 'all'>('funding')
  const q = useInfiniteQuery({
    queryKey: ['wallet-history', customerId, kind],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => (await api.get<Res>(`/director-customers/${customerId}/wallet-history`, { params: { kind, limit: PAGE, offset: pageParam } })).data,
    getNextPageParam: (last, all) => { const n = all.reduce((a, p) => a + p.items.length, 0); return n < last.total ? n : undefined },
  })
  const first = q.data?.pages[0]
  const items = q.data?.pages.flatMap((p) => p.items) ?? []
  return (
    <section id="wallet" className="mb-4 rounded-2xl border border-green-100 bg-white p-4 shadow-card dark:border-night-500 dark:bg-night-700">
      <div className="mb-3 flex items-center gap-2"><Wallet className="h-4 w-4 text-green-600 dark:text-night-200" /><p className="text-xs font-bold uppercase tracking-widest text-green-500 dark:text-night-200">Wallet history</p></div>
      {first && (
        <div className="mb-3 grid grid-cols-3 gap-2 text-center">
          {[['Balance', first.balance_kobo], ['Total funded', first.total_funded_kobo], ['Funded by directors', first.manual_funded_kobo]].map(([l, v]) => (
            <div key={l as string} className="rounded-xl bg-green-50 p-2 dark:bg-night-600"><p className="text-[10px] font-bold uppercase text-green-500 dark:text-night-300">{l as string}</p><p className="text-sm font-extrabold text-green-900 dark:text-white">{formatNaira(v as number)}</p></div>
          ))}
        </div>
      )}
      <div className="mb-2 flex gap-2">
        {([['funding', 'Funding'], ['all', 'All transactions']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setKind(k)} className={cn('rounded-full px-3.5 py-1.5 text-xs font-bold', kind === k ? 'bg-green-900 text-white dark:bg-night-100 dark:text-night-900' : 'border border-green-200 text-green-600 dark:border-night-500 dark:text-night-200')}>{l}</button>
        ))}
      </div>
      {q.isLoading && <div className="h-20 animate-pulse rounded-xl bg-green-50 dark:bg-night-600" />}
      {q.isError && <p className="py-4 text-center text-sm text-red-600">Could not load. <button className="font-bold underline" onClick={() => q.refetch()}>Try again</button></p>}
      {!q.isLoading && !q.isError && items.length === 0 && <p className="py-6 text-center text-sm text-green-500 dark:text-night-300">{kind === 'funding' ? 'This wallet has never been funded.' : 'No transactions yet.'}</p>}
      <ul className="divide-y divide-green-50 dark:divide-night-600">
        {items.map((t) => (
          <li key={t.id} className="flex items-start gap-3 py-2.5">
            <span className={cn('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full', t.type === 'credit' ? 'bg-green-100 text-green-700' : 'bg-red-50 text-red-500')}>
              {t.type === 'credit' ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-green-900 dark:text-white">{t.source}{t.by && <span className="font-semibold text-green-600 dark:text-night-200"> · by {t.by}</span>}</p>
              <p className="truncate text-xs text-green-500 dark:text-night-300">{t.description ?? t.reference}</p>
              <p className="mt-0.5 flex items-center gap-1 text-[11px] text-green-400 dark:text-night-300">
                {t.manual ? <UserCog className="h-3 w-3" /> : <Landmark className="h-3 w-3" />}{formatDateTime(t.created_at)} · balance {formatNaira(t.balance_after_kobo)}
              </p>
              <p className="font-mono text-[10px] text-green-300 dark:text-night-400">{t.reference}</p>
            </div>
            <p className={cn('shrink-0 text-sm font-extrabold', t.type === 'credit' ? 'text-green-700 dark:text-green-300' : 'text-red-500')}>{t.type === 'credit' ? '+' : '−'}{formatNaira(t.amount_kobo)}</p>
          </li>
        ))}
      </ul>
      {q.hasNextPage && <button disabled={q.isFetchingNextPage} onClick={() => q.fetchNextPage()} className="mt-2 w-full rounded-full border border-green-200 py-2.5 text-xs font-bold text-green-700 dark:border-night-500 dark:text-night-100">{q.isFetchingNextPage ? 'Loading…' : 'Show more'}</button>}
    </section>
  )
}
