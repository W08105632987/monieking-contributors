import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { ArrowLeft, Smartphone, CheckCircle2 } from 'lucide-react'
import { formatNaira, cn } from '@/lib/utils'
import { getErrorMessage } from '@/lib/api'
import { useWallet } from '@/hooks/useWallet'
import { useBillers, usePayBill } from '@/hooks/useBillPayments'
import { FallbackError } from '@/components/ui/FallbackError'
import { PaymentReceipt, type ReceiptField } from '@/components/receipts/PaymentReceipt'
import { PaymentConfirmSheet } from '@/components/payments/PaymentConfirmSheet'
import { NetworkBadge, ALL_NETWORKS, type NetworkName } from '@/components/NetworkBadge'
import type { BillPaymentRequest } from '@/types'

// Prefix -> network map, used two ways: (1) auto-detect while typing, and
// (2) silently checking a MANUALLY chosen network against the typed
// number, so a mismatch surfaces as a clear error at Pay time instead of
// a confusing provider rejection. Not exhaustive of every recent MVNO
// prefix -- and can't be, since Nigeria has mobile number portability
// (MNP), meaning a number's original prefix stops guaranteeing its
// current network the moment someone ports it. That's the likely reason
// a real MTN number didn't auto-detect earlier -- this list can only ever
// be a best-effort hint, not a certainty. A prefix absent from every list
// below is treated as "unknown" rather than "wrong" -- we don't block on
// it, since it may just be a newer or ported number this table doesn't
// know about; the actual provider vend response remains the final,
// authoritative check either way.
const NETWORK_PREFIXES: Record<NetworkName, string[]> = {
  MTN:      ['0803', '0806', '0813', '0816', '0810', '0814', '0903', '0906', '0913', '0916', '0704'],
  Airtel:   ['0802', '0808', '0812', '0708', '0701', '0902', '0907', '0901', '0912', '0904'],
  Glo:      ['0805', '0807', '0815', '0811', '0905', '0915'],
  '9mobile': ['0809', '0817', '0818', '0908', '0909'],
}

function detectNetwork(phone: string): NetworkName | null {
  const prefix = phone.slice(0, 4)
  for (const [network, prefixes] of Object.entries(NETWORK_PREFIXES) as [NetworkName, string[]][]) {
    if (prefixes.includes(prefix)) return network
  }
  return null
}

/** null = can't tell either way (unrecognized/ported prefix) -- never block on this, only on a confirmed mismatch. */
function checkMismatch(phone: string, chosen: NetworkName): boolean | null {
  if (phone.length < 4) return null
  const detected = detectNetwork(phone)
  if (!detected) return null
  return detected !== chosen
}

const QUICK_AMOUNTS = [100, 200, 500, 1000, 2000]

export default function AirtimeDataPage() {
  const navigate = useNavigate()
  const { customerId } = useParams<{ customerId?: string }>()
  const { wallet } = useWallet()

  const [tab, setTab] = useState<'airtime' | 'data'>('airtime')
  const [phone, setPhone] = useState('')
  const [network, setNetwork] = useState<NetworkName | null>(null)
  const [manuallyChosen, setManuallyChosen] = useState(false)
  const [amountNaira, setAmountNaira] = useState<number | ''>('')
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null)
  const [completedRequest, setCompletedRequest] = useState<BillPaymentRequest | null>(null)
  const [showConfirm, setShowConfirm] = useState(false)

  // Auto-detect while typing, but only overwrite the network if the
  // customer hasn't manually picked one themselves -- manual choice
  // always wins over a guess.
  useEffect(() => {
    if (manuallyChosen) return
    setNetwork(detectNetwork(phone))
  }, [phone, manuallyChosen])

  // Silent check -- no UI reaction here, this just powers the Pay-time
  // error. Recomputed on every phone/network change.
  const mismatch = useMemo(() => (network ? checkMismatch(phone, network) : null), [phone, network])

  const { data: dataPlans = [], isLoading: plansLoading, isError: plansError, refetch: refetchPlans, isFetching: plansFetching } =
    useBillers(tab === 'data' ? 'data' : 'airtime')

  const plansForNetwork = network ? dataPlans.filter(p => p.name.toUpperCase().includes(network === '9mobile' ? '9MOBILE' : network.toUpperCase())) : dataPlans
  const selectedPlan = plansForNetwork.find(p => p.id === selectedPlanId)
  const airtimeBiller = dataPlans.find(p => network && p.name.toUpperCase().includes(network === '9mobile' ? '9MOBILE' : network.toUpperCase()))

  const payMutation = usePayBill(customerId)

  const canPay = tab === 'airtime'
    ? phone.length === 11 && !!network && typeof amountNaira === 'number' && amountNaira > 0 && !!airtimeBiller
    : phone.length === 11 && !!network && !!selectedPlan

  function handlePay() {
    if (!canPay) return

    // The one visible consequence of the silent validation -- caught
    // here, before any network call, so the error is instant and
    // specific rather than whatever generic rejection the provider
    // would return.
    if (mismatch) {
      toast.error('Wrong network & phone number combination')
      return
    }

    const biller = tab === 'airtime' ? airtimeBiller : selectedPlan
    if (!biller) {
      toast.error(network ? 'No plan available for this network yet' : 'Choose a network first')
      return
    }
    // Tapping Pay opens the confirmation sheet — the actual charge only
    // fires from handleConfirmPay, once the person has seen exactly
    // what's about to leave their wallet and confirmed it.
    setShowConfirm(true)
  }

  function handleConfirmPay() {
    const biller = tab === 'airtime' ? airtimeBiller : selectedPlan
    if (!biller) return
    payMutation.mutate(
      {
        biller_id: biller.id,
        customer_reference: phone,
        amount_kobo: tab === 'airtime' ? (amountNaira as number) * 100 : undefined,
      },
      {
        onSuccess: (req) => { setShowConfirm(false); setCompletedRequest(req) },
        onError: (e) => toast.error(getErrorMessage(e)),
      },
    )
  }

  const payAmountKobo = tab === 'airtime'
    ? (typeof amountNaira === 'number' ? amountNaira * 100 : 0)
    : (selectedPlan?.price_kobo ?? 0)

  const receiptFields: ReceiptField[] = completedRequest ? [
    { label: 'Network', value: network ?? '—' },
    { label: 'Phone number', value: phone },
    ...(tab === 'data' && selectedPlan ? [{ label: 'Plan', value: selectedPlan.product_name }] : []),
  ] : []

  return (
    <div className="min-h-dvh flex flex-col bg-green-50 dark:bg-night-800">
      <header className="flex items-center gap-3 px-4 py-3">
        <button onClick={() => navigate(-1)} className="w-9 h-9 bg-green-100 dark:bg-night-600 rounded-xl flex items-center justify-center">
          <ArrowLeft className="w-4 h-4 text-green-700 dark:text-night-100" />
        </button>
        <h1 className="text-green-900 dark:text-white font-bold text-lg">Airtime & Data</h1>
      </header>

      <div className="flex-1 overflow-y-auto px-4" style={{ paddingBottom: 'calc(var(--bottom-nav-height, 4.5rem) + 6rem)' }}>
        {customerId && (
          <div className="bg-amber-50 dark:bg-night-600 rounded-2xl px-4 py-3 mt-2 mb-4">
            <p className="text-amber-700 dark:text-night-100 text-xs font-semibold">
              Buying on this customer's behalf — charged to their wallet, not yours.
            </p>
          </div>
        )}

        {/* Airtime / Data toggle */}
        <div className="flex bg-white dark:bg-night-700 rounded-2xl p-1 mt-2 mb-5 border border-green-100 dark:border-night-500">
          {(['airtime', 'data'] as const).map(t => (
            <button
              key={t}
              onClick={() => { setTab(t); setSelectedPlanId(null) }}
              className={cn(
                'flex-1 py-2.5 rounded-xl text-sm font-bold capitalize transition-colors',
                tab === t ? 'bg-green-900 text-white' : 'text-green-600 dark:text-night-300',
              )}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Network — always manually selectable, auto-detect just pre-picks one */}
        <div className="mb-5">
          <div className="flex items-center justify-between mb-2">
            <label className="text-green-700 dark:text-night-200 text-xs font-semibold uppercase tracking-wide">
              Network
            </label>
            {network && !manuallyChosen && (
              <span className="text-[11px] text-green-400 dark:text-night-400">Detected from number</span>
            )}
          </div>
          <div className="flex gap-3">
            {ALL_NETWORKS.map(n => (
              <button
                key={n}
                onClick={() => { setNetwork(n); setManuallyChosen(true); setSelectedPlanId(null) }}
                className="flex flex-col items-center gap-1.5 flex-1"
              >
                <div className={cn(
                  'rounded-full p-0.5 transition-all',
                  network === n ? 'ring-2 ring-green-700 dark:ring-copper-400' : 'ring-2 ring-transparent',
                )}>
                  <NetworkBadge network={n} size={44} />
                </div>
                <span className={cn('text-[11px] font-semibold', network === n ? 'text-green-900 dark:text-white' : 'text-green-400 dark:text-night-400')}>
                  {n}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Phone number */}
        <div className="mb-5">
          <label className="text-green-700 dark:text-night-200 text-xs font-semibold uppercase tracking-wide mb-2 block">
            Phone number
          </label>
          <div className="flex items-center gap-3 bg-white dark:bg-night-700 border border-green-100 dark:border-night-500 rounded-2xl px-4 py-3.5">
            <div className="w-8 h-8 rounded-lg bg-green-100 dark:bg-night-600 flex items-center justify-center shrink-0">
              <Smartphone className="w-4 h-4 text-green-700 dark:text-night-100" />
            </div>
            <input
              type="tel"
              inputMode="numeric"
              maxLength={11}
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
              placeholder="080XXXXXXXX"
              className="flex-1 bg-transparent outline-none text-green-950 dark:text-white font-semibold"
            />
            {network && phone.length === 11 && mismatch === false && (
              <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
            )}
          </div>
        </div>

        {tab === 'airtime' ? (
          <div>
            <label className="text-green-700 dark:text-night-200 text-xs font-semibold uppercase tracking-wide mb-2 block">
              Amount
            </label>
            <div className="grid grid-cols-3 gap-2.5 mb-3">
              {QUICK_AMOUNTS.map(a => (
                <button
                  key={a}
                  onClick={() => setAmountNaira(a)}
                  className={cn(
                    'py-3 rounded-xl text-sm font-bold border transition-colors',
                    amountNaira === a
                      ? 'bg-green-900 text-white border-green-900'
                      : 'bg-white dark:bg-night-700 text-green-800 dark:text-night-100 border-green-100 dark:border-night-500',
                  )}
                >
                  ₦{a.toLocaleString()}
                </button>
              ))}
            </div>
            <input
              type="number"
              inputMode="numeric"
              value={amountNaira}
              onChange={(e) => setAmountNaira(e.target.value ? Number(e.target.value) : '')}
              placeholder="Or enter a custom amount"
              className="w-full bg-white dark:bg-night-700 border border-green-100 dark:border-night-500 rounded-2xl px-4 py-3.5 outline-none text-green-950 dark:text-white font-semibold"
            />
          </div>
        ) : (
          <div>
            <label className="text-green-700 dark:text-night-200 text-xs font-semibold uppercase tracking-wide mb-2 block">
              Choose a plan
            </label>
            {plansError ? (
              <FallbackError title="Couldn't load data plans" onRetry={() => refetchPlans()} isRetrying={plansFetching} />
            ) : plansLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map(i => <div key={i} className="h-16 bg-white dark:bg-night-700 rounded-2xl animate-pulse" />)}
              </div>
            ) : plansForNetwork.length === 0 ? (
              <p className="text-green-500 dark:text-night-300 text-sm">
                {network ? `No ${network} plans available right now.` : 'Choose a network to see plans.'}
              </p>
            ) : (
              <div className="space-y-2">
                {plansForNetwork.map(plan => (
                  <button
                    key={plan.id}
                    onClick={() => setSelectedPlanId(plan.id)}
                    className={cn(
                      'w-full flex items-center justify-between gap-3 rounded-2xl border px-4 py-3.5 text-left transition-colors',
                      selectedPlanId === plan.id
                        ? 'bg-green-900 border-green-900'
                        : 'bg-white dark:bg-night-700 border-green-100 dark:border-night-500',
                    )}
                  >
                    <span className={cn('text-sm font-bold', selectedPlanId === plan.id ? 'text-white' : 'text-green-900 dark:text-white')}>
                      {plan.product_name}
                    </span>
                    {plan.price_kobo != null && (
                      <span className={cn('text-sm font-extrabold', selectedPlanId === plan.id ? 'text-white' : 'text-green-700 dark:text-night-200')}>
                        {formatNaira(plan.price_kobo)}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Sticky pay bar — just the button, with the amount on it. No
          wallet balance shown here anymore: that comparison now lives
          inside the confirmation sheet, right next to what it's being
          compared against, instead of floating in a bar that isn't
          part of the actual decision moment. */}
      <div className="fixed left-0 right-0 z-30 bg-white dark:bg-night-900 border-t border-green-50 dark:border-night-700 px-4 py-3" style={{ bottom: 'var(--bottom-nav-height, 4.5rem)' }}>
        <button
          onClick={handlePay}
          disabled={!canPay || payMutation.isPending}
          className="w-full bg-green-900 text-white font-bold py-3.5 rounded-2xl disabled:opacity-50"
        >
          {payMutation.isPending
            ? 'Processing…'
            : `Pay${payAmountKobo > 0 ? ` ${formatNaira(payAmountKobo)}` : ''}`}
        </button>
      </div>

      <PaymentConfirmSheet
        open={showConfirm}
        onClose={() => setShowConfirm(false)}
        onConfirm={handleConfirmPay}
        isSubmitting={payMutation.isPending}
        title={tab === 'airtime' ? 'Confirm airtime purchase' : 'Confirm data purchase'}
        icon={network && <NetworkBadge network={network} size={28} />}
        amountKobo={payAmountKobo}
        walletBalanceKobo={wallet?.balance_kobo ?? 0}
        detailRows={[
          ...(network ? [{ label: 'Network', value: network }] : []),
          { label: 'Phone number', value: phone },
          ...(tab === 'data' && selectedPlan ? [{ label: 'Plan', value: selectedPlan.product_name }] : []),
        ]}
      />

      {completedRequest && (
        <PaymentReceipt
          open={!!completedRequest}
          onClose={() => { setCompletedRequest(null); navigate(-1) }}
          status={completedRequest.status === 'completed' ? 'completed' : completedRequest.status === 'failed' ? 'failed' : 'pending'}
          amountKobo={completedRequest.amount_charged_kobo ?? completedRequest.amount_kobo}
          serviceName={`${network ?? ''} ${tab === 'airtime' ? 'Airtime' : 'Data'}`.trim()}
          reference={completedRequest.monnify_transaction_reference ?? completedRequest.id}
          timestamp={new Date(completedRequest.created_at).toLocaleString()}
          fields={receiptFields}
          failureReason={completedRequest.failure_reason ?? undefined}
        />
      )}
    </div>
  )
}
