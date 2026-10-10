import { useRef, useEffect, useState, forwardRef } from 'react'
import { useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Home, CreditCard, Wallet, Bell, User, UserCog, Grid2x2, LayoutGrid, Briefcase, ShieldAlert, Coins, HeartHandshake, PiggyBank } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useNotificationsStore } from '@/store/notifications.store'
import { useAuthStore } from '@/store/auth.store'
import { useAppNavigate } from '@/hooks/useAppNavigate'

interface NavItem {
  label: string
  icon: React.ComponentType<{ className?: string | undefined; style?: React.CSSProperties }>
  href: string
}

const customerNav: NavItem[] = [
  { label: 'Home',     icon: Home,       href: '/customer/dashboard' },
  { label: 'Cards',    icon: CreditCard, href: '/customer/cards' },
  { label: 'Wallet',   icon: Wallet,     href: '/customer/wallet' },
  { label: 'Services', icon: LayoutGrid, href: '/customer/services' },
  { label: 'Profile',  icon: User,       href: '/customer/profile' },
]

// Shown instead of the customer nav while inside the cooperative section: it feels like its own app,
// and the "MonieKing" button on its home screen takes the member back to the main app.
const coopNav: NavItem[] = [
  { label: 'Home',       icon: Home,       href: '/coop' },
  { label: 'Loans',      icon: Coins,  href: '/coop/loans' },
  { label: 'Guarantors', icon: HeartHandshake,  href: '/coop/pool' },
  { label: 'Dividend',   icon: PiggyBank,  href: '/coop/dividend' },
  { label: 'Me',         icon: User,       href: '/coop/me' },
]

const officerNav: NavItem[] = [
  { label: 'Home',      icon: Home,       href: '/officer/dashboard' },
  { label: 'Customers', icon: User,       href: '/officer/customers' },
  { label: 'Wallet',    icon: Wallet,     href: '/officer/wallet' },
  { label: 'Alerts',    icon: Bell,       href: '/officer/notifications' },
  { label: 'Profile',   icon: User,       href: '/officer/profile' },
]

const directorNav: NavItem[] = [
  { label: 'Home',        icon: Home,     href: '/director/dashboard' },
  { label: 'Withdrawals', icon: Wallet,   href: '/director/withdrawals' },
  { label: 'Staff',       icon: UserCog,  href: '/director/staff' },
  { label: 'Alerts',      icon: Bell,     href: '/director/notifications' },
  { label: 'More',        icon: Grid2x2,  href: '/director/more' },
]

const workerNav: NavItem[] = [
  { label: 'Pool',      icon: LayoutGrid,  href: '/worker/dashboard' },
  { label: 'My Jobs',   icon: Briefcase,   href: '/worker/my-jobs' },
  { label: 'Earnings',  icon: Wallet,      href: '/worker/earnings' },
  { label: 'Disputes',  icon: ShieldAlert, href: '/worker/disputes' },
  { label: 'Profile',   icon: User,        href: '/worker/profile' },
]

const navByRole: Record<string, NavItem[]> = {
  customer:       customerNav,
  officer:        officerNav,
  director:       directorNav,
  admin:          directorNav,   // Admin role kept in the DB enum for safety, but shares the Director portal now
  service_worker: workerNav,
}

export const BottomNav = forwardRef<HTMLElement>(function BottomNav(_props, ref) {
  const location = useLocation()
  const navigate = useAppNavigate()
  const user = useAuthStore((s) => s.user)
  const unreadCount = useNotificationsStore((s) => s.unreadCount)

  const inCoop = user?.role === 'customer' && (location.pathname === '/coop' || location.pathname.startsWith('/coop/'))
  const navItems = inCoop ? coopNav : (navByRole[user?.role ?? 'customer'] ?? customerNav)

  // Longest matching href wins, so "/coop/loans" lights up Loans rather than the shorter "/coop" (Home).
  const activeIdx = (() => {
    let best = -1
    let bestLen = -1
    navItems.forEach((item, i) => {
      const hit = location.pathname === item.href || location.pathname.startsWith(item.href + '/')
      if (hit && item.href.length > bestLen) { best = i; bestLen = item.href.length }
    })
    return best
  })()

  // Refs for each tab button to measure position
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])
  const [blobStyle, setBlobStyle] = useState({ left: 0, width: 0 })

  useEffect(() => {
    if (activeIdx < 0) return
    const el = tabRefs.current[activeIdx]
    if (!el) return
    const rect = el.getBoundingClientRect()
    const parentRect = el.parentElement?.getBoundingClientRect()
    if (!parentRect) return
    setBlobStyle({
      left:  rect.left - parentRect.left + rect.width / 2 - 24,
      width: 48,
    })
  }, [activeIdx])

  if (!user) return null

  return (
    <nav
      ref={ref}
      id="app-bottom-nav"
      className="fixed bottom-0 left-0 right-0 z-50 bg-nav-gradient dark:bg-gradient-to-b dark:from-night-900 dark:to-night-950"
      style={{
        paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))',
        boxShadow: '0 -4px 24px rgba(5,46,22,0.25)',
      }}
    >
      <div className="relative flex items-center justify-around px-2 pt-2 pb-1 max-w-lg mx-auto">

        {/* Liquid blob — sits behind active icon */}
        <motion.div
          className="absolute top-1 rounded-full pointer-events-none"
          initial={false}
          animate={{
            left: blobStyle.left,
            width: blobStyle.width,
            height: blobStyle.width,
            opacity: blobStyle.width > 0 && activeIdx >= 0 ? 1 : 0,
          }}
          transition={{ type: 'spring', stiffness: 400, damping: 32 }}
          style={{
            background: 'radial-gradient(circle, rgba(245,158,11,0.35) 0%, rgba(245,158,11,0.10) 70%)',
            borderRadius: '50%',
          }}
        />

        {navItems.map((item, idx) => {
          const isActive = idx === activeIdx
          const Icon     = item.icon
          const isBell   = item.label === 'Alerts'

          return (
            <button
              key={item.href}
              ref={(el) => { tabRefs.current[idx] = el }}
              onClick={() => navigate(item.href)}
              className={cn(
                'relative flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl z-10',
                'transition-all duration-200 min-w-[3rem]',
                'focus-visible:outline-none',
              )}
              aria-label={item.label}
              aria-current={isActive ? 'page' : undefined}
            >
              <div className="relative">
                <Icon
                  className={cn(
                    'transition-all duration-200',
                    isActive ? 'w-6 h-6' : 'w-5 h-5',
                  )}
                  style={{ color: isActive ? '#F59E0B' : 'rgba(255,255,255,0.45)' }}
                />
                {isBell && unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center leading-none">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </div>
              <span
                className="text-xs font-semibold transition-all duration-200"
                style={{ color: isActive ? '#F59E0B' : 'rgba(255,255,255,0.45)' }}
              >
                {item.label}
              </span>
            </button>
          )
        })}
      </div>
    </nav>
  )
})