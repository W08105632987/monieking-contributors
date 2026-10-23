import { create } from 'zustand'

export type DialogTone = 'default' | 'danger' | 'success' | 'info'

export interface DialogRequest {
  id: number
  kind: 'confirm' | 'alert'
  title: string
  message?: string
  confirmLabel: string
  cancelLabel: string
  tone: DialogTone
  resolve: (ok: boolean) => void
}

interface DialogState {
  current: DialogRequest | null
  queue: DialogRequest[]
  push: (r: DialogRequest) => void
  settle: (ok: boolean) => void
}

export const useDialogStore = create<DialogState>()((set, get) => ({
  current: null,
  queue: [],
  push: (r) => set((s) => (s.current ? { queue: [...s.queue, r] } : { current: r })),
  settle: (ok) => {
    const cur = get().current
    if (!cur) return
    cur.resolve(ok)
    const [next, ...rest] = get().queue
    set({ current: next ?? null, queue: rest })
  },
}))
