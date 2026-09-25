import { useNavigate } from 'react-router-dom'
import { Bell } from 'lucide-react'
import { BrandBlobLogo } from '@/components/brand/BrandBlobLogo'
import { Avatar } from '@/components/ui/Avatar'
import { useAuthStore } from '@/store/auth.store'
import { useNotificationsStore } from '@/store/notifications.store'

interface WorkerHeaderProps {
  title?: string
  subtitle?: string
}

export function WorkerHeader({ title, subtitle }: WorkerHeaderProps) {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const { unreadCount } = useNotificationsStore()

  return (
    <header className="flex items-center justify-between px-4 py-3 bg-green-50 dark:bg-night-800 border-b border-green-100/60 dark:border-night-700/60 sticky top-0 z-30">
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/worker/dashboard')}
          className="flex items-center focus:outline-none"
          aria-label="Worker Dashboard"
        >
          <BrandBlobLogo height={34} />
        </button>
        {title && (
          <div className="hidden sm:block pl-2 border-l border-green-200 dark:border-night-600">
            <h1 className="text-xs font-black text-green-950 dark:text-white uppercase tracking-wider">{title}</h1>
            {subtitle && <p className="text-[10px] text-green-600 dark:text-night-300">{subtitle}</p>}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2.5">
        {/* Notification Bell */}
        <button
          onClick={() => navigate('/worker/notifications')}
          className="relative w-10 h-10 rounded-2xl bg-white dark:bg-night-700 border border-green-100 dark:border-night-600 flex items-center justify-center text-green-800 dark:text-night-100 shadow-sm transition-transform active:scale-95 hover:border-green-300"
          aria-label="Worker Notifications"
        >
          <Bell className="w-5 h-5 text-green-800 dark:text-white" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-red-500 text-white text-[10px] font-black rounded-full flex items-center justify-center leading-none shadow-sm animate-pulse">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>

        {/* Profile Avatar */}
        <button
          onClick={() => navigate('/worker/profile')}
          className="rounded-full ring-2 ring-green-600/30 dark:ring-copper-400/40 p-0.5 shadow-sm transition-transform active:scale-95"
          aria-label="Worker Profile"
        >
          <Avatar
            name={user?.full_name ?? 'Worker'}
            avatarUrl={user?.avatar_url}
            size={36}
          />
        </button>
      </div>
    </header>
  )
}
