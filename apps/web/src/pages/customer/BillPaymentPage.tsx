import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { ArrowLeft, Zap, Tv, CheckCircle2 } from 'lucide-react'
import { formatNaira, cn } from '@/lib/utils'
import { getErrorMessage } from '@/lib/api'
import { useWallet } from '@/hooks/useWallet'
import { useBillers, useValidateBill, usePayBill } from '@/hooks/useBillPayments'
import { FallbackError } from '@/components/ui/FallbackError'
import { PaymentReceipt, type ReceiptField } from '@/components/receipts/PaymentReceipt'
import { PaymentConfirmSheet } from '@/components/payments/PaymentConfirmSheet'
import type { Biller, BillPaymentRequest } from '@/types'

type SubCategory = 'electricity' | 'cable_tv'

export default function BillPaymentPage() {
  const navigate = useNavigate()
  const { customerId } = useParams<{ customerId?: string }>()
  const { wallet } = useWallet()

  const [subCategory, setSubCategory] = useState<SubCategory>('electricity')
  const [meterMode, setMeterMode] = useState<'prepaid' | 'postpaid'>('prepaid')
  const [billerId, setBillerId] = useState<string | null>(null)
  const [customerReference, setCustomerReference] = useState('')
  const [amountNaira, setAmountNaira] = useState<number | ''>('')
  const [completedRequest, setCompletedRequest] = useState<BillPaymentRequest | null>(null)
  const [showConfirm, setShowConfirm] = useState(false)

  const { data: billers = [], isLoading, isError, refetch, isFetching } = useBillers(subCategory)
  const selectedBiller: Biller | undefined = billers.find(b => b.id === billerId)

  const validateMutation = useValidateBill()
  const payMutation = usePayBill(customerId)

  // Reset validation whenever the biller or reference number changes — a
  // stale "confirmed" name from a different meter is exactly the mistake
  // this whole step exists to prevent.
  function resetValidation() {
    validateMutation.reset()
  }

  function handleValidate() {
    if (!selectedBiller || customerReference.length < 5) return
    validateMutation.mutate(
      { biller_id: selectedBiller.id, customer_reference: customerReference },
      { onError: (e) => toast.error(getErrorMessage(e)) },
    )
  }

  const validated = validateMutation.data
  const canPay = selectedBiller && customerReference.length >= 5 && validated?.validated_account_name &&
    (subCategory === 'cable_tv' || (typeof amountNaira === 'number' && amountNaira >= 500))

  function handlePay() {
    if (!canPay || !selectedBiller) return
    // Tapping Pay opens the confirmation sheet — the actual charge only
    // fires from handleConfirmPay.
    setShowConfirm(true)
  }

  function handleConfirmPay() {
    if (!selectedBiller) return
    payMutation.mutate(
      {
        biller_id: selectedBiller.id,
        customer_reference: customerReference,
        amount_kobo: subCategory === 'cable_tv' ? undefined : (amountNaira as number) * 100,   // cable plan price resolved server-side from the biller's own price_kobo
        validation_reference: validated?.validation_reference,
      },
      {
        onSuccess: (req) => { setShowConfirm(false); setCompletedRequest(req) },
        onError: (e) => toast.error(getErrorMessage(e)),
      },
    )
  }

  const payAmountKobo = subCategory === 'cable_tv'
    ? (selectedBiller?.price_kobo ?? 0)
    : (typeof amountNaira === 'number' ? amountNaira * 100 : 0)

  const receiptFields: ReceiptField[] = completedRequest ? [
    { label: subCategory === 'electricity' ? 'DISCO' : 'Provider', value: selectedBiller?.name ?? '' },
    { label: subCategory === 'electricity' ? 'Meter number' : 'Smartcard number', value: customerReference },
    { label: 'Account name', value: validated?.validated_account_name ?? '' },
    ...(completedRequest.token ? [{ label: 'Token', value: completedRequest.token, emphasis: true }] : []),
  ] : []

  return (
    <div className="min-h-dvh flex flex-col bg-green-50 dark:bg-night-800">
      <header className="flex items-center gap-3 px-4 py-3">
        <button onClick={() => navigate(-1)} className="w-9 h-9 bg-green-100 dark:bg-night-600 rounded-xl flex items-center justify-center">
          <ArrowLeft className="w-4 h-4 text-green-700 dark:text-night-100" />
        </button>
        <h1 className="text-green-900 dark:text-white font-bold text-lg">Bill Payment</h1>
      </header>

      <div className="flex-1 overflow-y-auto px-4 pb-28">
        {customerId && (
          <div className="bg-amber-50 dark:bg-night-600 rounded-2xl px-4 py-3 mt-2 mb-4">
            <p className="text-amber-700 dark:text-night-100 text-xs font-semibold">
              Paying on this customer's behalf — charged to their wallet, not yours.
            </p>
          </div>
        )}

        {/* Electricity / Cable TV toggle */}
        <div className="flex bg-white dark:bg-night-700 rounded-2xl p-1 mt-2 mb-5 border border-green-100 dark:border-night-500">
          {([
            { key: 'electricity' as const, label: 'Electricity', icon: Zap },
            { key: 'cable_tv' as const, label: 'Cable TV', icon: Tv },
          ]).map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => { setSubCategory(key); setBillerId(null); setCustomerReference(''); resetValidation() }}
              className={cn(
                'flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-bold transition-colors',
                subCategory === key ? 'bg-green-900 text-white' : 'text-green-600 dark:text-night-300',
              )}
            >
              <Icon className="w-4 h-4" /> {label}
            </button>
          ))}
        </div>

        {subCategory === 'electricity' && (
          <div className="flex bg-white dark:bg-night-700 rounded-2xl p-1 mb-5 border border-green-100 dark:border-night-500">
            {(['prepaid', 'postpaid'] as const).map(m => (
              <button
                key={m}
                onClick={() => setMeterMode(m)}
                className={cn(
                  'flex-1 py-2 rounded-xl text-xs font-bold capitalize',
                  meterMode === m ? 'bg-green-100 dark:bg-night-600 text-green-900 dark:text-white' : 'text-green-500 dark:text-night-300',
                )}
              >
                {m}
              </button>
            ))}
          </div>
        )}

        {/* Biller / provider selection */}
        <label className="text-green-700 dark:text-night-200 text-xs font-semibold uppercase tracking-wide mb-2 block">
          {subCategory === 'electricity' ? 'Distribution company' : 'TV provider'}
        </label>
        {isError ? (
          <FallbackError title="Couldn't load providers" onRetry={() => refetch()} isRetrying={isFetching} />
        ) : isLoading ? (
          <div className="grid grid-cols-2 gap-2 mb-5">
            {[1, 2, 3, 4].map(i => <div key={i} className="h-12 bg-white dark:bg-night-700 rounded-xl animate-pulse" />)}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 mb-5">
            {billers.map(b => (
              <button
                key={b.id}
                onClick={() => { setBillerId(b.id); resetValidation() }}
                className={cn(
                  'py-3 px-3 rounded-xl text-xs font-bold text-left transition-colors border',
                  billerId === b.id
                    ? 'bg-green-900 text-white border-green-900'
                    : 'bg-white dark:bg-night-700 text-green-900 dark:text-white border-green-100 dark:border-night-500',
                )}
              >
                {b.name}
              </button>
            ))}
          </div>
        )}

        {/* Meter / smartcard number + Verify */}
        {selectedBiller && (
          <div className="mb-5">
            <label className="text-green-700 dark:text-night-200 text-xs font-semibold uppercase tracking-wide mb-2 block">
              {subCategory === 'electricity' ? 'Meter number' : 'Smartcard number'}
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                inputMode="numeric"
                value={customerReference}
                onChange={(e) => { setCustomerReference(e.target.value.replace(/\D/g, '')); resetValidation() }}
                placeholder="Enter number"
                className="flex-1 bg-white dark:bg-night-700 border border-green-100 dark:border-night-500 rounded-2xl px-4 py-3.5 outline-none text-green-950 dark:text-white font-semibold"
              />
              <button
                onClick={handleValidate}
                disabled={customerReference.length < 5 || validateMutation.isPending}
                className="px-5 rounded-2xl bg-green-100 dark:bg-night-600 text-green-800 dark:text-night-100 font-bold text-sm disabled:opacity-50"
              >
                {validateMutation.isPending ? 'Checking…' : 'Verify'}
              </button>
            </div>

            {/* Confirmation block — this IS the trust mechanism, made
                impossible to miss rather than a small caption. */}
            {validated?.validated_account_name && (
              <div className="mt-3 flex items-center gap-3 bg-green-50 dark:bg-night-600 rounded-2xl px-4 py-3.5">
                <CheckCircle2 className="w-5 h-5 text-green-700 dark:text-green-400 shrink-0" />
                <div>
                  <p className="text-green-500 dark:text-night-300 text-[11px] font-semibold uppercase">Confirm this is correct</p>
                  <p className="text-green-950 dark:text-white font-bold">{validated.validated_account_name}</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Amount — electricity only; cable plans would list bouquets here
            once the biller's product list is fetched with prices, kept
            simple for this first pass. */}
        {subCategory === 'electricity' && validated?.validated_account_name && (
          <div>
            <label className="text-green-700 dark:text-night-200 text-xs font-semibold uppercase tracking-wide mb-2 block">
              Amount
            </label>
            <input
              type="number"
              inputMode="numeric"
              value={amountNaira}
              onChange={(e) => setAmountNaira(e.target.value ? Number(e.target.value) : '')}
              placeholder="Minimum ₦500"
              className="w-full bg-white dark:bg-night-700 border border-green-100 dark:border-night-500 rounded-2xl px-4 py-3.5 outline-none text-green-950 dark:text-white font-semibold"
            />
          </div>
        )}
      </div>

      <div className="fixed bottom-0 left-0 right-0 bg-white dark:bg-night-900 border-t border-green-50 dark:border-night-700 px-4 py-3">
        <button
          onClick={handlePay}
          disabled={!canPay || payMutation.isPending}
          className="w-full bg-green-900 text-white font-bold py-3.5 rounded-2xl disabled:opacity-50"
        >
          {payMutation.isPending ? 'Processing…' : `Pay${payAmountKobo > 0 ? ` ${formatNaira(payAmountKobo)}` : ' bill'}`}
        </button>
      </div>

      <PaymentConfirmSheet
        open={showConfirm}
        onClose={() => setShowConfirm(false)}
        onConfirm={handleConfirmPay}
        isSubmitting={payMutation.isPending}
        title={subCategory === 'electricity' ? 'Confirm electricity payment' : 'Confirm cable TV payment'}
        icon={subCategory === 'electricity' ? <Zap className="w-6 h-6 text-copper-500" /> : <Tv className="w-6 h-6 text-copper-500" />}
        amountKobo={payAmountKobo}
        walletBalanceKobo={wallet?.balance_kobo ?? 0}
        detailRows={[
          { label: subCategory === 'electricity' ? 'DISCO' : 'Provider', value: selectedBiller?.name ?? '' },
          { label: subCategory === 'electricity' ? 'Meter number' : 'Smartcard number', value: customerReference },
          ...(validated?.validated_account_name ? [{ label: 'Account name', value: validated.validated_account_name }] : []),
        ]}
      />

      {completedRequest && (
        <PaymentReceipt
          open={!!completedRequest}
          onClose={() => { setCompletedRequest(null); navigate(-1) }}
          status={completedRequest.status === 'completed' ? 'completed' : completedRequest.status === 'failed' ? 'failed' : 'pending'}
          amountKobo={completedRequest.amount_charged_kobo ?? completedRequest.amount_kobo}
          serviceName={selectedBiller?.name ?? 'Bill payment'}
          reference={completedRequest.monnify_transaction_reference ?? completedRequest.id}
          timestamp={new Date(completedRequest.created_at).toLocaleString()}
          fields={receiptFields}
          failureReason={completedRequest.failure_reason ?? undefined}
        />
      )}
    </div>
  )
}
