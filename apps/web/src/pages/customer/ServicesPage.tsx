import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '@/lib/api'
import { formatNaira } from '@/lib/utils'
import type { IdentityService, IdentityServiceCategory } from '@/types'
import { CATEGORY_LABEL, CATEGORY_ICON, CATEGORY_ORDER } from '@/lib/identityServices'
import { FallbackError } from '@/components/ui/FallbackError'
import { BottomNav } from '@/components/layout/BottomNav'
import { MANUAL_SERVICE_META } from '@/pages/customer/ManualServicePage'

function ServiceCard({ service, categoryIcon: CategoryIcon, onOpen, forceActive }: {
  service: IdentityService
  categoryIcon: typeof CATEGORY_ICON[IdentityServiceCategory]
  onOpen: () => void
  forceActive?: boolean
}) {
  const active = service.is_active || forceActive
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
        <p className="text-green-400 dark:text-night-300 text-[11px] mt-1">{formatNaira(service.price_kobo)}</p>
      </div>
    </button>
  )
}

export default function ServicesPage() {
  const navigate = useNavigate()
  // Present at two routes, same dual-purpose pattern as ServiceHistoryPage:
  // /customer/services (own, self-service) and
  // /officer/customers/:customerId/services/all (officer, on a customer's behalf)
  const { customerId } = useParams<{ customerId?: string }>()

  // No active_only filter — Coming Soon services need to be VISIBLE (as
  // disabled cards with Notify Me), not hidden entirely. Hiding them was
  // the actual bug behind "NIMC only shows two services".
  const { data: services = [], isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['identity-services', 'all'],
    queryFn: async () => {
      const { data } = await api.get<IdentityService[]>('/identity-services')
      return data
    },
  })

  const grouped = CATEGORY_ORDER
    .map(cat => ({ category: cat, services: services.filter(s => s.category === cat) }))
    .filter(g => g.services.length > 0)

  const requestPath = (serviceId: string) =>
    customerId
      ? `/officer/customers/${customerId}/services/${serviceId}/request`
      : `/customer/services/${serviceId}/request`

  // Airtime & data now has a real, dedicated flow (Monnify Bills Payment,
  // not the generic single-field form) — route straight there instead of
  // through the identity_services catalog row, which stays is_active=false
  // as a placeholder. Bill payments (electricity/cable/education) still
  // route through the generic flow until their own dedicated pages exist.
  const openService = (categoryKey: string, serviceId: string) => {
    if (categoryKey === 'airtime') {
      navigate(customerId ? `/officer/customers/${customerId}/airtime-data` : '/customer/airtime-data')
      return
    }
    if (categoryKey === 'bills') {
      // "Bill payments" now covers real electricity/cable via
      // BillPaymentPage — Education (JAMB/WAEC/NECO) is a genuinely
      // different flow with no account to validate, so it gets its own
      // card injected below rather than living under this same tile.
      navigate(customerId ? `/officer/customers/${customerId}/bill-payments` : '/customer/bill-payments')
      return
    }
    navigate(requestPath(serviceId))
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

      <div className="flex-1 overflow-y-auto px-4 pb-28">
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
                      key={s.id}
                      service={s}
                      categoryIcon={CategoryIcon}
                      // Airtime & data and Bill payments are real now even
                      // though their catalog rows are still is_active=false
                      // (legacy placeholders from before the dedicated
                      // Monnify flow existed) — force them open rather than
                      // showing "Coming soon" for a service that works.
                      forceActive={group.category === 'airtime' || group.category === 'bills'}
                      onOpen={() => openService(group.category, s.id)}
                    />
                  ))}
                  {/* Education Payments (JAMB/WAEC/NECO) has no catalog row
                      of its own — it's a distinct flow injected here rather
                      than forced into the generic Bill payments tile. */}
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

        {/* ── Manual Identity Services ── */}
        <div className="mb-6 px-4">
          <div className="flex items-center gap-2 mb-3 mt-2">
            <span className="text-base">🛠️</span>
            <p className="text-green-900 dark:text-white font-bold text-sm">Manual Identity Services</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {Object.entries(MANUAL_SERVICE_META).map(([key, svc]) => (
              <button
                key={key}
                onClick={() =>
                  customerId
                    ? navigate(`/officer/customers/${customerId}/manual-services/${key}`)
                    : navigate(`/customer/manual-services/${key}`)
                }
                className="flex flex-col items-start gap-2.5 bg-white dark:bg-night-700 border border-green-100 dark:border-night-500 rounded-2xl p-3.5 text-left active:scale-95 transition-transform"
              >
                <div className="w-9 h-9 rounded-xl bg-green-100 dark:bg-night-600 flex items-center justify-center text-lg">
                  {svc.emoji}
                </div>
                <div>
                  <p className="text-green-900 dark:text-white text-xs font-bold leading-tight">{svc.title}</p>
                  <p className="text-green-400 dark:text-night-300 text-[11px] mt-1 leading-tight line-clamp-2">{svc.description}</p>
                </div>
              </button>
            ))}
          </div>
        </div>

      {!customerId && <BottomNav />}
    </div>
  )
}
