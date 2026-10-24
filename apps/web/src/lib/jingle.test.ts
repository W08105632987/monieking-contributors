import { describe, it, expect } from 'vitest'
import { jingleDurationSeconds, shouldPlayJingle, markJinglePlayed, JINGLE_NOTES } from './jingle'

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) } }

describe('christmas jingle', () => {
  it('lasts between 5 and 8 seconds', () => {
    const d = jingleDurationSeconds()
    expect(d).toBeGreaterThanOrEqual(5)
    expect(d).toBeLessThanOrEqual(8)
    expect(JINGLE_NOTES.length).toBeGreaterThan(10)
  })
  it('plays once per person per year', () => {
    const s = mem()
    expect(shouldPlayJingle('u1', 2026, s)).toBe(true)
    markJinglePlayed('u1', 2026, s)
    expect(shouldPlayJingle('u1', 2026, s)).toBe(false)
    expect(shouldPlayJingle('u2', 2026, s)).toBe(true)
    expect(shouldPlayJingle('u1', 2027, s)).toBe(true)
  })
  it('never plays for nobody', () => { expect(shouldPlayJingle(undefined, 2026, mem())).toBe(false) })
  it('still works when storage is unavailable', () => { expect(shouldPlayJingle('u1', 2026, null)).toBe(true) })
})
