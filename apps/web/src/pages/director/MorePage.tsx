import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Settings, Megaphone, Image, BarChart3, LineChart, Activity,
  FileClock, Send, Users, User, AlertTriangle, Fingerprint, UserCheck,
} from 'lucide-react'

const actions = [
  { label: 'Service Workers Command', icon: UserCheck, href: '/director/service-workers', color: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-300' },
  { label: 'Business Settings', icon: Settings,   href: '/director/settings',   color: 'bg-green-100 dark:bg-night-600 text-green-700 dark:text-night-100' },
  { label: 'Identity Services & Pricing', icon: Fingerprint, href: '/director/identity-services', color: 'bg-green-100 dark:bg-night-600 text-green-700 dark:text-night-100' },
  { label: 'Instant Message',   icon: Megaphone,  href: '/director/instant-message', color: 'bg-red-50 dark:bg-red-950/40 text-red-500 dark:text-red-300' },
  { label: 'Promo Banners',     icon: Image,      href: '/director/promo-banners',   color: 'bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-300' },
  { label: 'Analytics',         icon: BarChart3,  href: '/director/analytics',  color: 'bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-300' },
  { label: 'Live Metrics',      icon: LineChart,  href: '/director/live-metrics', color: 'bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-300' },
  { label: 'System Health',     icon: Activity,   href: '/director/system-health', color: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-300' },
  { label: 'Disputes',          icon: AlertTriangle, href: '/director/disputes', color: 'bg-red-50 dark:bg-red-950/40 text-red-500 dark:text-red-300' },
  { label: 'Audit Log',         icon: FileClock,  href: '/director/audit-log',  color: 'bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-300' },
  { label: 'Broadcast',         icon: Send,       href: '/director/broadcast',  color: 'bg-teal-50 dark:bg-teal-950/40 text-teal-600 dark:text-teal-300' },
  { label: 'All Customers',     icon: Users,      href: '/director/customers',  color: 'bg-green-50 dark:bg-night-600 text-green-600 dark:text-night-200' },
  { label: 'Profile',           icon: User,       href: '/director/profile',    color: 'bg-green-100 dark:bg-night-600 text-green-700 dark:text-night-100' },
]

export default function MorePage() {
  const navigate = useNavigate()

  return (
    <div className="min-h-dvh flex flex-col bg-green-50 dark:bg-night-800">
      <header className="flex items-center gap-3 px-4 py-3 bg-green-50 dark:bg-night-800">
        <button onClick={() => navigate(-1)} className="w-9 h-9 rounded-full bg-white dark:bg-night-700 border border-green-100 dark:border-night-500 flex items-center justify-center">
          <ArrowLeft className="w-4 h-4 text-green-700 dark:text-night-100" />
        </button>
        <h1 className="text-green-900 dark:text-white font-extrabold text-lg">More</h1>
      </header>

      <div className="flex-1 overflow-y-auto px-4 pb-safe-nav">
        <div className="grid grid-cols-2 gap-3">
          {actions.map(a => (
            <button
              key={a.href}
              onClick={() => navigate(a.href)}
              className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-4 flex flex-col items-start gap-3 active:scale-95 transition-all"
            >
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${a.color}`}>
                <a.icon className="w-5 h-5" />
              </div>
              <p className="text-green-900 dark:text-white font-bold text-sm text-left">{a.label}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
