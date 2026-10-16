import { describe, expect, it } from 'vitest'
import { MAX_BARS, bucketDays, bucketSeries } from './chart'

const days = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    date: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10),
    contributed_kobo: 100 + i,
    withdrawn_kobo: i % 5 === 0 ? 10 : 0,
  }))

describe('transparency chart bucketing', () => {
  it('keeps one bar per day for short ranges', () => {
    expect(bucketDays(7)).toBe(1)
    expect(bucketSeries(days(30))).toHaveLength(30)
  })
  it('never draws more bars than the limit, however long the range', () => {
    for (const n of [32, 60, 90, 180, 365, 730, 3650]) {
      expect(bucketSeries(days(n)).length).toBeLessThanOrEqual(MAX_BARS)
    }
  })
  it('groups a year into weeks or longer', () => {
    expect(bucketDays(365)).toBeGreaterThanOrEqual(7)
  })
  it('never loses or invents a kobo', () => {
    const d = days(365)
    const b = bucketSeries(d)
    expect(b.reduce((s, x) => s + x.contributed_kobo, 0)).toBe(d.reduce((s, x) => s + x.contributed_kobo, 0))
    expect(b.reduce((s, x) => s + x.withdrawn_kobo, 0)).toBe(d.reduce((s, x) => s + x.withdrawn_kobo, 0))
    expect(b.reduce((s, x) => s + x.days, 0)).toBe(365)
  })
  it('handles an empty series', () => {
    expect(bucketSeries([])).toEqual([])
  })
})
