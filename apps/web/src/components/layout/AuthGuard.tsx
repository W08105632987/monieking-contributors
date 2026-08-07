import { useLayoutEffect, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/store/auth.store'
import { LogoLoader } from '@/components/ui/LogoLoader'
import type { UserRole } from '@/types'

interface AuthGuardProps {
  children: ReactNode
  allowedRoles?: UserRole[]
}

const roleDashboard: Record<UserRole, string> = {
  customer: '/customer/dashboard',
  officer:  '/officer/dashboard',
  admin:    '/director/dashboard',   // Admin role kept in the DB enum for safety, but has no portal of its own anymore
  director: '/director/dashboard',
}

export function AuthGuard({ children, allowedRoles }: AuthGuardProps) {
  const { user, isLoading, isAuthenticated } = useAuthStore()
  const location = useLocation()

  // Dark mode is customer-only by design — officer and director portals
  // were never given dark styling. But the toggle just sets a global
  // localStorage flag and a class on <html>, with no idea which role is
  // logged in. So on a shared browser (or just not fully logging out),
  // a customer's dark-mode preference from an earlier session can still
  // be sitting there when an officer or director logs in next, and
  // nothing was clearing it for them specifically. This is the one
  // place every protected route funnels through, so it's the right
  // spot to force it off for non-customer roles — and leave it alone
  // for customers, so their own preference keeps working normally.
  useLayoutEffect(() => {
    if (user && user.role !== 'customer') {
      document.documentElement.classList.remove('dark')
    }
  }, [user])

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

  return <>{children}</>
}
