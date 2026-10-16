import { describe, expect, it } from 'vitest'
import { mainHomePath, notificationsPath, profilePath } from './nav'

describe('cooperative header navigation', () => {
  it('sends each role to its own main-app home, never to the cooperative', () => {
    expect(mainHomePath('customer')).toBe('/customer/dashboard')
    expect(mainHomePath('officer')).toBe('/officer/dashboard')
    expect(mainHomePath('director')).toBe('/director/dashboard')
    expect(mainHomePath('service_worker')).toBe('/worker/dashboard')
  })
  it('falls back to the customer area for an unknown or missing role', () => {
    expect(mainHomePath(undefined)).toBe('/customer/dashboard')
    expect(mainHomePath('something_else')).toBe('/customer/dashboard')
  })
  it('keeps profile and notifications inside the same role area', () => {
    expect(profilePath('director')).toBe('/director/profile')
    expect(notificationsPath('officer')).toBe('/officer/notifications')
    expect(profilePath('customer')).toBe('/customer/profile')
  })
})
