import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { ArrowLeft, ShieldCheck } from 'lucide-react'
import toast from 'react-hot-toast'
import { api, getErrorMessage } from '@/lib/api'
import { formatNaira } from '@/lib/utils'
import type { IdentityService, IdentityServiceRequest } from '@/types'
import { FallbackError } from '@/components/ui/FallbackError'
import { useIsManualService } from '@/lib/manualServices'

export default function ServiceRequestFormPage() {
  const navigate = useNavigate()
  const isManualService = useIsManualService()
  // Present at two routes, same pattern as ServiceHistoryPage:
  // /customer/services/:serviceId/request (customer, own wallet charged)
  // /officer/customers/:customerId/services/:serviceId/request (officer
  // submitting on a customer's behalf — backend already supports this via
  // the customer_id query param, see identity_services.py)
  const { serviceId, customerId } = useParams<{ serviceId: string; customerId?: string }>()

  const [values, setValues] = useState<Record<string, string | boolean>>({})
  const [referralCode, setReferralCode] = useState('')
  const [referralWorker, setReferralWorker] = useState<string | null>(null)

  const handleReferralCodeChange = async (code: string) => {
    const clean = code.trim().toUpperCase()
    setReferralCode(clean)
    if (clean.length >= 6) {
      try {
        const { data } = await api.get(`/manual-services/validate-referral/${clean}`)
        if (data.valid) {
          setReferralWorker(data.worker_name || 'Verified Service Worker')
        }
      } catch {
        setReferralWorker(null)
      }
    } else {
      setReferralWorker(null)
    }
  }

  // Pull catalog list without active_only filter so all configured services can be found
  const { data: services, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['identity-services', 'all-lookup'],
    queryFn: async () => {
      const { data } = await api.get<IdentityService[]>('/identity-services')
      return data
    },
  })
  const service = services?.find(s => s.id === serviceId || s.code === serviceId)

  // Clean redirect if this route was reached with a manual service
  useEffect(() => {
    const targetCode =
      serviceId && isManualService(serviceId)
        ? serviceId
        : service && isManualService(service.code)
        ? (service.code === 'bvn_retrieval_phone' || service.code === 'bvn_retrieval_crm' ? 'bvn_retrieval' : service.code)
        : null

    if (targetCode) {
      navigate(
        customerId
          ? `/officer/customers/${customerId}/manual-services/${targetCode}`
          : `/customer/manual-services/${targetCode}`,
        { replace: true }
      )
    }
  }, [serviceId, service, customerId, navigate])

  const submitMutation = useMutation({
    mutationFn: async () => {
      const payloadData = {
        ...values,
        ...(referralCode ? { referral_code: referralCode, referred_worker: referralWorker } : {}),
      }
      const { data } = await api.post<IdentityServiceRequest>(
        '/identity-services/requests',
        { service_id: serviceId, payload: payloadData },
        { params: customerId ? { customer_id: customerId } : {} }
      )
      return data
    },
    onSuccess: (req) => {
      // The backend always returns 201 here, even when Youverify itself
      // failed — a provider outage lands as a normal, viewable "Failed"
      // request (see ServiceRequestDetailPage), not an error toast that
      // leaves the customer stuck on this form wondering what happened.
      toast.success(req.status === 'failed' ? 'Submitted — see what happened' : 'Request submitted')
      navigate(`/services/requests/${req.id}`, { replace: true })
    },
    onError: (e) => toast.error(getErrorMessage(e)),   // genuine failures on our own side: insufficient balance, validation, network down to us at all
  })

  const missingRequired = service?.required_fields.some(f => f.required && !values[f.key])

  const isRedirecting =
    Boolean(serviceId && isManualService(serviceId)) ||
    Boolean(service && isManualService(service.code))

  if (isRedirecting) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-green-50 dark:bg-night-800">
        <div className="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-dvh flex flex-col bg-green-50 dark:bg-night-800">
      <header className="flex items-center gap-3 px-4 py-3">
        <button onClick={() => navigate(-1)} className="w-9 h-9 bg-green-100 dark:bg-night-600 rounded-xl flex items-center justify-center">
          <ArrowLeft className="w-4 h-4 text-green-700 dark:text-night-100" />
        </button>
        <h1 className="text-green-900 dark:text-white font-bold text-lg">{service?.name ?? 'Service request'}</h1>
      </header>

      <div className="flex-1 overflow-y-auto px-4 pb-safe-nav">
        {isError ? (
          <FallbackError
            title="Couldn't load this service"
            onRetry={() => refetch()}
            isRetrying={isFetching}
          />
        ) : isLoading ? (
          <div className="space-y-3 mt-2">
            {[1, 2].map(i => <div key={i} className="h-14 bg-white dark:bg-night-700 rounded-2xl animate-pulse" />)}
          </div>
        ) : !service ? (
          <p className="text-green-500 dark:text-night-300 text-sm mt-4">
            This service isn't available right now.
          </p>
        ) : (
          <>
            {customerId && (
              <div className="bg-amber-50 dark:bg-night-600 rounded-2xl px-4 py-3 mt-2 mb-3">
                <p className="text-amber-700 dark:text-night-100 text-xs font-semibold">
                  Submitting on this customer's behalf — charged to their wallet, not yours.
                </p>
              </div>
            )}
            <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-4 mb-5">
              <p className="text-green-500 dark:text-night-300 text-xs font-semibold uppercase tracking-wide mb-1">Cost</p>
              <p className="text-green-900 dark:text-white text-2xl font-extrabold">{formatNaira(service.price_kobo)}</p>
              <p className="text-green-400 dark:text-night-300 text-xs mt-1">
                {customerId ? "Charged from the customer's wallet once this completes." : 'Charged from your wallet once this completes.'}
              </p>
            </div>

            <div className="space-y-4">
              {service.required_fields
                .filter(f => f.key !== 'isSubjectConsent')   // rendered as the consent line below instead
                .map(field => (
                  <div key={field.key}>
                    <label className="text-green-500 dark:text-night-300 text-xs font-semibold uppercase tracking-wide">
                      {field.label} {field.required && <span className="text-red-400">*</span>}
                    </label>
                    {field.type === 'boolean' ? (
                      <button
                        onClick={() => setValues(v => ({ ...v, [field.key]: !v[field.key] }))}
                        className="mt-1.5 flex items-center gap-2"
                      >
                        <span
                          className={`w-5 h-5 rounded-md border-2 flex items-center justify-center ${
                            values[field.key] ? 'bg-green-600 border-green-600' : 'border-green-200 dark:border-night-500'
                          }`}
                        >
                          {values[field.key] ? <span className="text-white text-xs">✓</span> : null}
                        </span>
                        <span className="text-green-800 dark:text-night-100 text-sm">Yes</span>
                      </button>
                    ) : (
                      <input
                        value={(values[field.key] as string) ?? ''}
                        onChange={e => setValues(v => ({ ...v, [field.key]: e.target.value }))}
                        placeholder={field.hint ?? undefined}
                        className="w-full mt-1.5 rounded-xl border-2 border-green-100 dark:border-night-500 bg-white dark:bg-night-600 px-4 py-3 text-sm font-medium text-green-900 dark:text-white outline-none focus:border-green-400"
                      />
                    )}
                  </div>
                ))}
            </div>

            {/* Optional Service Worker Referral Code */}
            <div className="mt-4 pt-3 border-t border-green-100 dark:border-night-600">
              <div className="flex items-center justify-between mb-1">
                <label className="text-green-600 dark:text-night-300 text-xs font-semibold uppercase tracking-wide">
                  Worker Referral Code (Optional)
                </label>
                {referralWorker && (
                  <span className="text-emerald-600 dark:text-emerald-400 font-bold text-xs">
                    ✓ {referralWorker}
                  </span>
                )}
              </div>
              <input
                value={referralCode}
                onChange={e => handleReferralCodeChange(e.target.value)}
                placeholder="e.g. SW-A1B2C3"
                className="w-full rounded-xl border-2 border-green-100 dark:border-night-500 bg-white dark:bg-night-600 px-4 py-2.5 text-sm font-mono text-green-900 dark:text-white uppercase outline-none focus:border-green-400"
              />
            </div>

            <div className="flex items-start gap-2 rounded-2xl p-3 mt-4 bg-green-100 dark:bg-night-600">
              <ShieldCheck className="w-4 h-4 flex-shrink-0 mt-0.5 text-green-700 dark:text-night-100" />
              <button
                onClick={() => setValues(v => ({ ...v, isSubjectConsent: !v.isSubjectConsent }))}
                className="text-left"
              >
                <p className="text-[11px] leading-relaxed text-green-800 dark:text-night-100">
                  {values.isSubjectConsent ? '☑' : '☐'} I confirm I have the customer's consent to run this check.
                </p>
              </button>
            </div>

            <button
              onClick={() => submitMutation.mutate()}
              disabled={missingRequired || !values.isSubjectConsent || submitMutation.isPending}
              className="w-full font-bold text-sm rounded-full py-3.5 mt-6 bg-amber-400 dark:bg-night-100 text-green-900 dark:text-night-900 disabled:opacity-40"
            >
              {submitMutation.isPending ? 'Submitting…' : `Pay ${formatNaira(service.price_kobo)} & submit`}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
