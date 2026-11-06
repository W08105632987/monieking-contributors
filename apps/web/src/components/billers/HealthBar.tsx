import { cn } from '@/lib/utils'
import type { BillStat } from '@/hooks/useBillHealth'

const FILL: Record<string, string> = { good: 'bg-green-500', fair: 'bg-amber-400', poor: 'bg-red-500', unknown: 'bg-gray-300 dark:bg-night-500' }
const TEXT: Record<string, string> = { good: 'text-green-600 dark:text-green-300', fair: 'text-amber-600 dark:text-amber-300', poor: 'text-red-600 dark:text-red-300', unknown: 'text-gray-400 dark:text-night-300' }

/** A thin live "success rate" bar. Unknown = not enough recent purchases to say, so it shows a neutral bar instead of guessing. */
export function HealthBar({ stat, className }: { stat?: BillStat; className?: string }) {
  if (!stat) return null
  const known = stat.level !== 'unknown' && stat.success_rate !== null
  const label = known ? `${stat.success_rate}%` : 'New'
  const hint = known ? `${stat.completed} of ${stat.attempts} recent purchases succeeded` : 'Not enough recent purchases to show a success rate'
  return (
    <div className={cn('flex items-center gap-2', className)} title={hint} aria-label={`Success rate: ${hint}`}>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-night-600">
        <div className={cn('h-full rounded-full transition-all', FILL[stat.level])} style={{ width: known ? `${Math.max(4, stat.success_rate!)}%` : '100%', opacity: known ? 1 : 0.5 }} />
      </div>
      <span className={cn('w-9 text-right text-[10px] font-bold tabular-nums', TEXT[stat.level])}>{label}</span>
    </div>
  )
}
