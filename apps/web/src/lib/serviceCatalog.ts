import type { IdentityService } from '@/types'
import { resolveManualKey, type TemplateListItem } from '@/lib/manualServices'

// These cards are always shown as open unless the director's switch (service template) says otherwise.
const ALWAYS_OPEN = new Set([
  'nin_modification', 'nin_validation', 'nin_delinking', 'bvn_retrieval', 'bvn_modification',
  'bvn_license_onboarding', 'tin_registration', 'attestation', 'cac_registration',
])

/** "NIN Personalisation", "nin_personalization" and "NIN  personalization" are the same service. */
export function serviceKey(text: string): string {
  return (text || '').toLowerCase().replace(/[^a-z0-9]+/g, '').replace(/isation/g, 'ization').replace(/ise/g, 'ize')
}

/**
 * One tile per service. The same service listed twice (different code or spelling) keeps the copy that has a
 * switch of its own (a template), then an active one, then the first. Extra copies never reach a customer.
 */
export function dedupeServices<T extends { service_code: string }>(
  list: IdentityService[],
  templateList: T[] | undefined,
): IdentityService[] {
  const exactTemplate = (s: IdentityService) => !!templateList?.some((t) => t.service_code === s.code)
  const aliasTemplate = (s: IdentityService) => !!templateList?.some((t) => t.service_code === resolveManualKey(s.code))
  const best = new Map<string, IdentityService>()
  for (const s of list) {
    const k = serviceKey(s.name) || serviceKey(s.code)
    const cur = best.get(k)
    const rank = (x: IdentityService) => (exactTemplate(x) ? 4 : aliasTemplate(x) ? 2 : 0) + (x.is_active ? 1 : 0)
    if (!cur || rank(s) > rank(cur)) best.set(k, s)
  }
  const keep = new Set(best.values())
  return list.filter((s) => keep.has(s))
}

/**
 * The ONE place the service catalog is cleaned up and switched on/off. Both the
 * Services page and the dashboard quick-action grid use it, so a service that is
 * turned off (or filed under NIN rather than BVN) looks the same everywhere.
 */
export function normalizeServices(rawServices: IdentityService[], templateList: TemplateListItem[] | undefined): IdentityService[] {
  const templateEnabled = (code: string): boolean | undefined =>
    templateList?.find((t) => t.service_code === resolveManualKey(code))?.is_enabled
  const list: IdentityService[] = []
  let seenBvnRetrieval = false
  let hasCacRegistration = false
  let hasNinDelinking = false

  for (const s of rawServices) {
    // Overload check: combine bvn_retrieval_phone and bvn_retrieval_crm into one
    if (s.code === 'bvn_retrieval_phone' || s.code === 'bvn_retrieval_crm' || s.code === 'bvn_retrieval') {
      if (!seenBvnRetrieval) {
        list.push({
          ...s,
          code: 'bvn_retrieval',
          name: 'BVN retrieval',
          is_active: templateEnabled('bvn_retrieval') ?? true,
        })
        seenBvnRetrieval = true
      }
      continue
    }

    // NIN-side services that old catalogs filed under BVN: show them under
    // NIN services (NIMC), everywhere. Self-service delinking is the same
    // thing as "NIN delinking", so it is folded into that card.
    if (s.code === 'bvn_self_service_delinking') continue
    if (s.code === 'nin_personalisation') continue
    if (s.code === 'ipe_clearance') {
      list.push({ ...s, category: 'nimc' as IdentityService['category'] })
      continue
    }

    if (s.code === 'cac_registration') hasCacRegistration = true
    if (s.code === 'nin_delinking') hasNinDelinking = true

    // Activate all manual services
    const switched = templateEnabled(s.code)
    if (switched !== undefined) {
      // a service template exists: the director's switch decides
      list.push({ ...s, is_active: switched })
    } else if (ALWAYS_OPEN.has(s.code)) {
      list.push({ ...s, is_active: true })
    } else {
      list.push(s)
    }
  }

  // Ensure CAC registration card exists under CAC+
  if (!hasCacRegistration) {
    list.push({
      id: 'cac_registration',
      category: 'cac',
      code: 'cac_registration',
      name: 'CAC registration',
      description: 'Business name and company registration',
      provider: 'manual',
      provider_endpoint: null,
      price_kobo: 0,
      is_active: templateEnabled('cac_registration') ?? true,
      required_fields: [],
      updated_at: new Date().toISOString(),
    })
  }

  // Ensure NIN delinking exists under NIMC
  if (!hasNinDelinking) {
    list.push({
      id: 'nin_delinking',
      category: 'nimc',
      code: 'nin_delinking',
      name: 'NIN delinking',
      description: 'Delink phone or SIM from NIN',
      provider: 'manual',
      provider_endpoint: null,
      price_kobo: 0,
      is_active: templateEnabled('nin_delinking') ?? true,
      required_fields: [],
      updated_at: new Date().toISOString(),
    })
  }

  return dedupeServices(list, templateList)
}
