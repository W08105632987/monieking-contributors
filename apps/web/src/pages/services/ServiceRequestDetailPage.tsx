import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, CheckCircle2, XCircle, Clock, RotateCcw, ShieldCheck } from 'lucide-react'
import { api } from '@/lib/api'
import { formatNaira, formatDateTime } from '@/lib/utils'
import type { IdentityServiceRequest, IdentityRequestStatus } from '@/types'
import { CATEGORY_LABEL } from '@/lib/identityServices'
import { FallbackError } from '@/components/ui/FallbackError'

const STATUS_META: Record<IdentityRequestStatus, { label: string; icon: typeof CheckCircle2; className: string }> = {
  completed: { label: 'Completed', icon: CheckCircle2, className: 'bg-green-100 dark:bg-night-600 text-green-700 dark:text-night-100' },
  pending:   { label: 'Pending',   icon: Clock,         className: 'bg-amber-50 text-amber-600' },
  failed:    { label: 'Failed',    icon: XCircle,       className: 'bg-red-50 text-red-500' },
  reversed:  { label: 'Reversed — refunded', icon: RotateCcw, className: 'bg-amber-50 text-amber-600' },
}

function fieldLabel(key: string): string {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase())
}

export default function ServiceRequestDetailPage() {
  const navigate = useNavigate()
  const { requestId } = useParams<{ requestId: string }>()

  const { data: req, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['service-request', requestId],
    queryFn: async () => {
      const { data } = await api.get<IdentityServiceRequest>(`/identity-services/requests/${requestId}`)
      return data
    },
    retry: 1,   // a 404 (wrong/old id) shouldn't retry 3x before showing the fallback
  })

  return (
    <div className="min-h-dvh flex flex-col bg-green-50 dark:bg-night-800">
      <header className="flex items-center gap-3 px-4 py-3">
        <button onClick={() => navigate(-1)} className="w-9 h-9 bg-green-100 dark:bg-night-600 rounded-xl flex items-center justify-center">
          <ArrowLeft className="w-4 h-4 text-green-700 dark:text-night-100" />
        </button>
        <h1 className="text-green-900 dark:text-white font-bold text-lg">
          {req?.service_name ?? 'Request details'}
        </h1>
      </header>

      <div className="flex-1 overflow-y-auto px-4 pb-10">
        {isError ? (
          <FallbackError
            title="Couldn't load this request"
            message="It may have been removed, or your connection dropped."
            onRetry={() => refetch()}
            isRetrying={isFetching}
          />
        ) : isLoading || !req ? (
          <div className="space-y-3 mt-2">
            {[1, 2, 3].map(i => <div key={i} className="h-20 bg-white dark:bg-night-700 rounded-2xl animate-pulse" />)}
          </div>
        ) : (
          <>
            {/* status + amount */}
            <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-4 mt-2 mb-4">
              <div className="flex items-center justify-between mb-3">
                {(() => {
                  const meta = STATUS_META[req.status]
                  const Icon = meta.icon
                  return (
                    <span className={`flex items-center gap-1.5 text-xs font-bold px-2.5 py-1.5 rounded-full ${meta.className}`}>
                      <Icon className="w-3.5 h-3.5" /> {meta.label}
                    </span>
                  )
                })()}
                <span className="text-xs text-green-400 dark:text-night-300">{CATEGORY_LABEL[req.service_category]}</span>
              </div>
              <p className="text-green-900 dark:text-white font-extrabold text-2xl">{formatNaira(req.amount_charged_kobo)}</p>
              <p className="text-green-400 dark:text-night-300 text-xs mt-1">
                Submitted {formatDateTime(req.created_at)}
                {req.completed_at && ` · Completed ${formatDateTime(req.completed_at)}`}
              </p>
              {req.initiated_by === 'officer' && (
                <p className="text-amber-600 text-xs mt-1 font-semibold">Submitted by an officer on this customer's behalf</p>
              )}
            </div>

            {/* what was submitted */}
            <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-4 mb-4">
              <p className="text-green-900 dark:text-white font-bold text-sm mb-3">Submitted details</p>
              <div className="space-y-2.5">
                {Object.entries(req.request_payload).map(([key, value]) => (
                  <div key={key} className="flex items-center justify-between">
                    <span className="text-green-500 dark:text-night-300 text-xs">{fieldLabel(key)}</span>
                    <span className="text-green-900 dark:text-white text-xs font-bold">{String(value)}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* provider result */}
            {req.response_summary && (
              <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-4 mb-4">
                <p className="text-green-900 dark:text-white font-bold text-sm mb-3">Result</p>
                <div className="space-y-2.5">
                  {Object.entries(req.response_summary).map(([key, value]) => (
                    <div key={key} className="flex items-center justify-between gap-3">
                      <span className="text-green-500 dark:text-night-300 text-xs flex-shrink-0">{fieldLabel(key)}</span>
                      <span className="text-green-900 dark:text-white text-xs font-bold text-right">{String(value)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {req.failure_reason && (
              <div className="bg-red-50 rounded-2xl p-4 mb-4">
                <p className="text-red-600 text-sm font-semibold">{req.failure_reason}</p>
              </div>
            )}

            {req.provider_reference && (
              <div className="flex items-center gap-2 text-green-400 dark:text-night-300 text-xs px-1">
                <ShieldCheck className="w-3.5 h-3.5" />
                Provider reference: {req.provider_reference}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
