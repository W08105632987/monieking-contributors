/**
 * Pure bookkeeping for "money just entered the wallet".
 *
 * Several components can read the wallet at once (useWallet is mounted on more
 * than one screen, plus the app-shell sound hook, plus the push message). They
 * all report the balance they see to ONE tracker, so a single credit produces
 * a single sound: the first reporter sees the rise and updates the baseline,
 * every later reporter sees "no change". A push-driven and a balance-driven
 * signal for the same transfer are merged by a short cool-down.
 */
export const COIN_COOLDOWN_MS = 10_000

export interface CreditTracker {
  /** Report the balance (kobo) you just saw. Returns the credited amount in kobo (> 0) if it rose, else 0. */
  registerBalance(kobo: number): number
  /** Returns true when a coin sound may play now (and starts the cool-down). */
  claim(now?: number): boolean
  reset(): void
}

export function createCreditTracker(cooldownMs = COIN_COOLDOWN_MS): CreditTracker {
  let last: number | null = null
  let lastClaim = -Infinity
  return {
    registerBalance(kobo) {
      if (!Number.isFinite(kobo)) return 0
      const prev = last
      last = kobo
      if (prev === null) return 0 // first sight of the balance: baseline only
      return kobo > prev ? kobo - prev : 0 // debits / no change never count
    },
    claim(now = Date.now()) {
      if (now - lastClaim < cooldownMs) return false
      lastClaim = now
      return true
    },
    reset() {
      last = null
      lastClaim = -Infinity
    },
  }
}

/** True for the push titles the server sends when money lands ("Wallet funded", "Wallet funded ✓"). */
export function isWalletFundedTitle(title: unknown): boolean {
  if (typeof title !== 'string') return false
  return title.replace(/[✓✔\s]+$/u, '').trim().toLowerCase() === 'wallet funded'
}
