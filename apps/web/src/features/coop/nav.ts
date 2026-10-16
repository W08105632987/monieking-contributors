/**
 * Where the shared cooperative header sends each kind of user.
 * Kept as plain data so it is easy to test and can never send someone to a page
 * their role is not allowed to open (the AuthGuard on each route would bounce them).
 */
const BASE: Record<string, string> = {
  customer: '/customer',
  officer: '/officer',
  director: '/director',
  service_worker: '/worker',
}

const root = (role?: string | null) => BASE[role ?? ''] ?? '/customer'

/** The main MonieKing app home for this role (not the cooperative home). */
export const mainHomePath = (role?: string | null) =>
  role === 'service_worker' ? '/worker/dashboard' : `${root(role)}/dashboard`

export const profilePath = (role?: string | null) => `${root(role)}/profile`

export const notificationsPath = (role?: string | null) => `${root(role)}/notifications`
