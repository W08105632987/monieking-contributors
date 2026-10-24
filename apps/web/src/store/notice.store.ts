import { create } from 'zustand'

export type NoticeKind = 'success' | 'error' | 'info'

interface NoticeState {
  open: boolean
  kind: NoticeKind
  text: string
  icon?: string
  /** Bumps on every show, so the host can restart its auto-close timer. */
  seq: number
  durationMs: number
  show: (kind: NoticeKind, text: string, opts?: { icon?: string; duration?: number }) => void
  close: () => void
}

/** One message at a time. A new message replaces the old one; the same message twice in a row is ignored. */
export const useNoticeStore = create<NoticeState>()((set, get) => ({
  open: false, kind: 'info', text: '', icon: undefined, seq: 0, durationMs: 2600,
  show: (kind, text, opts) => {
    const s = get()
    if (s.open && s.kind === kind && s.text === text) return
    set({ open: true, kind, text, icon: opts?.icon, seq: s.seq + 1, durationMs: opts?.duration ?? (kind === 'error' ? 0 : 2600) })
  },
  close: () => set({ open: false }),
}))
