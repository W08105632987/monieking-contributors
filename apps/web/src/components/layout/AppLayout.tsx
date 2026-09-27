import { Suspense } from 'react'
import { Outlet } from 'react-router-dom'
import { BottomNav } from './BottomNav'
import { PageContentSkeleton } from '@/components/ui/PageContentSkeleton'

export function AppLayout() {
  return (
    <>
      <Suspense fallback={<PageContentSkeleton />}>
        <Outlet />
      </Suspense>
      <BottomNav />
    </>
  )
}
