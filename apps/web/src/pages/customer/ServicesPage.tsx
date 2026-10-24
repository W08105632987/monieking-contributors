import { useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import toast from '@/lib/notify'
import { api } from '@/lib/api'
import { formatNaira } from '@/lib/utils'
import { useIsManualService, useTemplateList, resolveManualKey } from '@/lib/manualServices'
import type { IdentityService, IdentityServiceCategory } from '@/types'
import { CATEGORY_LABEL, CATEGORY_ICON, CATEGORY_ORDER } from '@/lib/identityServices'
import { FallbackError } from '@/components/ui/FallbackError'
import { normalizeServices } from '@/lib/serviceCatalog'

// Phase 1 keeps the existing behaviour: these cards are always shown as open.
// (The director's on/off switch takes over in the template-engine phase.)
const ALWAYS_OPEN = new Set([
  'nin_modification', 'nin_validation', 'nin_delinking', 'bvn_retrieval', 'bvn_modification',
  'bvn_license_onboarding', 'tin_registration', 'attestation', 'cac_registration',
])

function ServiceCard({
  service,
  categoryIcon: CategoryIcon,
  onOpen,
  forceActive,
  coverLabel,
  fromPrice,
}: {
  service: IdentityService
  categoryIcon: typeof CATEGORY_ICON[IdentityServiceCategory]
  onOpen: () => void
  forceActive?: boolean
  coverLabel?: string
  fromPrice?: number | null   // services built in the Service Builder: the real lowest charge
}) {
  const isManualService = useIsManualService()
  const active = service.is_active || forceActive

  // Display price: if director set custom alphanumeric label, show it; else fallback
  const priceDisplay = (() => {
    // Manual services: the label comes from the backend (director's text, or the live "From ₦X").
    if (coverLabel) {
      return coverLabel
    }
    if (fromPrice && fromPrice > 0) {
      return `From ${formatNaira(fromPrice)}`
    }
    if (isManualService(service.code)) {
      return ''
    }
    if (service.price_kobo > 0) {
      return formatNaira(service.price_kobo)
    }
    return active ? 'Dynamic pricing' : 'Coming soon'
  })()

  return (
    <button
      onClick={active ? onOpen : () => toast('This service is not available right now. Please check back later!')}
      className="flex flex-col items-start gap-2.5 bg-white dark:bg-night-700 border border-green-100 dark:border-night-500 rounded-2xl p-3.5 text-left active:scale-95 transition-transform"
    >
      <div className="w-9 h-9 rounded-xl bg-green-100 dark:bg-night-600 flex items-center justify-center">
        <CategoryIcon className="w-4.5 h-4.5 text-green-800 dark:text-night-100" />
      </div>
      <div>
        <p className="text-green-900 dark:text-white text-xs font-bold leading-tight">{service.name}</p>
        <p className="text-green-500 dark:text-night-300 text-[11px] font-semibold mt-1">{priceDisplay}</p>
      </div>
    </button>
  )
}

export default function ServicesPage() {
  const navigate = useNavigate()
  const { customerId } = useParams<{ customerId?: string }>()

  const { data: rawServices = [], isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['identity-services', 'all'],
    queryFn: async () => {
      const { data } = await api.get<IdentityService[]>('/identity-services')
      return data
    },
  })

  const { data: pricingConfig } = useQuery({
    queryKey: ['manual-services-pricing'],
    queryFn: async () => {
      const { data } = await api.get<{
        pricing: Record<string, Record<string, number>>
        cover_labels: Record<string, string>
      }>('/manual-services/pricing')
      return data
    },
  })

  // The director's on/off switch for manual services lives on the service template.
  // If this can't be loaded we fall back to the old behaviour (cards open), never to "all off".
  const { data: templateList } = useTemplateList()
  const isManualService = useIsManualService()
  const builderFromPrice = (code: string): number | null => {
    const t = templateList?.find((x) => x.service_code === resolveManualKey(code))
    return t && t.has_original_form === false ? (t.from_price_kobo ?? null) : null
  }
  const templateEnabled = (code: string): boolean | undefined =>
    templateList?.find((t) => t.service_code === resolveManualKey(code))?.is_enabled

  const services = useMemo(() => normalizeServices(rawServices, templateList), [rawServices, templateList])

  const grouped = CATEGORY_ORDER
    .map(cat => ({ category: cat, services: services.filter(s => s.category === cat) }))
    .filter(g => g.services.length > 0)

  const requestPath = (serviceIdentifier: string) =>
    customerId
      ? `/officer/customers/${customerId}/services/${serviceIdentifier}/request`
      : `/customer/services/${serviceIdentifier}/request`

  const openService = (categoryKey: string, service: IdentityService) => {
    if (categoryKey === 'airtime') {
      navigate(customerId ? `/officer/customers/${customerId}/airtime-data` : '/customer/airtime-data')
      return
    }
    if (categoryKey === 'bills') {
      navigate(customerId ? `/officer/customers/${customerId}/bill-payments` : '/customer/bill-payments')
      return
    }

    // Direct routing for manual services to avoid intermediate re-renders
    const code = service.code === 'bvn_retrieval_phone' || service.code === 'bvn_retrieval_crm' ? 'bvn_retrieval' : service.code
    if (isManualService(code)) {
      navigate(
        customerId
          ? `/officer/customers/${customerId}/manual-services/${code}`
          : `/customer/manual-services/${code}`
      )
      return
    }

    // Route to canonical service request path with service ID (or code)
    navigate(requestPath(service.id || service.code))
  }

  const openEducationPayments = () =>
    navigate(customerId ? `/officer/customers/${customerId}/education-payments` : '/customer/education-payments')

  return (
    <div className="min-h-dvh flex flex-col bg-green-50 dark:bg-night-800">
      <header className="flex items-center gap-3 px-4 py-3">
        <button onClick={() => navigate(-1)} className="w-9 h-9 bg-green-100 dark:bg-night-600 rounded-xl flex items-center justify-center">
          <ArrowLeft className="w-4 h-4 text-green-700 dark:text-night-100" />
        </button>
        <h1 className="text-green-900 dark:text-white font-bold text-lg">All services</h1>
      </header>

      <div className="flex-1 overflow-y-auto px-4 pb-safe-nav">
        {isError ? (
          <FallbackError
            title="Couldn't load services"
            onRetry={() => refetch()}
            isRetrying={isFetching}
          />
        ) : isLoading ? (
          <div className="grid grid-cols-2 gap-3 mt-2">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-24 bg-white dark:bg-night-700 rounded-2xl animate-pulse" />
            ))}
          </div>
        ) : grouped.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-green-700 dark:text-night-100 text-sm font-semibold">Nothing available yet</p>
          </div>
        ) : (
          grouped.map(group => {
            const CategoryIcon = CATEGORY_ICON[group.category as IdentityServiceCategory]
            return (
              <div key={group.category} className="mb-6">
                <div className="flex items-center gap-2 mb-3 mt-1">
                  <CategoryIcon className="w-4 h-4 text-green-600 dark:text-night-200" />
                  <p className="text-green-900 dark:text-white font-bold text-sm">
                    {CATEGORY_LABEL[group.category as IdentityServiceCategory]}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {group.services.map(s => (
                    <ServiceCard
                      key={s.id || s.code}
                      service={s}
                      categoryIcon={CategoryIcon}
                      coverLabel={pricingConfig?.cover_labels?.[s.code] || pricingConfig?.cover_labels?.[resolveManualKey(s.code)]}
                      fromPrice={builderFromPrice(s.code)}
                      forceActive={
                        group.category === 'airtime' ||
                        group.category === 'bills' ||
                        templateEnabled(s.code) === undefined && ALWAYS_OPEN.has(s.code)
                      }
                      onOpen={() => openService(group.category, s)}
                    />
                  ))}
                  {/* Education Payments (JAMB/WAEC/NECO) */}
                  {group.category === 'bills' && (
                    <button
                      onClick={openEducationPayments}
                      className="rounded-2xl border border-green-100 dark:border-night-500 bg-white dark:bg-night-700 p-4 text-left"
                    >
                      <p className="text-green-900 dark:text-white font-bold text-sm">Education Payments</p>
                      <p className="text-green-400 dark:text-night-300 text-xs mt-1">JAMB, WAEC, NECO</p>
                    </button>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
