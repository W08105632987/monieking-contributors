import { describe, it, expect } from 'vitest'
import { createCreditTracker, isWalletFundedTitle } from './creditTracker'

describe('createCreditTracker', () => {
  it('first balance is only a baseline', () => {
    const t = createCreditTracker()
    expect(t.registerBalance(5000)).toBe(0)
  })
  it('reports a rise once even when several instances report it', () => {
    const t = createCreditTracker()
    t.registerBalance(5000)
    expect(t.registerBalance(15000)).toBe(10000)
    expect(t.registerBalance(15000)).toBe(0)
    expect(t.registerBalance(15000)).toBe(0)
  })
  it('never reports debits or unchanged balances', () => {
    const t = createCreditTracker()
    t.registerBalance(10000)
    expect(t.registerBalance(4000)).toBe(0)
    expect(t.registerBalance(4000)).toBe(0)
    expect(t.registerBalance(5000)).toBe(1000) // rise after a debit counts from the new baseline
  })
  it('ignores non-finite values', () => {
    const t = createCreditTracker()
    t.registerBalance(100)
    expect(t.registerBalance(NaN)).toBe(0)
    expect(t.registerBalance(200)).toBe(100)
  })
  it('merges push + balance signals for one transfer with a cool-down', () => {
    const t = createCreditTracker(10_000)
    expect(t.claim(1000)).toBe(true)
    expect(t.claim(4000)).toBe(false)
    expect(t.claim(11_001)).toBe(true)
  })
  it('reset forgets the baseline', () => {
    const t = createCreditTracker()
    t.registerBalance(100)
    t.reset()
    expect(t.registerBalance(900)).toBe(0)
    expect(t.claim(0)).toBe(true)
  })
})

describe('isWalletFundedTitle', () => {
  it('matches the server titles', () => {
    expect(isWalletFundedTitle('Wallet funded')).toBe(true)
    expect(isWalletFundedTitle('Wallet funded ✓')).toBe(true)
    expect(isWalletFundedTitle('Wallet debited')).toBe(false)
    expect(isWalletFundedTitle(undefined)).toBe(false)
  })
})
