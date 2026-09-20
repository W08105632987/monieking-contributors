import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AuthUser } from '@/types'
import { queryClient } from '@/lib/queryClient'
import { useWalletStore } from '@/store/wallet.store'
import { useNotificationsStore } from '@/store/notifications.store'
import { recordActivity } from '@/lib/activityTracker'

interface AuthState {
  user: AuthUser | null
  isLoading: boolean
  isAuthenticated: boolean
  setUser: (user: AuthUser | null) => void
  setLoading: (loading: boolean) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      isLoading: true,
      isAuthenticated: false,
      setUser: (user) => {
        // A user becoming set here IS activity, by definition — a
        // fresh login, a page load that resumed a valid session, a
        // successful biometric auth. Stamping this is what stops
        // InactivityMonitor from reading a stale pre-logout timestamp
        // and immediately bouncing a brand-new login straight back out
        // — see activityTracker.ts's own comment for the full story.
        if (user) recordActivity()
        set({ user, isAuthenticated: !!user, isLoading: false })
      },
      setLoading: (isLoading) => set({ isLoading }),
      logout: () => {
        set({ user: null, isAuthenticated: false, isLoading: false })
        useWalletStore.getState().reset()
        useNotificationsStore.getState().reset()
        queryClient.clear()
      },
    }),
    {
      name: 'monieking-auth',
      partialize: (state) => ({ user: state.user, isAuthenticated: state.isAuthenticated }),
    },
  ),
)
