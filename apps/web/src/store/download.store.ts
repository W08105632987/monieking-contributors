import { create } from 'zustand'

export interface DownloadState {
  open: boolean
  filename: string
  label: string
  /** 0–100, or null while the size is unknown (the bar then shimmers) */
  progress: number | null
  phase: 'working' | 'done' | 'error'
  error?: string
  set: (p: Partial<DownloadState>) => void
  close: () => void
}

export const useDownloadStore = create<DownloadState>()((set) => ({
  open: false, filename: '', label: '', progress: 0, phase: 'working',
  set: (p) => set(p),
  close: () => set({ open: false }),
}))
