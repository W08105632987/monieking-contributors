import { describe, it, expect, beforeEach } from 'vitest'
import toast from './notify'
import { useNoticeStore } from '@/store/notice.store'

beforeEach(() => useNoticeStore.setState({ open: false, text: '', seq: 0 }))

describe('notify (replaces stacking toasts)', () => {
  it('shows one message at a time; a newer one replaces the older', () => {
    toast.success('Saved')
    toast.error('Something broke')
    const s = useNoticeStore.getState()
    expect(s.open).toBe(true)
    expect(s.kind).toBe('error')
    expect(s.text).toBe('Something broke')
    expect(s.durationMs).toBe(0) // errors wait for OK
  })
  it('ignores the same message repeated', () => {
    toast.error('Same')
    const seq = useNoticeStore.getState().seq
    toast.error('Same')
    expect(useNoticeStore.getState().seq).toBe(seq)
  })
  it('successes close themselves and empty messages are ignored', () => {
    toast.success('Done')
    expect(useNoticeStore.getState().durationMs).toBeGreaterThan(0)
    toast.dismiss()
    toast.error('')
    expect(useNoticeStore.getState().open).toBe(false)
  })
})
