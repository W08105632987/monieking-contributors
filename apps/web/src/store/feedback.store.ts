import { create } from 'zustand'

/**
 * Deliberately separate from react-hot-toast, not a replacement for it.
 * Reserved for the small set of critical actions where a message missed
 * at the top of the screen is a real problem: contribution marking,
 * customer registration, customer deletion, withdrawal request/claim/
 * reject, and card creation. Everything else stays a toast — making
 * every single message a centered, must-dismiss modal (even "reference
 * copied") would turn routine work into constant tap-to-dismiss friction.
 */
export type FeedbackType = 'success' | 'error'

interface FeedbackState {
  open: boolean
  type: FeedbackType
  title: string
  message?: string
  show: (type: FeedbackType, title: string, message?: string) => void
  close: () => void
}

export const useFeedbackStore = create<FeedbackState>()((set) => ({
  open: false,
  type: 'success',
  title: '',
  message: undefined,
  show: (type, title, message) => set({ open: true, type, title, message }),
  close: () => set({ open: false }),
}))

/** Convenience functions — call from anywhere, same ergonomics as toast.success()/toast.error(). */
export const showFeedback = {
  success: (title: string, message?: string) => useFeedbackStore.getState().show('success', title, message),
  error:   (title: string, message?: string) => useFeedbackStore.getState().show('error', title, message),
}
