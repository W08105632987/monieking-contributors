import { type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/store/auth.store'
import { LogoLoader } from '@/components/ui/LogoLoader'
import { Seo } from '@/components/seo/Seo'
import type { UserRole } from '@/types'

interface AuthGuardProps {
  children: ReactNode
  allowedRoles?: UserRole[]
}

export const roleDashboard: Record<UserRole, string> = {
  customer: '/customer/dashboard',
  officer:  '/officer/dashboard',
  admin:    '/director/dashboard',   // Admin role kept in the DB enum for safety, but has no portal of its own anymore
  director: '/director/dashboard',
  service_worker: '/worker/dashboard',
}

export function AuthGuard({ children, allowedRoles }: AuthGuardProps) {
  const user = useAuthStore((s) => s.user)
  const isLoading = useAuthStore((s) => s.isLoading)
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const location = useLocation()

  // All portals (customer, officer, director, worker) support dark mode

  if (isLoading) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-surface dark:bg-night-800">
        <LogoLoader />
      </div>
    )
  }

  if (!isAuthenticated || !user) {
    return <Navigate to="/auth/login" state={{ from: location }} replace />
  }

  if (user.role === 'service_worker' && !user.onboarding_completed && location.pathname !== '/worker/onboarding') {
    return <Navigate to="/worker/onboarding" replace />
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to={roleDashboard[user.role]} replace />
  }

  return <>{<Seo title="MonieKing" noindex />}{children}</>
}
