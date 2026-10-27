import { describe, expect, it } from 'vitest'
import { parseAmount, presetPeriod, ymd } from './accounting'

describe('accounting helpers', () => {
  const now = new Date(2026, 2, 15)   // 15 March 2026 (local)
  it('builds calendar periods without UTC drift', () => {
    expect(presetPeriod('today', now)).toMatchObject({ start: '2026-03-15', end: '2026-03-15' })
    expect(presetPeriod('7d', now)).toMatchObject({ start: '2026-03-09', end: '2026-03-15' })
    expect(presetPeriod('month', now)).toMatchObject({ start: '2026-03-01', end: '2026-03-15' })
    expect(presetPeriod('lastmonth', now)).toMatchObject({ start: '2026-02-01', end: '2026-02-28' })
    expect(presetPeriod('90d', now).start).toBe('2025-12-16')
  })
  it('formats a local midnight as the same calendar day', () => { expect(ymd(new Date(2026, 0, 1, 0, 5))).toBe('2026-01-01') })
  it('parses typed prices', () => {
    expect(parseAmount('1,250.50')).toBe(1250.5)
    expect(parseAmount('')).toBeNull()
    expect(parseAmount('-3')).toBeNull()
    expect(parseAmount('abc')).toBeNull()
    expect(parseAmount('0')).toBe(0)
  })
})
