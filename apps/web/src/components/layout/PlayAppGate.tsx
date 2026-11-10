import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { isPlayApp } from '@/lib/playApp'

/** Wraps an identity / manual service route. Inside the Play app these services do not exist, so a saved link or the
 *  back button shows a friendly page instead of the form. `param` is kept only so existing call sites still compile. */
export function PlayAppGate({ children }: { param?: string; children: ReactNode }) {
  if (isPlayApp()) {
    return (
      <div className="mx-auto max-w-md p-6 text-center">
        <h1 className="text-green-900 dark:text-white text-lg font-bold">Not available in this app</h1>
        <p className="mt-2 text-sm text-green-700 dark:text-night-200">This service is not offered in the app version. You can still use everything else.</p>
        <Link to="/" replace className="mt-4 inline-block rounded-full bg-green-700 px-5 py-2 text-sm font-bold text-white">Go home</Link>
      </div>
    )
  }
  return <>{children}</>
}
