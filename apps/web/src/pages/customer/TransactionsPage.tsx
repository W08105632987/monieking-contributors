import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowLeft, ArrowDownLeft, ArrowUpRight, Wallet, X, Clock, ChevronDown, Calendar } from 'lucide-react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { formatNaira, formatDateTime, timeAgo, groupByDateBucket, cn } from '@/lib/utils'
import type { WalletTransaction, PaginatedResponse } from '@/types'
import { FallbackError } from '@/components/ui/FallbackError'
import { DisputeModal } from '@/components/disputes/DisputeModal'

const TX_CATEGORY_LABEL: Record<string, string> = {
  wallet_funding:       'Wallet funded',
  contribution:         'Contribution',
  withdrawal:           'Withdrawal',
  charge:               'Withdrawal charge',
  officer_contribution: 'Cash contribution',
  reversal:             'Reversal',
}

type Filter = 'all' | 'credit' | 'debit'

function TxItem({ tx, onClick }: { tx: WalletTransaction; onClick: () => void }) {
  const isCredit = tx.type === 'credit'
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 py-3.5 border-b border-green-50 dark:border-night-600 last:border-0 text-left active:bg-green-50/60 dark:active:bg-white/5 transition-colors -mx-1 px-1 rounded-xl"
    >
      <div className={cn(
        'w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0',
        isCredit ? 'bg-green-100 dark:bg-night-600' : 'bg-red-50 dark:bg-red-900/20',
      )}>
        {isCredit
          ? <ArrowDownLeft className="w-5 h-5 text-green-600 dark:text-night-200" />
          : <ArrowUpRight  className="w-5 h-5 text-red-400 dark:text-red-300" />
        }
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-green-900 dark:text-white text-sm font-semibold truncate">
          {TX_CATEGORY_LABEL[tx.category] ?? tx.category}
        </p>
        <p className="text-green-400 dark:text-night-300 text-xs mt-0.5 truncate flex items-center gap-1">
          <Clock className="w-3 h-3 flex-shrink-0" /> {timeAgo(tx.created_at)}
        </p>
      </div>
      <div className="text-right flex-shrink-0 flex items-center gap-2">
        <div>
          <p className={cn('text-sm font-bold', isCredit ? 'text-green-600 dark:text-night-200' : 'text-red-400 dark:text-red-300')}>
            {isCredit ? '+' : '-'}{formatNaira(tx.amount_kobo)}
          </p>
          <p className="text-green-300 dark:text-night-300 text-xs mt-0.5">{formatDateTime(tx.created_at).split(',')[0]}</p>
        </div>
      </div>
    </button>
  )
}

function TxDetailSheet({ tx, onClose }: { tx: WalletTransaction; onClose: () => void }) {
  const [showDispute, setShowDispute] = useState(false)
  const isCredit = tx.type === 'credit'
  const rows = [
    { label: 'Status',        value: 'Successful' },
    { label: 'Reference',     value: tx.reference, mono: true },
    { label: 'Date & time',   value: formatDateTime(tx.created_at) },
    { label: 'Balance after', value: formatNaira(tx.balance_after_kobo) },
    ...(tx.description ? [{ label: 'Description', value: tx.description }] : []),
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-green-950/60 backdrop-blur-sm" />
      <motion.div
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 22, stiffness: 260, mass: 0.9 }}
        className="relative bg-white dark:bg-night-700 rounded-t-3xl w-full max-w-lg p-6 pb-10 max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-green-200 dark:bg-night-500 rounded-full mx-auto mb-5" />
        <button onClick={onClose} className="absolute top-5 right-5 w-8 h-8 rounded-full bg-green-50 dark:bg-night-600 flex items-center justify-center">
          <X className="w-4 h-4 text-green-700 dark:text-night-100" />
        </button>

        <div className="flex flex-col items-center text-center mb-6 pt-2">
          <div className={cn(
            'w-14 h-14 rounded-2xl flex items-center justify-center mb-3',
            isCredit ? 'bg-green-100 dark:bg-night-600' : 'bg-red-50 dark:bg-red-900/20',
          )}>
            {isCredit
              ? <ArrowDownLeft className="w-6 h-6 text-green-600 dark:text-night-200" />
              : <ArrowUpRight  className="w-6 h-6 text-red-400 dark:text-red-300" />
            }
          </div>
          <p className={cn('text-3xl font-extrabold tracking-tight', isCredit ? 'text-green-700 dark:text-night-100' : 'text-red-500')}>
            {isCredit ? '+' : '-'}{formatNaira(tx.amount_kobo)}
          </p>
          <p className="text-green-500 dark:text-night-200 text-sm font-semibold mt-1">
            {TX_CATEGORY_LABEL[tx.category] ?? tx.category}
          </p>
        </div>

        <div className="bg-green-50 dark:bg-night-600 rounded-2xl p-4 space-y-3">
          {rows.map(row => (
            <div key={row.label} className="flex items-start justify-between gap-3">
              <span className="text-green-500 dark:text-night-200 text-xs font-semibold uppercase tracking-wide pt-0.5 shrink-0">{row.label}</span>
              <span className={cn('text-green-900 dark:text-white text-sm font-semibold text-right min-w-0 break-words', row.mono && 'font-mono text-xs break-all')}>
                {row.value}
              </span>
            </div>
          ))}
        </div>

        <button
          onClick={() => setShowDispute(true)}
          className="w-full mt-4 text-red-400 dark:text-red-300 font-bold text-sm py-3 rounded-xl border-2 border-red-100 dark:border-red-900/40 active:scale-95 transition-all"
        >
          Dispute this transaction
        </button>
      </motion.div>

      {showDispute && (
        <DisputeModal entityType="wallet_transaction" entityId={tx.id} onClose={() => setShowDispute(false)} />
      )}
    </div>
  )
}

export default function TransactionsPage() {
  const navigate = useNavigate()
  const [filter, setFilter] = useState<Filter>('all')
  const [selectedTx, setSelectedTx] = useState<WalletTransaction | null>(null)
  const [showDateFilter, setShowDateFilter] = useState(false)
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  const { data, isLoading, isError, refetch, isFetching, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    // startDate/endDate in the key so picking a new range starts a fresh
    // paginated fetch rather than mixing pages from two different filters.
    queryKey: ['wallet-transactions-full', startDate, endDate],
    queryFn: async ({ pageParam = 1 }) => {
      const { data } = await api.get<PaginatedResponse<WalletTransaction>>(
        '/wallets/me/transactions', {
          params: {
            page: pageParam,
            page_size: 20,
            ...(startDate ? { start_date: startDate } : {}),
            ...(endDate ? { end_date: endDate } : {}),
          },
        }
      )
      return data
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage) => lastPage.has_next ? lastPage.page + 1 : undefined,
  })

  const allTransactions = data?.pages.flatMap(p => p.data) ?? []
  const filtered = allTransactions.filter(tx => {
    if (filter === 'all')    return true
    if (filter === 'credit') return tx.type === 'credit'
    return tx.type === 'debit'
  })
  const grouped = groupByDateBucket(filtered, tx => tx.created_at)

  return (
    <div className="min-h-dvh flex flex-col bg-green-50 dark:bg-night-800">
      <header className="flex items-center gap-3 px-4 py-3 bg-green-50 dark:bg-night-800">
        <button onClick={() => navigate(-1)} className="w-9 h-9 bg-white dark:bg-night-700 border border-green-200 dark:border-night-500 rounded-xl flex items-center justify-center active:scale-95 transition-all">
          <ArrowLeft className="w-5 h-5 text-green-700 dark:text-night-100" />
        </button>
        <h1 className="text-green-900 dark:text-white font-extrabold text-lg">All transactions</h1>
      </header>

      <div className="flex-1 overflow-y-auto px-4 pb-10">
        <div className="flex gap-2 mb-4">
          {(['all', 'credit', 'debit'] as Filter[]).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                'px-4 py-1.5 rounded-full text-xs font-bold transition-all',
                filter === f ? 'bg-green-900 dark:bg-night-100 text-white dark:text-night-900' : 'bg-green-100 dark:bg-night-600 text-green-600 dark:text-night-200'
              )}
            >
              {f === 'all' ? 'All' : f === 'credit' ? 'Money in' : 'Money out'}
            </button>
          ))}
          <button
            onClick={() => setShowDateFilter((v) => !v)}
            className={cn(
              'flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-bold transition-all',
              startDate || endDate
                ? 'bg-green-900 dark:bg-night-100 text-white dark:text-night-900'
                : 'bg-green-100 dark:bg-night-600 text-green-600 dark:text-night-200'
            )}
          >
            <Calendar className="w-3.5 h-3.5" /> Date
          </button>
        </div>

        {showDateFilter && (
          <div className="flex items-center gap-2 mb-4">
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              max={endDate || undefined}
              className="flex-1 bg-white dark:bg-night-700 border border-green-100 dark:border-night-500 rounded-xl px-3 py-2 text-xs font-semibold text-green-900 dark:text-white"
            />
            <span className="text-green-400 dark:text-night-300 text-xs">to</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              min={startDate || undefined}
              className="flex-1 bg-white dark:bg-night-700 border border-green-100 dark:border-night-500 rounded-xl px-3 py-2 text-xs font-semibold text-green-900 dark:text-white"
            />
            {(startDate || endDate) && (
              <button
                onClick={() => { setStartDate(''); setEndDate('') }}
                className="text-red-500 text-xs font-bold shrink-0"
              >
                Clear
              </button>
            )}
          </div>
        )}

        <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card px-4">
          {isError ? (
            <FallbackError
              title="Couldn't load your transactions"
              onRetry={() => refetch()}
              isRetrying={isFetching}
            />
          ) : isLoading ? (
            <div className="space-y-3 py-4">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="flex gap-3">
                  <div className="w-10 h-10 bg-green-100 dark:bg-night-600 rounded-2xl animate-pulse" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 bg-green-100 dark:bg-night-600 rounded animate-pulse w-2/3" />
                    <div className="h-2 bg-green-50 dark:bg-night-600 rounded animate-pulse w-1/3" />
                  </div>
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12">
              <Wallet className="w-10 h-10 text-green-200 dark:text-night-400 mx-auto mb-3" />
              <p className="text-green-700 dark:text-night-100 font-semibold text-sm">No transactions found</p>
            </div>
          ) : (
            grouped.map(group => (
              <div key={group.label}>
                <p className="text-green-400 dark:text-night-300 text-xs font-bold uppercase tracking-wide pt-4 pb-1">
                  {group.label}
                </p>
                {group.items.map(tx => (
                  <TxItem key={tx.id} tx={tx} onClick={() => setSelectedTx(tx)} />
                ))}
              </div>
            ))
          )}
        </div>

        {hasNextPage && (
          <button
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
            className="w-full flex items-center justify-center gap-1.5 text-green-700 dark:text-night-100 text-sm font-bold py-4 disabled:opacity-50"
          >
            {isFetchingNextPage ? 'Loading…' : <>Load more <ChevronDown className="w-4 h-4" /></>}
          </button>
        )}
      </div>

      <AnimatePresence>
        {selectedTx && <TxDetailSheet tx={selectedTx} onClose={() => setSelectedTx(null)} />}
      </AnimatePresence>
    </div>
  )
}