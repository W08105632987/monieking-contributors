import { create } from 'zustand'

export interface InAppBanner {
  id: string
  title: string
  body: string
  /** how many arrived together; shown as "+N more" */
  extra: number
}

interface InAppBannerState {
  banner: InAppBanner | null
  show: (b: InAppBanner) => void
  hide: () => void
}

export const useInAppBannerStore = create<InAppBannerState>()((set) => ({
  banner: null,
  show: (banner) => set({ banner }),
  hide: () => set({ banner: null }),
}))
