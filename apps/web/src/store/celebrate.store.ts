import { create } from 'zustand'

export interface Celebration {
  title: string
  message?: string
  /** A finished card gets the big treatment: confetti and a gold crown. */
  cardComplete?: boolean
}

interface State { current: Celebration | null; show: (c: Celebration) => void; close: () => void }

export const useCelebrateStore = create<State>()((set) => ({
  current: null,
  show: (c) => set({ current: c }),
  close: () => set({ current: null }),
}))

/** Call after a contribution lands. `daysAdded` days were just marked. */
export function celebrateContribution(opts: { daysAdded: number; ownerName?: string | null; card?: { status?: string; total_days_contributed?: number } }): void {
  const done = opts.card?.status === 'completed' || (opts.card?.total_days_contributed ?? 0) >= 372
  const who = opts.ownerName ? `${opts.ownerName}'s card` : 'the card'
  useCelebrateStore.getState().show(done
    ? { title: 'Card complete! 🎉', message: `All 372 days are marked on ${who}. What a finish.`, cardComplete: true }
    : { title: `${opts.daysAdded} day${opts.daysAdded > 1 ? 's' : ''} marked`, message: `Added to ${who}.` })
}
