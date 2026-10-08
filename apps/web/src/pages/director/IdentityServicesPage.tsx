import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Pencil, Sliders, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { api, getErrorMessage } from '@/lib/api'
import { formatNaira, nairaToKobo, koboToNaira, cn } from '@/lib/utils'
import type { IdentityService, IdentityServiceCategory } from '@/types'
import { CATEGORY_LABEL, CATEGORY_ICON, CATEGORY_ORDER } from '@/lib/identityServices'
import { FallbackError } from '@/components/ui/FallbackError'
import { resolveManualKey } from '@/lib/manualServices'
import { ENROLLMENT_BANKS } from '@/components/manual-services/constants'

// Human names for the price tiers the backend charges. The TIERS THEMSELVES come from the
// backend price table (so a tier that is charged can never be missing from this screen);
// this only supplies friendly labels. Unknown keys fall back to a prettified key.
const TIER_LABELS: Record<string, string> = {
  update_name: 'Update Name', update_phone: 'Update Phone Number', update_dob: 'Update Date of Birth',
  update_address: 'Update Address', update_name_dob: 'Update Name & DOB', update_name_phone: 'Update Name & Phone',
  update_name_address: 'Update Name & Address', update_dob_phone: 'Update DOB & Phone',
  no_record: 'No Record Found', sim_validation: 'SIM Validation', vnin_validation: 'v.nin Validation',
  update_records: 'Update Records Validation', bank_validation: 'Bank Validation',
  modification_validation: 'Modification Validation', photographic_error: 'Photographic Error',
  single: 'Single (fallback)', phone_number: 'Phone Number Retrieval', crm_investigation: 'CRM Investigation',
  self_service_delinking: 'Self-Service Delinking', email_retrieval: 'Email Retrieval',
  individual: 'Individual TIN', company: 'Company TIN', business_name: 'Business Name (BN)',
  default: 'Standard price',
}
for (const b of ENROLLMENT_BANKS) TIER_LABELS[b.id] = `${b.label} (single update)`

export interface ChildTier { key: string; label: string }

function prettyKey(key: string): string {
  return key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
}

/** Every tier the backend actually charges for this service. */
export function tiersFor(serviceCode: string, pricing?: Record<string, Record<string, number>>): ChildTier[] {
  const map = pricing?.[resolveManualKey(serviceCode)]
  if (!map) return []
  const keys = Object.keys(map)
  // "default" is only a fallback; show it on its own only when it is the sole price.
  const shown = keys.length === 1 ? keys : keys.filter((k) => k !== 'default')
  return shown.map((key) => ({ key, label: TIER_LABELS[key] || prettyKey(key) }))
}

interface PricingConfigData {
  pricing: Record<string, Record<string, number>>
  cover_labels: Record<string, string>
}

// ─── Modal for Editing Child Tiers & Alphanumeric Cover Label ────────────────
function ChildPricingModal({
  service,
  coverLabel,
  childTiers,
  currentPrices,
  onClose,
  onSaved,
}: {
  service: IdentityService
  coverLabel: string
  childTiers: ChildTier[]
  currentPrices: Record<string, number>
  onClose: () => void
  onSaved: () => void
}) {
  const [label, setLabel] = useState(coverLabel || '')
  const [prices, setPrices] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    for (const tier of childTiers) {
      init[tier.key] = String(koboToNaira(currentPrices[tier.key] ?? 0))
    }
    return init
  })

  const saveMutation = useMutation({
    mutationFn: async () => {
      const pricingPayload: Record<string, number> = {}
      for (const [key, val] of Object.entries(prices)) {
        const kobo = nairaToKobo(val || '0')
        if (!(kobo > 0)) throw new Error('Every price must be greater than ₦0.')
        pricingPayload[key] = kobo
      }

      // Only send the label if the director actually changed it. Otherwise the card keeps
      // following the live "From ₦X" instead of freezing today's text in place.
      const labelChanged = label.trim() !== (coverLabel || '').trim()
      await api.patch('/manual-services/pricing', {
        pricing: { [resolveManualKey(service.code)]: pricingPayload },
        ...(labelChanged ? { cover_labels: { [service.code]: label.trim() } } : {}),
      })
    },
    onSuccess: () => {
      toast.success('Service pricing & cover label updated')
      onSaved()
      onClose()
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white dark:bg-night-800 rounded-t-3xl sm:rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col shadow-2xl border border-green-100 dark:border-night-600 animate-in slide-in-from-bottom-6 duration-200">
        <div className="flex items-center justify-between p-4 border-b border-green-100 dark:border-night-700">
          <div>
            <h2 className="text-green-950 dark:text-white font-bold text-base">{service.name}</h2>
            <p className="text-green-600 dark:text-night-300 text-xs">Edit card cover label & child pricing tiers</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-green-50 dark:bg-night-700 flex items-center justify-center text-green-800 dark:text-night-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 overflow-y-auto space-y-4 flex-1">
          {/* Alphanumeric Cover Label */}
          <div className="space-y-1.5 bg-green-50/50 dark:bg-night-700/50 p-3 rounded-2xl border border-green-100 dark:border-night-600">
            <label className="text-xs font-bold text-green-900 dark:text-white block">
              Card Cover Label (Alphanumeric)
            </label>
            <p className="text-[11px] text-green-600 dark:text-night-300">
              The text shown on the cover card before entering the form (e.g. &ldquo;From ₦7,000&rdquo;, &ldquo;From 3,500&rdquo;, &ldquo;₦5,000&rdquo;).
            </p>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. From ₦7,000"
              className="w-full mt-1 border border-green-200 dark:border-night-500 bg-white dark:bg-night-800 rounded-xl px-3.5 py-2 text-sm text-green-950 dark:text-white font-semibold focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>

          {/* Child Tiers */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-green-800 dark:text-night-300">
              Inner Child Categories (Customer Charge in ₦)
            </h3>
            {childTiers.map((tier) => (
              <div
                key={tier.key}
                className="flex items-center justify-between gap-3 p-3 bg-white dark:bg-night-700 border border-green-100 dark:border-night-600 rounded-xl"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-green-950 dark:text-white truncate">{tier.label}</p>
                  <p className="text-[10px] text-green-500 dark:text-night-400 font-mono">tier: {tier.key}</p>
                </div>
                <div className="flex items-center gap-1.5 w-36">
                  <span className="text-xs font-bold text-green-700 dark:text-night-300">₦</span>
                  <input
                    type="number"
                    min="0"
                    step="100"
                    value={prices[tier.key] || ''}
                    onChange={(e) => setPrices((prev) => ({ ...prev, [tier.key]: e.target.value }))}
                    className="w-full border border-green-200 dark:border-night-500 bg-green-50/30 dark:bg-night-800 rounded-lg px-2.5 py-1.5 text-xs text-green-950 dark:text-white font-bold text-right focus:outline-none focus:ring-1 focus:ring-green-500"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="p-4 border-t border-green-100 dark:border-night-700 flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-bold text-green-700 dark:text-night-200 rounded-xl hover:bg-green-50 dark:hover:bg-night-700"
          >
            Cancel
          </button>
          <button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            className="px-5 py-2 text-xs font-bold text-white bg-green-700 hover:bg-green-800 dark:bg-amber-400 dark:text-green-950 dark:hover:bg-amber-300 rounded-xl shadow-sm disabled:opacity-50 flex items-center gap-1.5"
          >
            {saveMutation.isPending ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ServiceRow({
  service,
  coverLabel,
  allPricing,
}: {
  service: IdentityService
  coverLabel?: string
  allPricing?: Record<string, Record<string, number>>
}) {
  const qc = useQueryClient()
  const [editingCard, setEditingCard] = useState(false)
  const [customCover, setCustomCover] = useState(coverLabel || '')
  const [childModalOpen, setChildModalOpen] = useState(false)

  const childTiers = tiersFor(service.code, allPricing)

  // Normal price update on IdentityService table
  const [basePrice, setBasePrice] = useState(String(koboToNaira(service.price_kobo)))

  const activeMutation = useMutation({
    mutationFn: (is_active: boolean) => api.patch(`/identity-services/${service.id}/active`, { is_active }),
    onSuccess: () => {
      toast.success(service.is_active ? 'Service turned off' : 'Service turned on')
      qc.invalidateQueries({ queryKey: ['identity-services'] })
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const saveCoverMutation = useMutation({
    mutationFn: async () => {
      if (customCover.trim() === (coverLabel || '').trim()) return
      await api.patch('/manual-services/pricing', {
        cover_labels: {
          [service.code]: customCover.trim(),
        },
      })
    },
    onSuccess: () => {
      toast.success('Cover card label updated')
      qc.invalidateQueries({ queryKey: ['manual-services-pricing'] })
      setEditingCard(false)
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const saveBasePriceMutation = useMutation({
    mutationFn: () => api.patch(`/identity-services/${service.id}/price`, { price_kobo: nairaToKobo(basePrice) }),
    onSuccess: () => {
      toast.success('Price updated')
      qc.invalidateQueries({ queryKey: ['identity-services'] })
      setEditingCard(false)
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const effectiveDisplay =
    coverLabel ||
    (service.price_kobo > 0 ? formatNaira(service.price_kobo) : childTiers.length > 0 ? 'Tiered Pricing' : '₦0.00')

  return (
    <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-4 mb-2.5">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0">
          <p className="text-green-900 dark:text-white font-bold text-sm truncate">{service.name}</p>
          <p className="text-green-400 dark:text-night-300 text-xs mt-0.5">
            {service.provider === 'manual' ? 'Manual service' : `via ${service.provider}`}
          </p>
        </div>

        {/* on/off toggle */}
        <button
          onClick={() => activeMutation.mutate(!service.is_active)}
          disabled={activeMutation.isPending}
          aria-pressed={service.is_active}
          className={cn(
            'flex-shrink-0 w-12 h-7 rounded-full relative transition-colors duration-200 ease-out',
            'disabled:opacity-50',
            service.is_active ? 'bg-green-700 dark:bg-copper-500 shadow-copper' : 'bg-green-100 dark:bg-night-500',
          )}
        >
          <span
            className={cn(
              'absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white shadow-md',
              'transition-transform duration-200 ease-out',
              activeMutation.isPending && 'animate-pulse',
              service.is_active ? 'translate-x-5' : 'translate-x-0',
            )}
          />
        </button>
      </div>

      {editingCard ? (
        <div className="space-y-2 mt-2 pt-2 border-t border-green-100 dark:border-night-600">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-green-700 dark:text-night-300 whitespace-nowrap">Cover Text:</span>
            <input
              type="text"
              value={customCover}
              onChange={(e) => setCustomCover(e.target.value)}
              placeholder="e.g. From ₦7,000"
              className="flex-1 border border-green-200 dark:border-night-500 bg-white dark:bg-night-600 rounded-xl px-3 py-1.5 text-xs text-green-900 dark:text-white font-semibold"
            />
            <button
              onClick={() => saveCoverMutation.mutate()}
              disabled={saveCoverMutation.isPending}
              className="bg-green-900 dark:bg-amber-400 text-white dark:text-green-900 text-xs font-bold rounded-xl px-3 py-1.5 disabled:opacity-50"
            >
              Save Cover
            </button>
          </div>
          {childTiers.length === 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-green-700 dark:text-night-300 whitespace-nowrap">Base ₦:</span>
              <input
                type="number"
                value={basePrice}
                onChange={(e) => setBasePrice(e.target.value)}
                className="flex-1 border border-green-200 dark:border-night-500 bg-white dark:bg-night-600 rounded-xl px-3 py-1.5 text-xs text-green-900 dark:text-white"
              />
              <button
                onClick={() => saveBasePriceMutation.mutate()}
                disabled={saveBasePriceMutation.isPending}
                className="bg-green-700 text-white text-xs font-bold rounded-xl px-3 py-1.5 disabled:opacity-50"
              >
                Save Price
              </button>
            </div>
          )}
          <button
            onClick={() => setEditingCard(false)}
            className="text-green-600 dark:text-night-300 text-xs font-bold underline"
          >
            Done Editing
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2 mt-1">
          <button
            onClick={() => {
              setCustomCover(coverLabel || effectiveDisplay)
              setEditingCard(true)
            }}
            className="flex items-center gap-1.5 text-left group"
          >
            <span className="text-green-900 dark:text-white font-extrabold text-base">{effectiveDisplay}</span>
            <Pencil className="w-3.5 h-3.5 text-green-400 group-hover:text-green-600 dark:text-night-300" />
          </button>

          {childTiers.length > 0 && (
            <button
              onClick={() => setChildModalOpen(true)}
              className="flex items-center gap-1 px-3 py-1 bg-green-50 dark:bg-night-600 hover:bg-green-100 text-green-800 dark:text-night-100 rounded-xl text-xs font-bold border border-green-200 dark:border-night-500 transition-colors"
            >
              <Sliders className="w-3.5 h-3.5 text-green-600 dark:text-amber-400" />
              <span>Child Tiers ({childTiers.length})</span>
            </button>
          )}
        </div>
      )}

      {childModalOpen && (
        <ChildPricingModal
          service={service}
          coverLabel={coverLabel || effectiveDisplay}
          childTiers={childTiers}
          currentPrices={allPricing?.[resolveManualKey(service.code)] || {}}
          onClose={() => setChildModalOpen(false)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ['manual-services-pricing'] })
            qc.invalidateQueries({ queryKey: ['identity-services'] })
          }}
        />
      )}
    </div>
  )
}

export default function IdentityServicesPage() {
  const navigate = useNavigate()

  const { data: services = [], isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['identity-services'],
    queryFn: async () => {
      const { data } = await api.get<IdentityService[]>('/identity-services')
      return data
    },
  })

  const { data: pricingConfig } = useQuery<PricingConfigData>({
    queryKey: ['manual-services-pricing'],
    queryFn: async () => {
      const { data } = await api.get<PricingConfigData>('/manual-services/pricing')
      return data
    },
  })

  const grouped = CATEGORY_ORDER.map((cat) => ({
    category: cat,
    services: services.filter((s) => s.category === cat),
  })).filter((g) => g.services.length > 0)

  return (
    <div className="min-h-dvh flex flex-col bg-green-50 dark:bg-night-800">
      <header className="flex items-center gap-3 px-4 py-3">
        <button
          onClick={() => navigate(-1)}
          className="w-9 h-9 bg-green-100 dark:bg-night-600 rounded-xl flex items-center justify-center"
        >
          <ArrowLeft className="w-4 h-4 text-green-700 dark:text-night-100" />
        </button>
        <h1 className="text-green-900 dark:text-white font-bold text-lg">Identity services & pricing</h1>
      </header>

      <div className="flex-1 overflow-y-auto px-4 pb-safe-nav">
        <p className="text-green-500 dark:text-night-300 text-sm mb-4">
          Control card display prices (alphanumeric text like &ldquo;From ₦7,000&rdquo;) and configure inner child tier
          prices for each service. Toggle any service on or off at any time.
        </p>

        {isError ? (
          <FallbackError
            title="Couldn't load the service catalog"
            onRetry={() => refetch()}
            isRetrying={isFetching}
          />
        ) : isLoading ? (
          <div className="space-y-2.5">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-24 bg-white dark:bg-night-700 rounded-2xl animate-pulse" />
            ))}
          </div>
        ) : (
          grouped.map(({ category, services: catServices }) => {
            const Icon = CATEGORY_ICON[category as IdentityServiceCategory]
            return (
              <div key={category} className="mb-5">
                <div className="flex items-center gap-2 mb-2 px-1">
                  <Icon className="w-4 h-4 text-green-600 dark:text-night-200" />
                  <p className="text-green-900 dark:text-white font-bold text-sm">
                    {CATEGORY_LABEL[category as IdentityServiceCategory]}
                  </p>
                </div>
                {catServices.map((s) => (
                  <ServiceRow
                    key={s.id}
                    service={s}
                    coverLabel={pricingConfig?.cover_labels?.[s.code]}
                    allPricing={pricingConfig?.pricing}
                  />
                ))}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
