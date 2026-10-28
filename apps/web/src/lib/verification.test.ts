import { describe, it, expect } from 'vitest'
import {
  METHODS, validateFields, fieldsFor, maskId, initialsOf, slipOptions, availability, feeFor, consentText,
  expiryText, isNinKind, type VerifyStatus,
} from './verification'

const status = (over: Partial<VerifyStatus> = {}): VerifyStatus => ({
  enabled: true, retention_hours: 24, nin_auth_url: null,
  fees: { nin: 100, phone: 100, demographic: 100, bvn: 100 },
  slips: {}, services: { nin: { available: true, reason: null, retry_at: null }, bvn: { available: true, reason: null, retry_at: null } },
  ...over,
})

describe('methods', () => {
  it('NIN has exactly three methods, BVN one, no vNIN', () => {
    expect(METHODS.nin.map(m => m.id)).toEqual(['nin', 'phone', 'demographic'])
    expect(METHODS.bvn.map(m => m.id)).toEqual(['bvn'])
  })
  it('phone method asks for phone only', () => {
    expect(METHODS.nin[1].fields.map(f => f.key)).toEqual(['phone'])
  })
  it('demographic makes gender optional', () => {
    const g = METHODS.nin[2].fields.find(f => f.key === 'gender')!
    expect(g.required).toBe(false)
  })
})

describe('validateFields', () => {
  it('NIN/BVN need 11 digits', () => {
    expect(validateFields('nin', 'nin', { nin: '12345678901' })).toBeNull()
    expect(validateFields('nin', 'nin', { nin: '1234567890' })).toMatch(/11-digit/)
    expect(validateFields('bvn', 'bvn', { bvn: '' })).toMatch(/Enter/)
  })
  it('phone accepts local and +234 forms', () => {
    for (const p of ['08012345678', '+2348012345678', '2348012345678', '8012345678']) {
      expect(validateFields('phone', 'nin', { phone: p })).toBeNull()
    }
    expect(validateFields('phone', 'nin', { phone: '12345' })).toMatch(/phone/)
  })
  it('demographic', () => {
    const ok = { firstname: 'John', lastname: "O'Neil", dob: '1985-05-15' }
    expect(validateFields('demographic', 'nin', ok)).toBeNull()
    expect(validateFields('demographic', 'nin', { ...ok, firstname: 'J0hn' })).toMatch(/first name/)
    expect(validateFields('demographic', 'nin', { ...ok, dob: '2999-01-01' })).toMatch(/date of birth/)
    expect(validateFields('demographic', 'nin', { ...ok, dob: '' })).toMatch(/date of birth/i)
  })
})

describe('fieldsFor', () => {
  it('sends only the chosen method fields', () => {
    const v = { nin: '12345678901', phone: '08012345678', firstname: 'A' }
    expect(fieldsFor('phone', 'nin', v)).toEqual({ phone: '08012345678' })
    expect(fieldsFor('nin', 'nin', v)).toEqual({ nin: '12345678901' })
  })
  it('drops empty optional fields', () => {
    expect(fieldsFor('demographic', 'nin', { firstname: 'A', lastname: 'B', dob: '1990-01-01', gender: '' }))
      .toEqual({ firstname: 'A', lastname: 'B', dob: '1990-01-01' })
  })
})

describe('masking and initials', () => {
  it('masks the middle only', () => {
    expect(maskId('12345678901')).toBe('123•••••901')
    expect(maskId('')).toBe('')
  })
  it('initials', () => {
    expect(initialsOf('John Michael Doe')).toBe('JD')
    expect(initialsOf('  ')).toBe('?')
    expect(initialsOf('Ada')).toBe('A')
  })
})

describe('slipOptions', () => {
  it('never offers an unpriced tier', () => {
    expect(slipOptions(status(), 'nin')).toEqual([])
    const s = status({ slips: { 'nin.regular': 5000, 'nin.premium': 9000 } })
    expect(slipOptions(s, 'nin').map(o => o.tier)).toEqual(['regular', 'premium'])
  })
  it('BVN has no regular tier', () => {
    const s = status({ slips: { 'bvn.regular': 1, 'bvn.standard': 2000 } })
    expect(slipOptions(s, 'bvn').map(o => o.tier)).toEqual(['standard'])
  })
  it('owned tiers are free and stay visible even if price later removed', () => {
    const o = slipOptions(status(), 'nin', ['premium'])
    expect(o).toEqual([{ tier: 'premium', price: 0, owned: true }])
  })
})

describe('availability and fees', () => {
  it('off / unavailable / available', () => {
    expect(availability(undefined, 'nin')).toBe('off')
    expect(availability(status({ enabled: false }), 'nin')).toBe('off')
    expect(availability(status({ services: { nin: { available: false, reason: 'unavailable', retry_at: null }, bvn: { available: true, reason: null, retry_at: null } } }), 'nin')).toBe('unavailable')
    expect(availability(status(), 'bvn')).toBe('available')
  })
  it('fee is null when unset', () => {
    expect(feeFor(status({ fees: {} }), 'nin')).toBeNull()
    expect(feeFor(status(), 'nin')).toBe(100)
  })
})

describe('copy', () => {
  it('BVN consent is stricter and states retention', () => {
    expect(consentText('bvn', 24)).toMatch(/highly sensitive/)
    expect(consentText('bvn', 24)).toMatch(/24 hours/)
    expect(consentText('nin', 6)).toMatch(/6 hours/)
    expect(consentText('nin', 6)).not.toMatch(/highly sensitive/)
  })
  it('expiry text', () => {
    const now = new Date('2026-01-01T00:00:00Z')
    expect(expiryText('2026-01-01T05:12:00Z', now)).toBe('Kept for 5h 12m more')
    expect(expiryText('2026-01-01T00:20:00Z', now)).toBe('Kept for 20m more')
    expect(expiryText('2025-12-31T00:00:00Z', now)).toBe('Expired')
  })
  it('kind guard', () => {
    expect(isNinKind('nin')).toBe(true)
    expect(isNinKind('vnin')).toBe(false)
  })
})

describe('keep forever', () => {
  it('words the consent without an hours limit', () => {
    expect(consentText('nin', 24, true)).toMatch(/not deleted/)
    expect(consentText('nin', 24, true)).not.toMatch(/hours/)
    expect(consentText('nin', 24)).toMatch(/24 hours/)
  })
})
