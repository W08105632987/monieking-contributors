import { describe, it, expect } from 'vitest'
import { resolveBrand, rgba, brandWash, initialsOf } from './billerBrand'

describe('resolveBrand', () => {
  it.each([
    ['Ikeja Electric', 'ikedc'], ['IKEDC', 'ikedc'], ['Ikeja Electricity Distribution Company', 'ikedc'],
    ['Eko Electricity Distribution Company', 'eko'], ['EKEDC PREPAID', 'ekedc'],
    ['Abuja Electricity Distribution Company', 'aedc'], ['AEDC', 'aedc'],
    ['Kaduna Electric', 'kaduna'], ['KAEDCO', 'kaduna'], ['Kano Electricity Distribution Company', 'kano'],
    ['Port Harcourt Electricity Distribution Company', 'phed'], ['Yola Electricity Distribution Company', 'yedc'],
    ['Benin Electricity Distribution Company', 'bedc'], ['Ibadan Electricity Distribution Company', 'ibedc'],
    ['Jos Electricity Distribution Company', 'jos'],
    ['DSTV', 'dstv'], ['GOtv', 'gotv'], ['StarTimes', 'startimes'], ['ShowMax TV', 'showmax'],
    ['JAMB', 'jamb'], ['WAEC', 'waec'],
  ])('%s -> %s', (name, key) => {
    expect(resolveBrand(name).key).toBe(key)
  })

  it('does not confuse short names with longer ones (KAEDCO is not AEDC, Taraba is not Aba)', () => {
    expect(resolveBrand('KAEDCO').key).toBe('kaduna')
    expect(resolveBrand('Taraba State University').key.startsWith('x-')).toBe(true)
  })

  it('gives unknown providers a stable colour and initials, and no logo', () => {
    const a = resolveBrand('Some New Provider')
    const b = resolveBrand('Some New Provider')
    expect(a.main).toBe(b.main)
    expect(a.logo).toBeNull()
    expect(a.initials).toBe('SN')
    expect(a.main).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('has logo files only for providers that have one', () => {
    expect(resolveBrand('Ikeja Electric').logo).toBe('/billers/electricity/ikedc.png')
    expect(resolveBrand('Enugu Electricity Distribution Company').logo).toBeNull()
  })
})

describe('colour helpers', () => {
  it('builds rgba and a wash from a hex colour', () => {
    expect(rgba('#FFCB05', 0.5)).toBe('rgba(255,203,5,0.5)')
    expect(brandWash({ main: '#00A551' })).toContain('rgba(0,165,81,0.3)')
  })
  it('makes initials', () => {
    expect(initialsOf('Eko Electricity')).toBe('EE')
    expect(initialsOf('JAMB')).toBe('JA')
    expect(initialsOf('')).toBe('?')
  })
})
