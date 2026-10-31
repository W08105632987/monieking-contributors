import { describe, it, expect } from 'vitest'
import { computeKeyboardInset, KEYBOARD_MIN_INSET } from './keyboardLayout'

describe('computeKeyboardInset', () => {
  it('is zero when nothing covers the screen', () => {
    expect(computeKeyboardInset(800, 800, 0)).toBe(0)
  })
  it('is the height of the keyboard when it covers the bottom (iPhone style)', () => {
    expect(computeKeyboardInset(800, 480, 0)).toBe(320)
  })
  it('accounts for the page being scrolled up inside the visible area', () => {
    expect(computeKeyboardInset(800, 480, 40)).toBe(280)
  })
  it('never goes negative (pinch-zoom, rotation)', () => {
    expect(computeKeyboardInset(800, 900, 0)).toBe(0)
  })
  it('treats a small browser-bar change as not a keyboard', () => {
    expect(computeKeyboardInset(800, 740, 0)).toBeLessThan(KEYBOARD_MIN_INSET)
  })
})
