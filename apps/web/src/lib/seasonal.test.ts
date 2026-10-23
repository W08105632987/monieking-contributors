import { describe, it, expect } from 'vitest'
import { activeSeason } from './seasonal'

const off = { christmas: false, new_year: false, easter: false }

describe('activeSeason', () => {
  it('is null when everything is off', () => expect(activeSeason(off, new Date(2026, 11, 25))).toBeNull())
  it('shows christmas when on', () => expect(activeSeason({ ...off, christmas: true }, new Date(2026, 11, 25))).toBe('christmas'))
  it('swaps to new year in January only when the sub-setting is on', () => {
    expect(activeSeason({ ...off, christmas: true, new_year: true }, new Date(2027, 0, 2))).toBe('newyear')
    expect(activeSeason({ ...off, christmas: true }, new Date(2027, 0, 2))).toBe('christmas')
    expect(activeSeason({ ...off, christmas: true, new_year: true }, new Date(2026, 11, 31))).toBe('christmas')
  })
  it('new year alone does nothing', () => expect(activeSeason({ ...off, new_year: true }, new Date(2027, 0, 2))).toBeNull())
  it('easter wins', () => expect(activeSeason({ christmas: true, new_year: false, easter: true })).toBe('easter'))
})
