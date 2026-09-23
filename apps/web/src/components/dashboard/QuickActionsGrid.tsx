import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ChevronRight, Plus, History, LayoutGrid } from 'lucide-react'
import toast from 'react-hot-toast'
import { FallbackError } from '@/components/ui/FallbackError'
import { api } from '@/lib/api'
import type { IdentityService, IdentityServiceCategory } from '@/types'
import { CATEGORY_LABEL, CATEGORY_ICON, CATEGORY_ORDER } from '@/lib/identityServices'

interface QuickActionsGridProps {
  /** When set, this is an officer submitting on a customer's behalf —
   * routes to the officer request path and hides the Contribution/History
   * buttons (redundant when already embedded inside that customer's
   * service history page). */
  customerId?: string
  title?: string
}

function SheetRow({ service, onOpen }: { service: IdentityService; onOpen: () => void }) {
  return (
    <button
      onClick={service.is_active ? onOpen : () => toast('This service is not available right now. Please check back later!')}
      className="w-full flex items-center justify-between px-4 py-4 text-left"
    >
      <span className="text-green-900 dark:text-white text-sm font-medium">{service.name}</span>
      <ChevronRight className="w-4 h-4 text-green-300 dark:text-night-400" />
    </button>
  )
}

export function QuickActionsGrid({ customerId, title = 'Quick actions' }: QuickActionsGridProps = {}) {
  const navigate = useNavigate()
  const [openCategory, setOpenCategory] = useState<IdentityServiceCategory | null>(null)

  // No active_only filter — Coming Soon services need to be visible (with
  // a Notify Me action), not silently hidden. Hiding them was the actual
  // bug behind "NIMC only shows two services" — three more were already
  // seeded, just filtered out before they ever reached the UI.
  const { data: services = [], isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['identity-services', 'all'],
    queryFn: async () => {
      const { data } = await api.get<IdentityService[]>('/identity-services')
      return data
    },
  })

  // Grid shows 7 real categories + one "More" tile = 8 slots, matching the
  // original tile count. "Become a vendor" moved into the full Services
  // catalog (reachable via More) rather than taking a grid slot — it's a
  // less-frequent action than the other seven.
  const gridCategories = CATEGORY_ORDER.filter(c => c !== 'vendor')
  const grid = gridCategories.map(cat => ({
    category: cat,
    services: services.filter(s => s.category === cat),
  }))

  const openGroup = grid.find(g => g.category === openCategory)
  const liveCount = services.filter(s => s.is_active).length

  const requestPath = (serviceId: string) =>
    customerId
      ? `/officer/customers/${customerId}/services/${serviceId}/request`
      : `/customer/services/${serviceId}/request`

  const servicesPath = customerId ? `/officer/customers/${customerId}/services/all` : '/customer/services'

  const handleTap = (group: { category: IdentityServiceCategory; services: IdentityService[] }) => {
    // Airtime & data and Bill payments have real, dedicated flows now
    // (AirtimeDataPage / BillPaymentPage) — route straight there
    // instead of through the identity_services catalog sheet, which
    // has no seeded rows for these two categories and was showing
    // "Coming soon" as a result. ServicesPage.tsx already had this
    // exact special-case; QuickActionsGrid never got the same fix when
    // those pages shipped, so tapping the grid tile and tapping the
    // same category from the full Services catalog led to two
    // different outcomes for the same feature.
    if (group.category === 'airtime') {
      navigate(customerId ? `/officer/customers/${customerId}/airtime-data` : '/customer/airtime-data')
      return
    }
    if (group.category === 'bills') {
      navigate(customerId ? `/officer/customers/${customerId}/bill-payments` : '/customer/bill-payments')
      return
    }
    // Only skip straight to the form when there's exactly one service in
    // the category AND it's actually live — otherwise (multiple services,
    // or the one service is Coming Soon) always open the sheet, so a
    // Coming Soon service is never silently unreachable.
    if (group.services.length === 1 && group.services[0].is_active) {
      navigate(requestPath(group.services[0].id))
    } else {
      setOpenCategory(group.category)
    }
  }

  return (
    <div className="mt-6">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-green-900 dark:text-white font-bold text-base">{title}</h2>
        {!isLoading && !isError && (
          <span className="text-green-400 dark:text-night-300 text-xs font-medium">
            {liveCount} service{liveCount === 1 ? '' : 's'} live
          </span>
        )}
      </div>

      {isError ? (
        <FallbackError
          title="Couldn't load quick actions"
          onRetry={() => refetch()}
          isRetrying={isFetching}
        />
      ) : isLoading ? (
        <div className="grid grid-cols-4 gap-x-2 gap-y-4">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="flex flex-col items-center gap-1.5">
              <div className="w-14 h-14 rounded-2xl bg-green-100 dark:bg-night-600 animate-pulse" />
              <div className="w-10 h-2.5 rounded bg-green-100 dark:bg-night-600 animate-pulse" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-x-2 gap-y-4">
          {grid.map(group => {
            const Icon = CATEGORY_ICON[group.category]
            // Tile itself reads as "live" if the category has AT LEAST ONE
            // active service — even if some of its services are still
            // Coming Soon (e.g. NIMC: 2 live + 3 Coming Soon still reads
            // as a live category, just tap in to see the mix).
            // Airtime & bills are always live regardless of the
            // identity_services catalog — they route to their own real
            // pages now (see handleTap), not through that catalog at all,
            // so their "live" status was never actually tied to catalog
            // rows that don't represent them.
            const isLive = group.category === 'airtime' || group.category === 'bills' || group.services.some(s => s.is_active)
            return (
              <button
                key={group.category}
                onClick={() => handleTap(group)}
                className="flex flex-col items-center gap-1.5 active:scale-95 transition-transform"
              >
                <div
                  className={`relative w-14 h-14 rounded-2xl flex items-center justify-center ${
                    isLive ? 'bg-green-100 dark:bg-night-600' : 'bg-green-50 dark:bg-night-700 border border-dashed border-green-200 dark:border-night-500'
                  }`}
                >
                  <Icon className={`w-6 h-6 ${isLive ? 'text-green-800 dark:text-night-100' : 'text-green-300 dark:text-night-400'}`} />
                  {!isLive && (
                    <span className="absolute -top-1.5 -right-1.5 bg-amber-400 text-green-900 text-[8px] font-bold px-1.5 py-0.5 rounded-full">
                      Soon
                    </span>
                  )}
                </div>
                <span
                  className={`text-[11px] font-semibold text-center leading-tight ${
                    isLive ? 'text-green-900 dark:text-white' : 'text-green-400 dark:text-night-300'
                  }`}
                >
                  {CATEGORY_LABEL[group.category]}
                </span>
              </button>
            )
          })}

          {/* "More" — always the last tile, always live, goes to the full catalog */}
          <button
            onClick={() => navigate(servicesPath)}
            className="flex flex-col items-center gap-1.5 active:scale-95 transition-transform"
          >
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center bg-green-100 dark:bg-night-600">
              <LayoutGrid className="w-6 h-6 text-green-800 dark:text-night-100" />
            </div>
            <span className="text-[11px] font-semibold text-center leading-tight text-green-900 dark:text-white">
              More
            </span>
          </button>
        </div>
      )}

      {/* two action buttons — sized and aligned to the SAME grid tracks as
          the icon grid above (grid-cols-4, gap-2, col-span-2 each) so their
          edges land exactly where the tiles above start/end, instead of an
          independent 50/50 split that only coincidentally lined up */}
      {!customerId && (
        <div className="grid grid-cols-4 gap-2 mt-5">
          <button
            onClick={() => navigate('/customer/cards')}
            className="col-span-2 flex items-center gap-2 bg-white dark:bg-night-700 border border-green-100 dark:border-night-500 rounded-2xl px-3 py-2.5 active:scale-95 transition-transform"
          >
            <div className="w-8 h-8 rounded-lg bg-green-100 dark:bg-night-600 flex items-center justify-center flex-shrink-0">
              <Plus className="w-4 h-4 text-green-800 dark:text-night-100" />
            </div>
            <span className="text-green-900 dark:text-white text-xs font-bold text-left leading-tight truncate">Contribution</span>
          </button>
          <button
            onClick={() => navigate('/customer/services/history')}
            className="col-span-2 flex items-center gap-2 bg-white dark:bg-night-700 border border-green-100 dark:border-night-500 rounded-2xl px-3 py-2.5 active:scale-95 transition-transform"
          >
            <div className="w-8 h-8 rounded-lg bg-amber-300/20 dark:bg-night-600 flex items-center justify-center flex-shrink-0">
              <History className="w-4 h-4 text-amber-500 dark:text-night-100" />
            </div>
            <span className="text-green-900 dark:text-white text-xs font-bold text-left leading-tight truncate">History</span>
          </button>
        </div>
      )}

      {/* sub-service FULL-SCREEN modal — live services navigate, Coming
          Soon ones show inline with their own Notify Me action */}
      {openGroup && (
        <div className="fixed inset-0 z-50 flex flex-col bg-green-50 dark:bg-night-800">
          <header className="flex items-center gap-3 px-4 py-3 flex-shrink-0">
            <button onClick={() => setOpenCategory(null)} className="w-9 h-9 bg-green-100 dark:bg-night-600 rounded-xl flex items-center justify-center">
              <ArrowLeft className="w-4 h-4 text-green-700 dark:text-night-100" />
            </button>
            <h3 className="text-green-900 dark:text-white font-bold text-lg">{CATEGORY_LABEL[openGroup.category]}</h3>
          </header>
          <div className="flex-1 overflow-y-auto px-4 pb-8">
            {openGroup.services.length === 0 ? (
              <div className="text-center py-16">
                <p className="text-green-700 dark:text-night-100 text-sm font-semibold mb-1">Service not available</p>
                <p className="text-green-400 dark:text-night-300 text-xs">
                  This service is not available right now. Please check back later, thank you!
                </p>
              </div>
            ) : (
              <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 divide-y divide-green-100 dark:divide-night-500 mt-1">
                {openGroup.services.map(s => (
                  <SheetRow key={s.id} service={s} onOpen={() => navigate(requestPath(s.id))} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
