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
}

export function AuthGuard({ children, allowedRoles }: AuthGuardProps) {
  const { user, isLoading, isAuthenticated } = useAuthStore()
  const location = useLocation()

  // All portals (customer, officer, director) now support dark mode,
  // so we no longer force-remove the dark class for non-customer roles.


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

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to={roleDashboard[user.role]} replace />
  }

  return <>{<Seo title="MonieKing" noindex />}{children}</>
}
