import { describe, it, expect } from 'vitest'
import { formatNaira, formatNairaAmount, formatNairaNumber } from './utils'

describe('formatNaira', () => {
  it('always shows 2 decimals', () => {
    expect(formatNaira(4500)).toBe('₦45.00')
    expect(formatNaira(125050)).toBe('₦1,250.50')
    expect(formatNaira(0)).toBe('₦0.00')
    expect(formatNaira(5_000_000)).toBe('₦50,000.00')
  })
  it('formats naira amounts and bare numbers', () => {
    expect(formatNairaAmount(1250.5)).toBe('₦1,250.50')
    expect(formatNairaNumber(125050)).toBe('1,250.50')
  })
})
