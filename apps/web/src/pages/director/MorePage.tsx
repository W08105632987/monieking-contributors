import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Settings, Megaphone, Image, BarChart3,
  FileClock, Send, Users, User, AlertTriangle,
} from 'lucide-react'
import { BottomNav } from '@/components/layout/BottomNav'

const actions = [
  { label: 'Business Settings', icon: Settings,   href: '/director/settings',   color: 'bg-green-100 text-green-700' },
  { label: 'Instant Message',   icon: Megaphone,  href: '/director/instant-message', color: 'bg-red-50 text-red-500' },
  { label: 'Promo Banners',     icon: Image,      href: '/director/promo-banners',   color: 'bg-amber-50 text-amber-600' },
  { label: 'Analytics',         icon: BarChart3,  href: '/director/analytics',  color: 'bg-blue-50 text-blue-600' },
  { label: 'Disputes',          icon: AlertTriangle, href: '/director/disputes', color: 'bg-red-50 text-red-500' },
  { label: 'Audit Log',         icon: FileClock,  href: '/director/audit-log',  color: 'bg-purple-50 text-purple-600' },
  { label: 'Broadcast',         icon: Send,       href: '/director/broadcast',  color: 'bg-teal-50 text-teal-600' },
  { label: 'All Customers',     icon: Users,      href: '/director/customers',  color: 'bg-green-50 text-green-600' },
  { label: 'Profile',           icon: User,       href: '/director/profile',    color: 'bg-green-100 text-green-700' },
]

export default function MorePage() {
  const navigate = useNavigate()

  return (
    <div className="min-h-dvh flex flex-col bg-green-50">
      <header className="flex items-center gap-3 px-4 py-3 bg-green-50">
        <button onClick={() => navigate(-1)} className="w-9 h-9 rounded-full bg-white border border-green-100 flex items-center justify-center">
          <ArrowLeft className="w-4 h-4 text-green-700" />
        </button>
        <h1 className="text-green-900 font-extrabold text-lg">More</h1>
      </header>

      <div className="flex-1 overflow-y-auto px-4 pb-40">
        <div className="grid grid-cols-2 gap-3">
          {actions.map(a => (
            <button
              key={a.href}
              onClick={() => navigate(a.href)}
              className="bg-white rounded-2xl border border-green-100 shadow-card p-4 flex flex-col items-start gap-3 active:scale-95 transition-all"
            >
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${a.color}`}>
                <a.icon className="w-5 h-5" />
              </div>
              <p className="text-green-900 font-bold text-sm text-left">{a.label}</p>
            </button>
          ))}
        </div>
      </div>

      <BottomNav />
    </div>
  )
}
