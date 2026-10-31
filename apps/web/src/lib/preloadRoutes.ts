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

/**
 * Hover / touch prefetch for a specific nav target. Cheap and idempotent
 * (dynamic import() is cached by the module system after the first call).
 */
const routeLoaders: Record<string, () => Promise<unknown>> = {
  '/customer/dashboard': () => import('@/pages/customer/DashboardPage'),
  '/customer/cards': () => import('@/pages/customer/CardsPage'),
  '/customer/wallet': () => import('@/pages/customer/WalletPage'),
  '/customer/services': () => import('@/pages/customer/ServicesPage'),
  '/customer/profile': () => import('@/pages/customer/ProfilePage'),
  '/customer/transactions': () => import('@/pages/customer/TransactionsPage'),
  '/customer/notifications': () => import('@/pages/customer/NotificationsPage'),
  '/customer/withdraw': () => import('@/pages/customer/WithdrawalPage'),
  '/officer/dashboard': () => import('@/pages/officer/DashboardPage'),
  '/officer/customers': () => import('@/pages/officer/CustomersPage'),
  '/officer/wallet': () => import('@/pages/officer/WalletPage'),
  '/officer/notifications': () => import('@/pages/officer/NotificationsPage'),
  '/officer/profile': () => import('@/pages/officer/ProfilePage'),
  '/director/dashboard': () => import('@/pages/director/DashboardPage'),
  '/director/withdrawals': () => import('@/pages/director/WithdrawalsPage'),
  '/director/staff': () => import('@/pages/director/StaffPage'),
  '/director/notifications': () => import('@/pages/director/NotificationsPage'),
  '/director/more': () => import('@/pages/director/MorePage'),
  '/worker/dashboard': () => import('@/pages/worker/WorkerDashboardPage'),
  '/worker/my-jobs': () => import('@/pages/worker/WorkerMyJobsPage'),
  '/worker/earnings': () => import('@/pages/worker/WorkerEarningsPage'),
  '/worker/disputes': () => import('@/pages/worker/WorkerDisputesPage'),
  '/worker/profile': () => import('@/pages/worker/WorkerProfilePage'),
}

const prefetched = new Set<string>()

export function prefetchRoute(href: string): void {
  const load = routeLoaders[href]
  if (!load || prefetched.has(href)) return
  prefetched.add(href)
  load().catch(() => prefetched.delete(href))
}

/** Warm secondary (non-tab) pages once the browser is idle, skipping data-saver connections. */
export function prefetchWhenIdle(hrefs: string[]): void {
  if (typeof window === 'undefined') return
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
  if (conn?.saveData) return
  const run = () => hrefs.forEach(prefetchRoute)
  const ric = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback
  if (ric) ric(run, { timeout: 4000 })
  else window.setTimeout(run, 2500)
}
