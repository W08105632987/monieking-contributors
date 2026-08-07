import { cn } from '@/lib/utils'

interface SpinnerProps { size?: 'sm' | 'md' | 'lg'; className?: string }

const sizes = { sm: 'w-4 h-4', md: 'w-6 h-6', lg: 'w-10 h-10' }

export function Spinner({ size = 'md', className }: SpinnerProps) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn(
        'inline-block rounded-full border-2 border-green-200 dark:border-night-500 border-t-green-700 dark:border-t-copper-400 animate-spin',
        sizes[size],
        className,
      )}
    />
  )
}

export function FullPageSpinner() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-surface dark:bg-night-800">
      <div className="flex flex-col items-center gap-4">
        <div className="w-12 h-12 rounded-2xl bg-green-900 flex items-center justify-center text-2xl font-black text-copper-400">
          ₦
        </div>
        <Spinner size="md" />
        <p className="text-sm text-green-600 dark:text-night-200 font-medium">Loading MonieKing…</p>
      </div>
    </div>
  )
}
