import { create } from 'zustand'

interface ServerHealthState {
  isDown: boolean
  setDown: (down: boolean) => void
}

/**
 * Flips to true when a request fails with NO response at all (network
 * error / server unreachable — the actual "app is down" case), not on
 * ordinary 4xx/5xx business errors, which still mean the server is up
 * and responding normally. Read from App.tsx to swap the whole app for
 * <MaintenancePage /> instead of leaving every page independently
 * broken/blank.
 */
export const useServerHealthStore = create<ServerHealthState>((set) => ({
  isDown: false,
  setDown: (down) => set({ isDown: down }),
}))
