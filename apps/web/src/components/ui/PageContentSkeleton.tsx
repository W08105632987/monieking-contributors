import { Skeleton, SkeletonCard } from './Skeleton'

/**
 * Lightweight, app-chrome-preserving skeleton fallback for page transitions.
 * Replaces the disruptive full-screen logo spinner while lazy chunks are downloading.
 */
export function PageContentSkeleton() {
  return (
    <div className="min-h-dvh flex flex-col bg-green-50 dark:bg-night-800 animate-fadeIn">
      {/* Header bar placeholder */}
      <header className="flex items-center justify-between px-4 py-3 bg-green-50 dark:bg-night-800">
        <Skeleton className="h-9 w-32 rounded-xl bg-green-100 dark:bg-night-600" />
        <Skeleton className="h-10 w-10 rounded-full bg-green-100 dark:bg-night-600" />
      </header>

      {/* Main content body placeholder */}
      <div className="flex-1 px-4 py-4 pb-28 max-w-lg mx-auto w-full space-y-4">
        {/* Hero Card */}
        <div className="rounded-3xl p-5 bg-green-100/60 dark:bg-night-700/60 border border-green-200/50 dark:border-night-600/50 space-y-4">
          <Skeleton className="h-4 w-28 rounded-lg bg-green-200/70 dark:bg-night-600" />
          <Skeleton className="h-8 w-48 rounded-xl bg-green-200/70 dark:bg-night-600" />
          <div className="grid grid-cols-2 gap-3 pt-2">
            <Skeleton className="h-10 rounded-xl bg-green-200/70 dark:bg-night-600" />
            <Skeleton className="h-10 rounded-xl bg-green-200/70 dark:bg-night-600" />
          </div>
        </div>

        {/* Content list item cards */}
        <SkeletonCard />
        <SkeletonCard />
      </div>
    </div>
  )
}
