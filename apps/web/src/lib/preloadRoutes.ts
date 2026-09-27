/**
 * Preload primary bottom-nav routes per role immediately after authentication.
 * Dynamic imports fire in the background (un-awaited, non-blocking) so that
 * subsequent tab taps hit pre-cached chunks, eliminating Suspense fallbacks.
 */
const preloadedRoles = new Set<string>()

export function preloadRoleRoutes(role: string) {
  if (!role || preloadedRoles.has(role)) return
  preloadedRoles.add(role)

  switch (role) {
    case 'customer':
      import('@/pages/customer/DashboardPage')
      import('@/pages/customer/CardsPage')
      import('@/pages/customer/WalletPage')
      import('@/pages/customer/ServicesPage')
      import('@/pages/customer/ProfilePage')
      break
    case 'officer':
      import('@/pages/officer/DashboardPage')
      import('@/pages/officer/CustomersPage')
      import('@/pages/officer/WalletPage')
      import('@/pages/officer/NotificationsPage')
      import('@/pages/officer/ProfilePage')
      break
    case 'director':
    case 'admin':
      import('@/pages/director/DashboardPage')
      import('@/pages/director/WithdrawalsPage')
      import('@/pages/director/StaffPage')
      import('@/pages/director/NotificationsPage')
      import('@/pages/director/MorePage')
      break
    case 'service_worker':
      import('@/pages/worker/WorkerDashboardPage')
      import('@/pages/worker/WorkerMyJobsPage')
      import('@/pages/worker/WorkerEarningsPage')
      import('@/pages/worker/WorkerDisputesPage')
      import('@/pages/worker/WorkerProfilePage')
      break
  }
}
