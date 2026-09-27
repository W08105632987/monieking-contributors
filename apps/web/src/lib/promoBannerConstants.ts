/**
 * Allowlist of valid internal CTA routes for promo banners.
 * This list must match the backend's ALLOWED_INTERNAL_ROUTES in
 * backend/app/schemas/promo_banner.py — update both together.
 *
 * Only include routes that make sense as a promo-banner destination:
 * major dashboards, wallet, cards, services, etc.
 * Do NOT include admin-only pages or routes requiring path params.
 */
export const PROMO_INTERNAL_ROUTES = [
  // Customer
  { path: '/customer/wallet',            label: 'Wallet / Fund wallet' },
  { path: '/customer/withdrawals/new',   label: 'Withdraw funds' },
  { path: '/customer/cards',             label: 'My Cards' },
  { path: '/customer/services',          label: 'Manual services' },
  { path: '/customer/services/history',  label: 'Service history' },
  { path: '/customer/airtime-data',      label: 'Airtime & Data' },
  { path: '/customer/bill-payments',     label: 'Bill Payments' },
  { path: '/customer/education-payments',label: 'Education Payments' },
  { path: '/customer/disputes',          label: 'My Disputes' },
  { path: '/customer/notifications',     label: 'Notifications' },
  { path: '/customer/profile',           label: 'Profile' },
  // Officer
  { path: '/officer/dashboard',          label: '(Officer) Dashboard' },
  { path: '/officer/customers',          label: '(Officer) Customers' },
  { path: '/officer/wallet',             label: '(Officer) Wallet' },
  { path: '/officer/notifications',      label: '(Officer) Notifications' },
  { path: '/officer/profile',            label: '(Officer) Profile' },
  { path: '/officer/disputes',           label: '(Officer) Disputes' },
  // Service Worker
  { path: '/worker/dashboard',           label: '(Worker) Job Pool' },
  { path: '/worker/my-jobs',             label: '(Worker) My Jobs' },
  { path: '/worker/earnings',            label: '(Worker) Earnings' },
  { path: '/worker/disputes',            label: '(Worker) Disputes' },
  { path: '/worker/profile',             label: '(Worker) Profile' },
  { path: '/worker/notifications',       label: '(Worker) Notifications' },
] as const

export type PromoInternalRoute = typeof PROMO_INTERNAL_ROUTES[number]['path']

/** Validates that an external URL starts with https:// */
export function isValidPromoExternalUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:'
  } catch {
    return false
  }
}
