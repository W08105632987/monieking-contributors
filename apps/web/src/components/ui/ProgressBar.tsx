import { cn } from '@/lib/utils'

interface ProgressBarProps {
  value: number      // 0–100
  variant?: 'green' | 'copper'
  size?: 'sm' | 'md'
  showLabel?: boolean
  className?: string
}

export function ProgressBar({ value, variant = 'green', size = 'sm', showLabel, className }: ProgressBarProps) {
  const pct = Math.min(Math.max(value, 0), 100)
  const trackClass = 'bg-green-100'
  const fillClass = variant === 'green' ? 'bg-green-600' : 'bg-gradient-to-r from-copper-500 to-copper-400'
  const heightClass = size === 'sm' ? 'h-1.5' : 'h-2.5'

  return (
    <div className={cn('w-full', className)}>
      <div className={cn('w-full rounded-full overflow-hidden', trackClass, heightClass)}>
        <div
          className={cn('h-full rounded-full transition-all duration-500', fillClass)}
          style={{ width: `${pct}%` }}
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>
      {showLabel && (
        <p className="text-xs text-green-500 font-medium mt-1 text-right">{pct}%</p>
      )}
    </div>
  )
}
