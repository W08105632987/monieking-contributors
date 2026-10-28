import { describe, it, expect } from 'vitest'
import { dedupeServices, serviceKey } from './serviceCatalog'
import type { IdentityService } from '@/types'

const svc = (code: string, name: string, is_active = false): IdentityService =>
  ({ id: code, code, name, category: 'nimc', provider: 'manual', provider_endpoint: null, price_kobo: 0, is_active, required_fields: [], updated_at: '' }) as unknown as IdentityService

describe('serviceKey', () => {
  it('ignores spelling, case and punctuation', () => {
    expect(serviceKey('NIN Personalisation')).toBe(serviceKey('nin_personalization'))
    expect(serviceKey('IPE Clearance')).toBe(serviceKey('ipe-clearance'))
    expect(serviceKey('BVN CRM')).not.toBe(serviceKey('BVN retrieval'))
  })
})

describe('dedupeServices', () => {
  it('shows one tile per service, keeping the one with a template', () => {
    const list = [svc('nin_personalisation', 'NIN personalisation', true), svc('nin_personalization', 'NIN Personalization'), svc('tin_registration', 'TIN registration')]
    const out = dedupeServices(list, [{ service_code: 'nin_personalization', title: 'NIN Personalization', is_enabled: true, live: true }])
    expect(out.map((s) => s.code)).toEqual(['nin_personalization', 'tin_registration'])
  })
  it('keeps everything when nothing is duplicated', () => {
    const list = [svc('a_one', 'A one'), svc('b_two', 'B two')]
    expect(dedupeServices(list, undefined)).toHaveLength(2)
  })
})
