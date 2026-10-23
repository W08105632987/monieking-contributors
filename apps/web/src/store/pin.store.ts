import { create } from 'zustand'

export interface PinRequest {
  id: number
  title: string
  message?: string
  error?: string
  /** Where the PIN is for: shown as a small line under the title ("Buy ₦500 MTN airtime"). */
  resolve: (pin: string | null) => void
}

interface PinState {
  current: PinRequest | null
  open: (r: PinRequest) => void
  close: () => void
}

export const usePinStore = create<PinState>()((set) => ({
  current: null,
  open: (r) => set((s) => { s.current?.resolve(null); return { current: r } }),
  close: () => set({ current: null }),
}))
