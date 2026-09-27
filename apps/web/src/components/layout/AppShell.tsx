import { type ReactNode } from 'react'
import { BottomNav } from './BottomNav'
import { TopBar } from './TopBar'
import { useAuthStore } from '@/store/auth.store'

interface AppShellProps {
  children: ReactNode
  title?: string
  showBack?: boolean
  headerRight?: ReactNode
  noNav?: boolean
  noPadding?: boolean
}

export function AppShell({
  children,
  title,
  showBack,
  headerRight,
  noNav,
  noPadding,
}: AppShellProps) {
  const user = useAuthStore((s) => s.user)
  const showNav  = !noNav && !!user

  return (
    <div className="min-h-dvh bg-surface flex flex-col">
      <TopBar title={title} showBack={showBack} right={headerRight} />
      <main
        className={noPadding ? 'flex-1' : 'flex-1 px-4 py-4 pb-28 max-w-lg mx-auto w-full'}
      >
        {children}
      </main>
      {showNav && <BottomNav />}
    </div>
  )
}
