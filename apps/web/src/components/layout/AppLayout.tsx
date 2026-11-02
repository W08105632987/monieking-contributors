import { Suspense, useEffect, useRef } from 'react'
import { Outlet } from 'react-router-dom'
import { BottomNav } from './BottomNav'
import { PageContentSkeleton } from '@/components/ui/PageContentSkeleton'
import { PullToRefresh } from './PullToRefresh'

export function AppLayout() {
  const navRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const el = navRef.current
    if (!el) return

    const updateHeight = () => {
      const height = el.getBoundingClientRect().height
      if (height > 0) {
        document.documentElement.style.setProperty('--bottom-nav-height', `${Math.round(height)}px`)
      }
    }

    updateHeight()

    const observer = new ResizeObserver(() => {
      updateHeight()
    })
    observer.observe(el)
    window.addEventListener('resize', updateHeight)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updateHeight)
    }
  }, [])

  return (
    <>
      <PullToRefresh />
      <Suspense fallback={<PageContentSkeleton />}>
        <Outlet />
      </Suspense>
      <BottomNav ref={navRef} />
    </>
  )
}
