import { useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { formatNaira } from '@/lib/utils'
import type { LedgerEntry } from './api'
import { Card, Sheet, dShort } from './ui'

/** Plain names for every kind of contribution entry, so members never see a code word. */
export const ENTRY_LABEL: Record<string, string> = {
  registration: 'Joined', contribution: 'Contribution added', withdrawal: 'Withdrawal', withdrawal_returned: 'Withdrawal returned',
  closure_payout: 'Membership closed', dividend: 'Dividend', dividend_adjustment: 'Dividend adjustment', estate_payout: 'Paid to next of kin',
  loan_repayment: 'Loan repayment', loss_applied: 'Applied to a loan loss', membership_fee: 'Membership fee',
}
export const entryLabel = (t: string) => ENTRY_LABEL[t] ?? t.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())

const timeText = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit' }) : '')

export function EntryRow({ e, onClick }: { e: LedgerEntry; onClick?: () => void }) {
  return (
    <Card onClick={onClick}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0"><p className="truncate text-sm font-bold text-green-900 dark:text-white">{entryLabel(e.type)}</p><p className="text-xs text-green-600 dark:text-night-300">{dShort(e.date)}</p></div>
        <div className="flex items-center gap-1">
          <p className={`font-extrabold ${e.delta_kobo < 0 ? 'text-red-600' : 'text-green-700 dark:text-green-300'}`}>{e.delta_kobo < 0 ? '−' : '+'}{formatNaira(Math.abs(e.delta_kobo))}</p>
          {onClick && <ChevronRight className="h-4 w-4 text-green-300" />}
        </div>
      </div>
    </Card>
  )
}

export function EntryDetailSheet({ e, onClose }: { e: LedgerEntry | null; onClose: () => void }) {
  const rows: [string, ReactNode][] = e ? [
    ['What', entryLabel(e.type)], ['Date', dShort(e.date)], ['Time', timeText(e.at) || '—'],
    ['Balance before', formatNaira(e.before_kobo)], ['Balance after', formatNaira(e.balance_kobo)],
    ...(e.note ? [['Note', e.note] as [string, ReactNode]] : []), ...(e.reference ? [['Reference', <span className="break-all font-mono text-xs">{e.reference}</span>] as [string, ReactNode]] : []),
  ] : []
  return (
    <Sheet open={!!e} onClose={onClose} title="Entry details">
      {e && (<>
        <p className={`text-3xl font-extrabold ${e.delta_kobo < 0 ? 'text-red-600' : 'text-green-700 dark:text-green-300'}`}>{e.delta_kobo < 0 ? '−' : '+'}{formatNaira(Math.abs(e.delta_kobo))}</p>
        <div className="mt-3 divide-y divide-green-100 rounded-xl border border-green-100 dark:divide-night-500 dark:border-night-500">
          {rows.map(([k, v]) => <div key={k} className="flex items-start justify-between gap-4 px-3 py-2 text-sm"><span className="text-green-600 dark:text-night-300">{k}</span><span className="text-right font-semibold text-green-900 dark:text-white">{v}</span></div>)}
        </div>
      </>)}
    </Sheet>
  )
}

/**
 * Long lists stay short: the first few rows with a "View all" button; View all opens the full list, ten per page.
 */
export function ViewAll<T>({ items, render, preview = 5, pageSize = 10, empty, label = 'View all', startOpen = false }: {
  items: T[]; render: (item: T, i: number) => ReactNode; preview?: number; pageSize?: number; empty?: ReactNode; label?: string; startOpen?: boolean
}) {
  const [all, setAll] = useState(startOpen)
  const [page, setPage] = useState(0)
  if (!items.length) return <>{empty ?? null}</>
  const pages = Math.max(1, Math.ceil(items.length / pageSize))
  const shown = all ? items.slice(page * pageSize, page * pageSize + pageSize) : items.slice(0, preview)
  return (
    <div>
      <div className="space-y-2">{shown.map((it, i) => render(it, all ? page * pageSize + i : i))}</div>
      {!all && items.length > preview && (
        <button onClick={() => setAll(true)} className="mt-2 w-full rounded-xl border border-green-200 py-2.5 text-sm font-bold text-green-800 active:scale-[0.99] dark:border-night-400 dark:text-night-100">{label} ({items.length})</button>)}
      {all && (
        <div className="mt-3 flex items-center justify-between text-sm">
          <button disabled={page === 0} onClick={() => setPage(page - 1)} className="flex h-9 items-center gap-1 rounded-full border border-green-200 px-3 font-bold text-green-800 disabled:opacity-40 dark:border-night-400 dark:text-night-100"><ChevronLeft className="h-4 w-4" />Previous</button>
          <span className="text-xs font-semibold text-green-700 dark:text-night-200">Page {page + 1} of {pages}</span>
          <button disabled={page >= pages - 1} onClick={() => setPage(page + 1)} className="flex h-9 items-center gap-1 rounded-full border border-green-200 px-3 font-bold text-green-800 disabled:opacity-40 dark:border-night-400 dark:text-night-100">Next<ChevronRight className="h-4 w-4" /></button>
        </div>)}
      {all && !startOpen && items.length > preview && <button onClick={() => { setAll(false); setPage(0) }} className="mt-2 w-full text-center text-xs font-bold text-green-600 dark:text-night-300">Show less</button>}
    </div>
  )
}
