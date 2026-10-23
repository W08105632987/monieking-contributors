import { usePinStore } from '@/store/pin.store'
import { useAuthStore } from '@/store/auth.store'

let seq = 0

/** Asks for the 4-digit payment PIN in an in-app modal. Resolves with the PIN, or null if they cancelled.
 *  If the person has not set a PIN yet the modal becomes "Set up payment pin" and resolves with the new PIN. */
export function requestPin(opts: { title?: string; message?: string; error?: string } = {}): Promise<string | null> {
  return new Promise((resolve) => {
    usePinStore.getState().open({ id: ++seq, title: opts.title ?? 'Enter your payment PIN', message: opts.message, error: opts.error, resolve })
  })
}

export class PinCancelled extends Error {
  constructor() { super('Cancelled') }
}
export const isPinCancelled = (e: unknown) => e instanceof PinCancelled

const status = (e: any): number | undefined => e?.response?.status
const detail = (e: any): string => String(e?.response?.data?.detail ?? e?.response?.data?.message ?? '')

/**
 * Runs `action(pin)` behind the PIN prompt.
 *  - no PIN set yet (428)  -> the prompt turns into "Set up payment pin", then the action continues
 *  - wrong PIN (401)       -> asks again with the error shown inside the prompt
 *  - cancelled             -> throws PinCancelled (callers simply stop)
 */
export async function withPin<T>(action: (pin: string) => Promise<T>, opts: { title?: string; message?: string } = {}): Promise<T> {
  let error: string | undefined
  for (let attempt = 0; attempt < 6; attempt++) {
    const pin = await requestPin({ ...opts, error })
    if (!pin) throw new PinCancelled()
    try {
      return await action(pin)
    } catch (e) {
      const st = status(e)
      if (st === 428 && /pin/i.test(detail(e))) {
        const u = useAuthStore.getState().user
        if (u) useAuthStore.getState().setUser({ ...u, has_payment_pin: false })
        error = undefined
        continue
      }
      if ((st === 403 || st === 401) && /incorrect pin/i.test(detail(e))) { error = 'That PIN is not right. Try again.'; continue }
      throw e
    }
  }
  throw new PinCancelled()
}
