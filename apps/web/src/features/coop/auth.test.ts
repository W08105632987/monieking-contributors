import { describe, expect, it } from 'vitest'
import { newKey } from './auth'

describe('newKey', () => {
  it('makes a different key every time', () => {
    const a = newKey(), b = newKey()
    expect(a).not.toEqual(b)
    expect(a.length).toBeGreaterThan(10)
  })
})
