import { WifiOff, RotateCw } from 'lucide-react'

interface FallbackErrorProps {
  title?: string
  message?: string
  onRetry: () => void
  isRetrying?: boolean
}

export function FallbackError({
  title = "Couldn't load this",
  message = 'Check your connection and try again.',
  onRetry,
  isRetrying = false,
}: FallbackErrorProps) {
  return (
    <div className="flex flex-col items-center text-center gap-2 bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 py-10 px-4 mt-2">
      <div className="w-10 h-10 rounded-full bg-amber-50 dark:bg-night-600 flex items-center justify-center">
        <WifiOff className="w-5 h-5 text-amber-500" />
      </div>
      <p className="text-green-900 dark:text-white text-sm font-semibold">{title}</p>
      <p className="text-green-400 dark:text-night-300 text-xs">{message}</p>
      <button
        onClick={onRetry}
        disabled={isRetrying}
        className="flex items-center gap-1.5 mt-1 bg-green-900 dark:bg-amber-400 text-white dark:text-green-900 text-xs font-bold rounded-full px-4 py-2 disabled:opacity-50"
      >
        <RotateCw className={`w-3.5 h-3.5 ${isRetrying ? 'animate-spin' : ''}`} /> Retry
      </button>
    </div>
  )
}
