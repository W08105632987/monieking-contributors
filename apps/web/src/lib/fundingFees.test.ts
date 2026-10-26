import { describe, it, expect } from 'vitest'
import { DEFAULT_TIERS, validateTiers, closeGaps } from './fundingFees'

describe('funding fee ranges', () => {
  it('accepts the defaults', () => expect(validateTiers(DEFAULT_TIERS)).toEqual([]))
  it('warns about a gap and says exactly which payments are uncovered', () => {
    const msgs = validateTiers([{ from: 0, to: 5000, fee: 10 }, { from: 6000, to: null, fee: 20 }])
    expect(msgs[0]).toMatch(/Gap.*₦5,001.*₦5,999/)
  })
  it('warns about overlaps and a closed last range', () => {
    expect(validateTiers([{ from: 0, to: 5000, fee: 1 }, { from: 4000, to: null, fee: 2 }])[0]).toMatch(/Overlap/)
    expect(validateTiers([{ from: 0, to: 5000, fee: 1 }]).join(' ')).toMatch(/open-ended/)
  })
  it('closeGaps repairs a gap', () => {
    const fixed = closeGaps([{ from: 0, to: 5000, fee: 10 }, { from: 6000, to: null, fee: 20 }])
    expect(fixed[1].from).toBe(5001)
    expect(validateTiers(fixed)).toEqual([])
  })
})
