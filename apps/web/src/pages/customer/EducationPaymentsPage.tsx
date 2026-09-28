import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { ArrowLeft, GraduationCap, Minus, Plus } from 'lucide-react'
import { formatNaira, cn } from '@/lib/utils'
import { getErrorMessage } from '@/lib/api'
import { useWallet } from '@/hooks/useWallet'
import { useBillers, usePayBill } from '@/hooks/useBillPayments'
import { FallbackError } from '@/components/ui/FallbackError'
import { PaymentReceipt, type ReceiptField } from '@/components/receipts/PaymentReceipt'
import type { BillPaymentRequest } from '@/types'

export default function EducationPaymentsPage() {
  const navigate = useNavigate()
  const { customerId } = useParams<{ customerId?: string }>()
  const { wallet } = useWallet()

  const [productId, setProductId] = useState<string | null>(null)
  const [quantity, setQuantity] = useState(1)
  const [completedRequest, setCompletedRequest] = useState<BillPaymentRequest | null>(null)

  const { data: products = [], isLoading, isError, refetch, isFetching } = useBillers('education')
  const selected = products.find(p => p.id === productId)

  const payMutation = usePayBill(customerId)

  // Education PINs don't validate against a customer account the way a
  // meter/smartcard does — there's nothing to confirm before paying, the
  // customer_reference is arbitrary here (e.g. their own phone number,
  // for delivery/lookup purposes), not an account identifier.
  const canPay = !!selected && quantity >= 1

  function handlePay() {
    if (!canPay || !selected) return
    payMutation.mutate(
      {
        biller_id: selected.id,
        customer_reference: customerId ?? 'self',   // no account to validate against — this just tags the purchase; adjust once a real delivery-contact field is designed
        amount_kobo: undefined,   // price resolved server-side from the product's own price_kobo × quantity
        quantity,
      },
      {
        onSuccess: (req) => setCompletedRequest(req),
        onError: (e) => toast.error(getErrorMessage(e)),
      },
    )
  }

  const pins = (completedRequest?.token ?? '').split(',').filter(Boolean)
  const receiptFields: ReceiptField[] = completedRequest ? [
    { label: 'Exam body / product', value: selected?.product_name ?? '' },
    { label: 'Quantity', value: String(quantity) },
    ...(pins.length > 0
      ? pins.map((pin, i) => ({ label: `PIN ${i + 1}`, value: pin, emphasis: true }))
      : []),
  ] : []

  return (
    <div className="min-h-dvh flex flex-col bg-green-50 dark:bg-night-800">
      <header className="flex items-center gap-3 px-4 py-3">
        <button onClick={() => navigate(-1)} className="w-9 h-9 bg-green-100 dark:bg-night-600 rounded-xl flex items-center justify-center">
          <ArrowLeft className="w-4 h-4 text-green-700 dark:text-night-100" />
        </button>
        <h1 className="text-green-900 dark:text-white font-bold text-lg">Education Payments</h1>
      </header>

      <div className="flex-1 overflow-y-auto px-4" style={{ paddingBottom: 'calc(var(--bottom-nav-height, 4.5rem) + 7rem)' }}>
        {customerId && (
          <div className="bg-amber-50 dark:bg-night-600 rounded-2xl px-4 py-3 mt-2 mb-4">
            <p className="text-amber-700 dark:text-night-100 text-xs font-semibold">
              Buying on this customer's behalf — charged to their wallet, not yours.
            </p>
          </div>
        )}

        <label className="text-green-700 dark:text-night-200 text-xs font-semibold uppercase tracking-wide mb-2 block">
          Exam body / product
        </label>
        {isError ? (
          <FallbackError title="Couldn't load products" onRetry={() => refetch()} isRetrying={isFetching} />
        ) : isLoading ? (
          <div className="space-y-2 mb-5">
            {[1, 2, 3].map(i => <div key={i} className="h-16 bg-white dark:bg-night-700 rounded-2xl animate-pulse" />)}
          </div>
        ) : products.length === 0 ? (
          <p className="text-green-500 dark:text-night-300 text-sm">No education products available right now.</p>
        ) : (
          <div className="space-y-2 mb-5">
            {products.map(p => (
              <button
                key={p.id}
                onClick={() => setProductId(p.id)}
                className={cn(
                  'w-full flex items-center gap-3 rounded-2xl border px-4 py-3.5 text-left transition-colors',
                  productId === p.id
                    ? 'bg-green-900 border-green-900'
                    : 'bg-white dark:bg-night-700 border-green-100 dark:border-night-500',
                )}
              >
                <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center shrink-0', productId === p.id ? 'bg-white/15' : 'bg-green-100 dark:bg-night-600')}>
                  <GraduationCap className={cn('w-4.5 h-4.5', productId === p.id ? 'text-white' : 'text-green-800 dark:text-night-100')} />
                </div>
                <div>
                  <p className={cn('text-sm font-bold', productId === p.id ? 'text-white' : 'text-green-900 dark:text-white')}>{p.name}</p>
                  <p className={cn('text-xs mt-0.5', productId === p.id ? 'text-white/70' : 'text-green-400 dark:text-night-300')}>{p.product_name}</p>
                </div>
                {p.price_kobo != null && (
                  <span className={cn('ml-auto text-sm font-extrabold shrink-0', productId === p.id ? 'text-white' : 'text-green-700 dark:text-night-200')}>
                    {formatNaira(p.price_kobo)}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        {selected && (
          <div>
            <label className="text-green-700 dark:text-night-200 text-xs font-semibold uppercase tracking-wide mb-2 block">
              Quantity
            </label>
            <div className="flex items-center gap-4 bg-white dark:bg-night-700 border border-green-100 dark:border-night-500 rounded-2xl px-4 py-3">
              <button
                onClick={() => setQuantity(q => Math.max(1, q - 1))}
                className="w-9 h-9 rounded-xl bg-green-50 dark:bg-night-600 flex items-center justify-center"
              >
                <Minus className="w-4 h-4 text-green-800 dark:text-night-100" />
              </button>
              <span className="flex-1 text-center font-bold text-green-950 dark:text-white text-lg">{quantity}</span>
              <button
                onClick={() => setQuantity(q => Math.min(50, q + 1))}
                className="w-9 h-9 rounded-xl bg-green-50 dark:bg-night-600 flex items-center justify-center"
              >
                <Plus className="w-4 h-4 text-green-800 dark:text-night-100" />
              </button>
            </div>
            <p className="text-green-400 dark:text-night-300 text-xs mt-2">Up to 50 PINs in one purchase — useful for schools buying in bulk.</p>
          </div>
        )}
      </div>

      <div className="fixed left-0 right-0 z-30 bg-white dark:bg-night-900 border-t border-green-50 dark:border-night-700 px-4 py-3" style={{ bottom: 'var(--bottom-nav-height, 4.5rem)' }}>
        <div className="flex items-center justify-between mb-2 text-xs text-green-500 dark:text-night-300">
          <span>Wallet balance</span>
          <span className="font-semibold text-green-700 dark:text-night-100">{formatNaira(wallet?.balance_kobo ?? 0)}</span>
        </div>
        <button
          onClick={handlePay}
          disabled={!canPay || payMutation.isPending}
          className="w-full bg-green-900 text-white font-bold py-3.5 rounded-2xl disabled:opacity-50"
        >
          {payMutation.isPending ? 'Processing…' : `Buy ${quantity > 1 ? `${quantity} PINs` : 'PIN'}`}
        </button>
      </div>

      {completedRequest && (
        <PaymentReceipt
          open={!!completedRequest}
          onClose={() => { setCompletedRequest(null); navigate(-1) }}
          status={completedRequest.status === 'completed' ? 'completed' : completedRequest.status === 'failed' ? 'failed' : 'pending'}
          amountKobo={completedRequest.amount_charged_kobo ?? completedRequest.amount_kobo}
          serviceName={selected?.name ?? 'Education payment'}
          reference={completedRequest.monnify_transaction_reference ?? completedRequest.id}
          timestamp={new Date(completedRequest.created_at).toLocaleString()}
          fields={receiptFields}
          failureReason={completedRequest.failure_reason ?? undefined}
        />
      )}
    </div>
  )
}
