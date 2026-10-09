import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AuthUser } from '@/types'
import { queryClient } from '@/lib/queryClient'
import { useWalletStore } from '@/store/wallet.store'
import { useNotificationsStore } from '@/store/notifications.store'
import { recordActivity, applyBootIdleGate } from '@/lib/activityTracker'

interface AuthState {
  user: AuthUser | null
  isLoading: boolean
  isAuthenticated: boolean
  setUser: (user: AuthUser | null) => void
  setLoading: (loading: boolean) => void
  logout: () => void
}

// MUST stay on the line before create(): zustand's persist() hydrates
// synchronously from localStorage at create-time, so if the person has
// been away longer than the idle window this has to rewrite the persisted
// login as logged-out FIRST — otherwise the very first render would
// already be authenticated and paint whatever they left behind. See
// applyBootIdleGate() in activityTracker.ts for the full reasoning.
const bootIdleExpired = applyBootIdleGate()

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      // Nothing to wait for when the gate just ended the session — there
      // is no profile to fetch, so don't hold the loader up (and don't
      // let anything race to "resume" a session we just closed).
      isLoading: !bootIdleExpired,
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
