import { CheckCircle, Clock } from 'lucide-react'

/** The payout state of a COMPLETED card: paid out in full, partly paid out, or not paid out yet. */
export function CompletionBadge({ status, collected }: { status: string | null | undefined; collected?: boolean }) {
  const base = 'inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full whitespace-nowrap'
  if (collected) return <span className={`${base} bg-green-100 dark:bg-night-600 text-green-700 dark:text-night-100`}><CheckCircle className="w-3 h-3" /> Collected</span>
  if (status === 'paid') return <span className={`${base} bg-green-100 dark:bg-night-600 text-green-700 dark:text-night-100`}><CheckCircle className="w-3 h-3" /> Paid</span>
  if (status === 'partially_paid') return <span className={`${base} bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300`}><Clock className="w-3 h-3" /> Partially paid</span>
  return <span className={`${base} bg-gray-100 dark:bg-night-600 text-gray-600 dark:text-night-200`}>Unpaid</span>
}
