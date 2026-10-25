import { describe, it, expect, beforeEach } from 'vitest'
import { withPin, isPinCancelled } from './pin'
import { usePinStore } from '@/store/pin.store'
import { useAuthStore } from '@/store/auth.store'

const answer = (pin: string | null) => { const c = usePinStore.getState().current!; usePinStore.getState().close(); c.resolve(pin) }
const tick = () => new Promise((r) => setTimeout(r, 0))
const err = (status: number, detail: string) => ({ response: { status, data: { detail } } })

describe('withPin', () => {
  beforeEach(() => { usePinStore.setState({ current: null }); useAuthStore.setState({ user: { id: '1', role: 'customer', nin_linked: true } as any }) })

  it('passes the typed PIN to the action', async () => {
    const p = withPin(async (pin) => `ok-${pin}`)
    await tick(); answer('4821')
    expect(await p).toBe('ok-4821')
  })

  it('asks again with a message after a wrong PIN', async () => {
    let n = 0
    const p = withPin(async (pin) => { if (n++ === 0) throw err(403, 'Incorrect PIN'); return pin })
    await tick(); answer('0000'); await tick()
    expect(usePinStore.getState().current?.error).toMatch(/not right/i)
    answer('4821')
    expect(await p).toBe('4821')
  })

  it('marks the PIN as not set on a 428 and asks again (set-up flow)', async () => {
    useAuthStore.setState({ user: { id: '1', role: 'customer', nin_linked: true, has_payment_pin: true } as any })
    let n = 0
    const p = withPin(async (pin) => { if (n++ === 0) throw err(428, 'Set up payment pin'); return pin })
    await tick(); answer('4821'); await tick()
    expect(useAuthStore.getState().user?.has_payment_pin).toBe(false)
    answer('7391')
    expect(await p).toBe('7391')
  })

  it('throws a cancel marker when dismissed, and rethrows other errors', async () => {
    const p = withPin(async () => 1)
    await tick(); answer(null)
    await expect(p).rejects.toSatisfy(isPinCancelled)
    const q = withPin(async () => { throw err(500, 'boom') })
    await tick(); answer('1111')
    await expect(q).rejects.toMatchObject({ response: { status: 500 } })
  })
})
