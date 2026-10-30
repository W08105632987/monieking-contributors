import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { getErrorMessage } from '@/lib/api'
import { useBillRequest } from '@/hooks/useBillPayments'
import { PaymentReceipt } from '@/components/receipts/PaymentReceipt'
import { FallbackError } from '@/components/ui/FallbackError'
import { buildBillReceipt } from '@/lib/billReceipt'

/**
 * A past bill payment (airtime, data, electricity, cable TV) opened from History:
 * the same animated receipt that appears right after paying, token included.
 * Shared by every role — an officer opens it from a customer's history.
 */
export default function BillReceiptPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data, isLoading, isError, error, refetch, isFetching } = useBillRequest(id)
  const back = () => navigate(-1)

  if (isError) {
    return (
      <div className="min-h-dvh flex flex-col bg-green-50 dark:bg-night-800">
        <header className="flex items-center gap-3 px-4 py-3">
          <button onClick={back} aria-label="Back" className="w-9 h-9 bg-green-100 dark:bg-night-600 rounded-xl flex items-center justify-center">
            <ArrowLeft className="w-4 h-4 text-green-700 dark:text-night-100" />
          </button>
          <h1 className="text-green-900 dark:text-white font-bold text-lg">Receipt</h1>
        </header>
        <div className="px-4">
          <FallbackError title="Couldn't load this receipt" message={getErrorMessage(error)} onRetry={() => refetch()} isRetrying={isFetching} />
        </div>
      </div>
    )
  }

  if (isLoading || !data) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-white dark:bg-night-900">
        <Loader2 className="w-6 h-6 animate-spin text-green-700 dark:text-night-200" />
      </div>
    )
  }

  const v = buildBillReceipt(data)
  return (
    <PaymentReceipt
      open onClose={back}
      status={v.status} amountKobo={v.amountKobo} serviceName={v.serviceName} reference={v.reference}
      timestamp={v.timestamp} fields={v.fields} failureReason={v.failureReason} brand={v.brand}
    />
  )
}
