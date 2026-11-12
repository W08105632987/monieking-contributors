import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuthStore } from '@/store/auth.store'

/** Company workers have no wallet, so the earnings and payout screens do not exist for them. */
export function AffiliatedWorkerOnly({ children }: { children: ReactNode }) {
  const user = useAuthStore((s) => s.user)
  if (user?.worker_type === 'company') return <Navigate to="/worker/dashboard" replace />
  return <>{children}</>
}
