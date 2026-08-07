import { Outlet } from 'react-router-dom'
import { BottomNav } from './BottomNav'

export function AppLayout() {
  return (
    <div className="min-h-dvh flex flex-col bg-surface">
      <main className="flex-1 pb-20"> {/* pb-20 = space for bottom nav */}
        <Outlet />
      </main>
      <BottomNav />
    </div>
  )
}
