import { create } from 'zustand'

interface KycGateState { isOpen: boolean; show: () => void; close: () => void }

/** The "Complete your KYC" box that appears when someone tries to use a service before finishing identity verification. */
export const useKycGateStore = create<KycGateState>()((set) => ({
  isOpen: false,
  show: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
}))
