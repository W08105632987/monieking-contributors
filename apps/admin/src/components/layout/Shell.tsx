import { NavLink, useNavigate } from 'react-router-dom'
import { LayoutDashboard, Users, UserCog, MapPin, ShieldCheck, Scale, AlertTriangle, Megaphone, History, Settings, LineChart, Activity, LogOut } from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '@/lib/api'
import { useAuthStore } from '@/store/auth.store'
import { initials, cn } from '@/lib/utils'

const NAV_ITEMS = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/system-health', label: 'System health', icon: Activity, end: false },
  { to: '/analytics', label: 'Live metrics', icon: LineChart, end: false },
  { to: '/customers', label: 'Customers', icon: Users, end: false },
  { to: '/officers', label: 'Officers', icon: UserCog, end: false },
  { to: '/zones', label: 'Zones', icon: MapPin, end: false },
  { to: '/directors', label: 'Directors', icon: ShieldCheck, end: false },
  { to: '/reconciliation', label: 'Reconciliation', icon: Scale, end: false },
  { to: '/disputes', label: 'Disputes', icon: AlertTriangle, end: false },
  { to: '/broadcasts', label: 'Broadcasts', icon: Megaphone, end: false },
  { to: '/audit-log', label: 'Audit log', icon: History, end: false },
  { to: '/settings', label: 'Business settings', icon: Settings, end: false },
  // KYC review has no real backend workflow to hook into yet — see the
  // CRM checklist for why that one's deliberately not here.
]

export function Shell({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate()
  const { user, logout } = useAuthStore()

  const handleLogout = async () => {
    try {
      await api.post('/auth/logout')
    } catch {
      // Non-fatal — clearing local state below still gets the admin
      // logged out of this browser even if the network call fails.
    }
    logout()
    toast.success('Signed out')
    navigate('/login', { replace: true })
  }

  return (
    <div className="min-h-screen flex bg-green-50 dark:bg-night-800">
      <aside className="w-64 flex-shrink-0 bg-green-950 flex flex-col">
        <div className="flex items-center gap-2 px-5 py-6">
          <ShieldCheck className="w-5 h-5 text-copper-400" />
          <span className="text-white font-extrabold tracking-tight">MonieKing Admin</span>
        </div>

        <nav className="flex-1 px-3 space-y-1">
          {NAV_ITEMS.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-colors',
                isActive ? 'bg-green-800 text-white' : 'text-green-400 hover:bg-green-900 hover:text-green-100',
              )}
            >
              <item.icon className="w-4 h-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="p-3 border-t border-green-900">
          <div className="flex items-center gap-2.5 px-2 py-2 mb-1">
            <div className="w-8 h-8 rounded-full bg-copper-400 flex items-center justify-center text-green-950 text-xs font-extrabold flex-shrink-0">
              {user ? initials(user.full_name) : '—'}
            </div>
            <div className="min-w-0">
              <p className="text-white text-xs font-bold truncate">{user?.full_name ?? 'Admin'}</p>
              <p className="text-green-500 text-[10px]">Administrator</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-green-400 hover:bg-green-900 hover:text-white text-xs font-semibold transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" /> Sign out
          </button>
        </div>
      </aside>

      <main className="flex-1 min-w-0 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-8 py-8">
          {children}
        </div>
      </main>
    </div>
  )
}
