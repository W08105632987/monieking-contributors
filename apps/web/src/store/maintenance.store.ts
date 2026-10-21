import { create } from 'zustand'

interface MaintenanceState {
  on: boolean
  message: string
  eta: string | null
  startedAt: string | null
  set: (s: Partial<Omit<MaintenanceState, 'set'>>) => void
}

/** Whether directors have switched the app to maintenance. Filled by the public /maintenance check and by 503 replies. */
export const useMaintenanceStore = create<MaintenanceState>((set) => ({
  on: false, message: '', eta: null, startedAt: null,
  set: (s) => set(s),
}))
