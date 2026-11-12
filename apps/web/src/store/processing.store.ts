import { create } from 'zustand'

/** The full-screen "Processing…" cover shown between a payment PIN being entered and the result arriving. */
interface ProcessingState {
  label: string | null
  show: (label: string) => void
  hide: () => void
}

export const useProcessingStore = create<ProcessingState>()((set) => ({
  label: null,
  show: (label) => set({ label }),
  hide: () => set({ label: null }),
}))
