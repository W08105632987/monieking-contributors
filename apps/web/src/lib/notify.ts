import { useNoticeStore, type NoticeKind } from '@/store/notice.store'

/**
 * Drop-in replacement for react-hot-toast's toast(), toast.success() and toast.error().
 * Messages no longer stack along the top of the screen: errors open a centred box the person has to
 * acknowledge, successes and notes appear as one small centred card that closes itself — and a newer
 * message replaces the older one instead of piling up.
 */
const text = (m: unknown): string => (typeof m === 'string' ? m : m == null ? '' : String((m as any)?.message ?? m))
const show = (kind: NoticeKind, message: unknown, opts?: { icon?: string; duration?: number }) => {
  const t = text(message).trim()
  if (t) useNoticeStore.getState().show(kind, t, opts)
}

type Opts = { icon?: string; duration?: number }
export const toast = Object.assign(
  (message: unknown, opts?: Opts) => show('info', message, opts),
  {
    success: (message: unknown, opts?: Opts) => show('success', message, opts),
    error: (message: unknown, opts?: Opts) => show('error', message, opts),
    dismiss: () => useNoticeStore.getState().close(),
  },
)

export default toast
