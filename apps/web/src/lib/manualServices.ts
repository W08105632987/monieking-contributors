import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { formatNaira } from '@/lib/utils'

/**
 * Single list of manual (worker-fulfilled) services.
 * Before this file the same list was copy-pasted into three pages and could drift.
 */
export const MANUAL_SERVICE_CODES = [
  'nin_modification',
  'nin_validation',
  'nin_delinking',
  'bvn_modification',
  'bvn_retrieval',
  'bvn_license',
  'tin_registration',
  'nin_attestation',
  'cac_registration',
  'self_service_modification',
] as const

/** Old / catalog codes that open the same manual service. */
export const SERVICE_KEY_ALIASES: Record<string, string> = {
  attestation: 'nin_attestation',
  bvn_license_onboarding: 'bvn_license',
  bvn_retrieval_phone: 'bvn_retrieval',
  bvn_retrieval_crm: 'bvn_retrieval',
  bvn_self_service_delinking: 'nin_delinking',
}

export function resolveManualKey(code: string): string {
  return SERVICE_KEY_ALIASES[code] || code
}

export function isManualService(code: string): boolean {
  return (MANUAL_SERVICE_CODES as readonly string[]).includes(resolveManualKey(code))
}

export interface ManualPricingConfig {
  pricing: Record<string, Record<string, number>>
  cover_labels: Record<string, string>
}

/** Prices come from the backend (the same table the charge uses). Never hardcode them in a form. */
export function useManualPricing() {
  const query = useQuery({
    queryKey: ['manual-services-pricing'],
    queryFn: async () => {
      const { data } = await api.get<ManualPricingConfig>('/manual-services/pricing')
      return data
    },
    staleTime: 30_000,
  })
  const pricing = query.data?.pricing

  /** Price in kobo for one option, or null while loading / not configured. */
  const priceOf = (category: string, tier: string): number | null => {
    const cat = pricing?.[resolveManualKey(category)]
    if (!cat) return null
    const v = cat[tier] ?? cat.default
    return typeof v === 'number' && v > 0 ? v : null
  }
  return { ...query, config: query.data, priceOf }
}

/** "₦5,000.00" or "" when the price is not known yet (never a made-up number). */
export function priceLabel(kobo: number | null | undefined): string {
  return kobo && kobo > 0 ? formatNaira(kobo) : ''
}
