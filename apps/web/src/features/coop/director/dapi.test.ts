import { describe, expect, it } from 'vitest'
import { showValue } from './dapi'

describe('showValue', () => {
  it('shows money, percent and switches in friendly units', () => {
    expect(showValue({ kind: 'kobo', value: '5000000' })).toBe('₦50,000')
    expect(showValue({ kind: 'bps', value: '1000' })).toBe('10%')
    expect(showValue({ kind: 'bps', value: '300' })).toBe('3%')
    expect(showValue({ kind: 'bool', value: 'true' })).toBe('On')
    expect(showValue({ kind: 'bool', value: 'false' })).toBe('Off')
    expect(showValue({ kind: 'str', value: '' })).toBe('—')
  })
})
