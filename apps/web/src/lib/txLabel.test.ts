import { describe, it, expect } from 'vitest'
import { txLabel } from './txLabel'

describe('txLabel', () => {
  it('keeps contributions simple even when the description is long', () => {
    expect(txLabel({ category: 'contribution', description: 'Contribution to card #1001 (12 days) ref ABC' })).toBe('Contribution')
  })
  it('shows what a service charge was for, not "Withdrawal charge"', () => {
    expect(txLabel({ category: 'charge', description: 'NIN verification' })).toBe('NIN verification')
    expect(txLabel({ category: 'charge', description: null })).toBe('Service charge')
    expect(txLabel({ category: 'sms_fee', description: 'SMS alert (1 SMS)' })).toBe('SMS alert (1 SMS)')
  })

  it('shows the director\'s reason for a manual debit', () => {
    expect(txLabel({ category: 'manual_debit', description: 'Manual debit by director: Funded by mistake' })).toBe('Manual debit by director: Funded by mistake')
    expect(txLabel({ category: 'manual_debit', description: null })).toBe('Wallet debit')
  })
})
