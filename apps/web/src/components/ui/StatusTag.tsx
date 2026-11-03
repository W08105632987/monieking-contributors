import { cn } from '@/lib/utils'
import type { UserStatus } from '@/types'

const LABEL: Record<UserStatus, string> = {
  active: 'Active',
  suspended: 'Suspended',
  pending_verification: 'Pending',
}

const TONE: Record<UserStatus, string> = {
  active: 'bg-green-100 text-green-700 dark:bg-night-600 dark:text-night-100',
  suspended: 'bg-red-50 text-red-500 dark:bg-red-900 dark:text-red-300',
  pending_verification: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
}

/** Small fixed-size status pill: never wraps, never grows with the label. */
export function StatusTag({ status, className }: { status: UserStatus; className?: string }) {
  return (
    <span
      title={status.replace(/_/g, ' ')}
      className={cn(
        'inline-flex max-w-[5.5rem] flex-shrink-0 items-center truncate whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold leading-4',
        TONE[status] ?? TONE.suspended,
        className,
      )}
    >
      {LABEL[status] ?? status}
    </span>
  )
}
