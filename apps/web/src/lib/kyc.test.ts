import { describe, it, expect } from 'vitest'
import { needsKyc, kycPath } from './kyc'

describe('kyc gate', () => {
  it('gates customers and officers without NIN', () => {
    expect(needsKyc({ role: 'customer', nin_linked: false, bvn_linked: false })).toBe(true)
    expect(needsKyc({ role: 'officer', nin_linked: false, bvn_linked: false })).toBe(true)
  })
  it('lets verified users and other roles through', () => {
    expect(needsKyc({ role: 'customer', nin_linked: true, bvn_linked: false })).toBe(false)
    expect(needsKyc({ role: 'director', nin_linked: false, bvn_linked: false })).toBe(false)
    expect(needsKyc(null)).toBe(false)
  })
  it('routes by role', () => {
    expect(kycPath('officer')).toBe('/officer/kyc')
    expect(kycPath('customer')).toBe('/customer/kyc')
  })
})
