import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Pencil, AlertTriangle } from 'lucide-react'
import toast from 'react-hot-toast'
import { api, getErrorMessage } from '@/lib/api'
import { formatNaira, nairaToKobo, koboToNaira, cn } from '@/lib/utils'
import type { IdentityService, IdentityServiceCategory } from '@/types'
import { CATEGORY_LABEL, CATEGORY_ICON, CATEGORY_ORDER } from '@/lib/identityServices'
import { FallbackError } from '@/components/ui/FallbackError'

function ServiceRow({ service }: { service: IdentityService }) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [price, setPrice] = useState(String(koboToNaira(service.price_kobo)))

  const priceMutation = useMutation({
    mutationFn: () => api.patch(`/identity-services/${service.id}/price`, { price_kobo: nairaToKobo(price) }),
    onSuccess: () => {
      toast.success('Price updated')
      qc.invalidateQueries({ queryKey: ['identity-services'] })
      setEditing(false)
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const activeMutation = useMutation({
    mutationFn: (is_active: boolean) => api.patch(`/identity-services/${service.id}/active`, { is_active }),
    onSuccess: () => {
      toast.success(service.is_active ? 'Service turned off' : 'Service turned on')
      qc.invalidateQueries({ queryKey: ['identity-services'] })
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const noIntegration = service.provider === 'manual'

  return (
    <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-4 mb-2.5">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0">
          <p className="text-green-900 dark:text-white font-bold text-sm truncate">{service.name}</p>
          {noIntegration ? (
            <p className="flex items-center gap-1 text-amber-600 text-xs mt-0.5">
              <AlertTriangle className="w-3 h-3 flex-shrink-0" /> No confirmed integration yet
            </p>
          ) : (
            <p className="text-green-400 dark:text-night-300 text-xs mt-0.5">via {service.provider}</p>
          )}
        </div>

        {/* on/off toggle */}
        <button
          onClick={() => {
            if (noIntegration && !service.is_active) {
              toast.error("Can't activate — this service has no confirmed provider integration yet.")
              return
            }
            activeMutation.mutate(!service.is_active)
          }}
          disabled={activeMutation.isPending}
          aria-pressed={service.is_active}
          className={cn(
            'flex-shrink-0 w-12 h-7 rounded-full relative transition-colors duration-200 ease-out',
            'disabled:opacity-50',
            service.is_active
              ? 'bg-green-700 dark:bg-copper-500 shadow-copper'
              : 'bg-green-100 dark:bg-night-500',
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

      {editing ? (
        <div className="flex items-center gap-2 mt-2">
          <span className="text-green-600 dark:text-night-200 text-sm">₦</span>
          <input
            value={price}
            onChange={e => setPrice(e.target.value)}
            type="number"
            className="flex-1 border border-green-200 dark:border-night-500 bg-white dark:bg-night-600 rounded-xl px-3 py-2 text-sm text-green-900 dark:text-white"
          />
          <button onClick={() => setEditing(false)} className="text-green-500 dark:text-night-300 text-xs font-bold px-2">Cancel</button>
          <button
            onClick={() => priceMutation.mutate()}
            disabled={priceMutation.isPending}
            className="bg-green-900 dark:bg-amber-400 text-white dark:text-green-900 text-xs font-bold rounded-full px-4 py-2 disabled:opacity-50"
          >
            {priceMutation.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      ) : (
        <button onClick={() => setEditing(true)} className="flex items-center gap-1.5 mt-1">
          <span className="text-green-900 dark:text-white font-extrabold text-lg">{formatNaira(service.price_kobo)}</span>
          <Pencil className="w-3.5 h-3.5 text-green-400 dark:text-night-300" />
        </button>
      )}
    </div>
  )
}

export default function IdentityServicesPage() {
  const navigate = useNavigate()

  const { data: services = [], isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['identity-services'],
    queryFn: async () => { const { data } = await api.get<IdentityService[]>('/identity-services'); return data },
  })

  const grouped = CATEGORY_ORDER.map(cat => ({
    category: cat,
    services: services.filter(s => s.category === cat),
  })).filter(g => g.services.length > 0)

  return (
    <div className="min-h-dvh flex flex-col bg-green-50 dark:bg-night-800">
      <header className="flex items-center gap-3 px-4 py-3">
        <button onClick={() => navigate(-1)} className="w-9 h-9 bg-green-100 dark:bg-night-600 rounded-xl flex items-center justify-center">
          <ArrowLeft className="w-4 h-4 text-green-700 dark:text-night-100" />
        </button>
        <h1 className="text-green-900 dark:text-white font-bold text-lg">Identity services & pricing</h1>
      </header>

      <div className="flex-1 overflow-y-auto px-4 pb-10">
        <p className="text-green-500 dark:text-night-300 text-sm mb-4">
          Set what each service costs a customer. A service can only be turned on once it has a real,
          confirmed integration — that's enforced here, not just a suggestion.
        </p>

        {isError ? (
          <FallbackError
            title="Couldn't load the service catalog"
            onRetry={() => refetch()}
            isRetrying={isFetching}
          />
        ) : isLoading ? (
          <div className="space-y-2.5">
            {[1, 2, 3].map(i => <div key={i} className="h-24 bg-white dark:bg-night-700 rounded-2xl animate-pulse" />)}
          </div>
        ) : (
          grouped.map(({ category, services: catServices }) => {
            const Icon = CATEGORY_ICON[category as IdentityServiceCategory]
            return (
              <div key={category} className="mb-5">
                <div className="flex items-center gap-2 mb-2 px-1">
                  <Icon className="w-4 h-4 text-green-600 dark:text-night-200" />
                  <p className="text-green-900 dark:text-white font-bold text-sm">{CATEGORY_LABEL[category as IdentityServiceCategory]}</p>
                </div>
                {catServices.map(s => <ServiceRow key={s.id} service={s} />)}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
