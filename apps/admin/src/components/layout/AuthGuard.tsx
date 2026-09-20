import { useEffect } from 'react'
import { Navigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuthStore } from '@/store/auth.store'
import type { AdminUser } from '@/types'

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, setUser, setLoading } = useAuthStore()

  // Re-validates the session against the server on every load — the
  // persisted store is only there to avoid a login-page flash while
  // this resolves, never treated as proof of a live session by itself.
  const { data, isError, isFetched } = useQuery({
    queryKey: ['admin-me'],
    queryFn: async () => (await api.get<AdminUser>('/users/me')).data,
    retry: false,
  })

  useEffect(() => {
    if (!isFetched) return
    const isPrivileged = data?.role === 'admin' || data?.role === 'director'
    if (data && isPrivileged) {
      setUser(data)
    } else {
      setUser(null)
    }
  }, [data, isFetched, setUser])

  useEffect(() => {
    if (isError) setLoading(false)
  }, [isError, setLoading])

  if (!isFetched && !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-green-50 dark:bg-night-800">
        <p className="text-green-400 dark:text-night-300 text-sm">Loading…</p>
      </div>
    )
  }

  if (isFetched && (isError || (data?.role !== 'admin' && data?.role !== 'director'))) {
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}
