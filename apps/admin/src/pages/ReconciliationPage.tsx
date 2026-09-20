import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Download } from 'lucide-react'
import { api } from '@/lib/api'
import { formatNaira, formatDateTime, cn } from '@/lib/utils'
import type { WalletTransactionsPage, ReconciliationFlag } from '@/types'

const CATEGORIES = ['wallet_funding', 'contribution', 'withdrawal', 'charge', 'officer_contribution', 'reversal']

function exportLedgerCsv(transactions: WalletTransactionsPage['transactions']) {
  // Exports the current page only — a true "export everything matching
  // this filter" would need a dedicated backend endpoint that streams
  // every page rather than the 50 currently loaded; noted as a
  // follow-up rather than silently truncating without saying so.
  const rows = [
    ['When', 'Customer', 'Customer #', 'Category', 'Type', 'Amount (₦)', 'Balance after (₦)', 'Reference'],
    ...transactions.map(tx => [
      tx.created_at, tx.owner_name, String(tx.owner_customer_number), tx.category, tx.type,
      String(tx.amount_kobo / 100), String(tx.balance_after_kobo / 100), tx.reference,
    ]),
  ]
  const csv = rows.map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `wallet-ledger-page.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export default function ReconciliationPage() {
  const [tab, setTab] = useState<'ledger' | 'flags'>('flags')
  const [category, setCategory] = useState('')
  const [txType, setTxType] = useState('')
  const [page, setPage] = useState(1)

  const { data: flags, isLoading: flagsLoading } = useQuery({
    queryKey: ['crm-reconciliation-flags'],
    queryFn: async () => (await api.get<{ flags: ReconciliationFlag[] }>('/admin/crm/reconciliation-flags')).data.flags,
  })

  const { data: ledger, isLoading: ledgerLoading } = useQuery({
    queryKey: ['crm-wallet-transactions', category, txType, page],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), page_size: '50' })
      if (category) params.set('category', category)
      if (txType) params.set('type', txType)
      return (await api.get<WalletTransactionsPage>(`/admin/crm/wallet-transactions?${params}`)).data
    },
    enabled: tab === 'ledger',
  })

  return (
    <div>
      <h1 className="text-green-900 dark:text-white font-extrabold text-2xl mb-1">Financial reconciliation</h1>
      <p className="text-green-500 dark:text-night-200 text-sm mb-6">
        Wallet ledger and balance-integrity flags. Monnify's own transaction history isn't cross-checked here yet — see the CRM checklist.
      </p>

      <div className="flex items-center gap-2 mb-5">
        <button onClick={() => setTab('flags')}
          className={cn('px-4 py-2 rounded-full text-xs font-bold', tab === 'flags' ? 'bg-green-900 dark:bg-copper-400 text-white dark:text-green-950' : 'bg-white dark:bg-night-700 border border-green-200 dark:border-night-500 text-green-600 dark:text-night-200')}>
          Discrepancy flags {flags && flags.length > 0 && `(${flags.length})`}
        </button>
        <button onClick={() => setTab('ledger')}
          className={cn('px-4 py-2 rounded-full text-xs font-bold', tab === 'ledger' ? 'bg-green-900 dark:bg-copper-400 text-white dark:text-green-950' : 'bg-white dark:bg-night-700 border border-green-200 dark:border-night-500 text-green-600 dark:text-night-200')}>
          Wallet ledger
        </button>
      </div>

      {tab === 'flags' && (
        <div>
          {flagsLoading && <div className="h-32 bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 animate-pulse" />}
          {!flagsLoading && flags?.length === 0 && (
            <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-8 text-center">
              <p className="text-green-600 dark:text-night-200 text-sm font-semibold">No discrepancies found. Every wallet's balance matches its own transaction history.</p>
            </div>
          )}
          <div className="space-y-2">
            {flags?.map(f => (
              <div key={f.wallet_id} className="bg-white dark:bg-night-700 rounded-2xl border border-amber-200 shadow-card p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
                  <div>
                    <p className="text-green-900 dark:text-white font-semibold text-sm">{f.owner_name} · #{f.owner_customer_number}</p>
                    <p className="text-green-400 dark:text-night-300 text-xs">
                      Current: {formatNaira(f.current_balance_kobo)} · Last recorded: {formatNaira(f.last_recorded_balance_kobo)}
                    </p>
                  </div>
                </div>
                <span className={cn('text-xs font-bold', f.difference_kobo > 0 ? 'text-green-600' : 'text-red-500')}>
                  {f.difference_kobo > 0 ? '+' : ''}{formatNaira(f.difference_kobo)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'ledger' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <select value={category} onChange={e => { setCategory(e.target.value); setPage(1) }}
                className="bg-white dark:bg-night-700 border border-green-200 dark:border-night-500 rounded-xl px-3 py-2 text-xs text-green-900 dark:text-white">
                <option value="">All categories</option>
                {CATEGORIES.map(c => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
              </select>
              <select value={txType} onChange={e => { setTxType(e.target.value); setPage(1) }}
                className="bg-white dark:bg-night-700 border border-green-200 dark:border-night-500 rounded-xl px-3 py-2 text-xs text-green-900 dark:text-white">
                <option value="">Credit & debit</option>
                <option value="credit">Credit only</option>
                <option value="debit">Debit only</option>
              </select>
            </div>
            {ledger && ledger.transactions.length > 0 && (
              <button
                onClick={() => exportLedgerCsv(ledger.transactions)}
                className="flex items-center gap-1 text-green-600 dark:text-night-200 text-xs font-semibold"
              >
                <Download className="w-3.5 h-3.5" /> Export this page
              </button>
            )}
          </div>

          <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-green-100 dark:border-night-500 text-left">
                  <th className="px-5 py-3 text-green-500 dark:text-night-200 text-xs font-semibold uppercase tracking-wide">When</th>
                  <th className="px-5 py-3 text-green-500 dark:text-night-200 text-xs font-semibold uppercase tracking-wide">Customer</th>
                  <th className="px-5 py-3 text-green-500 dark:text-night-200 text-xs font-semibold uppercase tracking-wide">Category</th>
                  <th className="px-5 py-3 text-green-500 dark:text-night-200 text-xs font-semibold uppercase tracking-wide">Amount</th>
                  <th className="px-5 py-3 text-green-500 dark:text-night-200 text-xs font-semibold uppercase tracking-wide">Balance after</th>
                </tr>
              </thead>
              <tbody>
                {ledgerLoading && [1, 2, 3, 4].map(i => (
                  <tr key={i} className="border-b border-green-50 dark:border-night-600">
                    <td colSpan={5} className="px-5 py-4"><div className="h-4 bg-green-50 dark:bg-night-600 rounded animate-pulse" /></td>
                  </tr>
                ))}
                {!ledgerLoading && ledger?.transactions.map(tx => (
                  <tr key={tx.id} className="border-b border-green-50 dark:border-night-600 last:border-0">
                    <td className="px-5 py-3 text-green-500 dark:text-night-200 text-xs">{formatDateTime(tx.created_at)}</td>
                    <td className="px-5 py-3 text-green-900 dark:text-white font-semibold">{tx.owner_name} <span className="text-green-400 dark:text-night-300 font-normal">#{tx.owner_customer_number}</span></td>
                    <td className="px-5 py-3 text-green-600 dark:text-night-200 capitalize">{tx.category.replace(/_/g, ' ')}</td>
                    <td className={cn('px-5 py-3 font-semibold', tx.type === 'credit' ? 'text-green-600' : 'text-red-500')}>
                      {tx.type === 'credit' ? '+' : '−'}{formatNaira(tx.amount_kobo)}
                    </td>
                    <td className="px-5 py-3 text-green-500 dark:text-night-200">{formatNaira(tx.balance_after_kobo)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {ledger && ledger.total > ledger.page_size && (
            <div className="flex items-center justify-between mt-4">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
                className="text-green-600 dark:text-night-200 text-xs font-semibold disabled:opacity-30">← Prev</button>
              <p className="text-green-400 dark:text-night-300 text-xs">Page {page} · {ledger.total} transactions</p>
              <button onClick={() => setPage(p => p + 1)} disabled={page * ledger.page_size >= ledger.total}
                className="text-green-600 dark:text-night-200 text-xs font-semibold disabled:opacity-30">Next →</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
