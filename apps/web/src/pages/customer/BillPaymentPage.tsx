import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import toast from '@/lib/notify'
import { ArrowLeft, Zap, Tv, CheckCircle2, Loader2, ShieldCheck } from 'lucide-react'
import { formatNaira, cn } from '@/lib/utils'
import { getErrorMessage } from '@/lib/api'
import { useWallet } from '@/hooks/useWallet'
import { AnimatePresence, motion } from 'framer-motion'
import { isPinCancelled } from '@/lib/pin'
import { useBillsConfig, DEFAULT_BILLS_CONFIG, useBillers, useValidateBill, usePayBill } from '@/hooks/useBillPayments'
import { FallbackError } from '@/components/ui/FallbackError'
import { PaymentReceipt, type ReceiptField } from '@/components/receipts/PaymentReceipt'
import { PaymentConfirmSheet } from '@/components/payments/PaymentConfirmSheet'
import { BillerPicker } from '@/components/billers/BillerPicker'
import { BillerLogo } from '@/components/billers/BillerLogo'
import { PlanSheet } from '@/components/billers/PlanSheet'
import { groupByBiller, meterKind, meterKindsOf, METER_LABEL, type BillerGroup, type MeterKind } from '@/lib/billCatalog'
import { resolveBrand, brandGradient, brandWash, rgba, type BillerBrand } from '@/lib/billerBrand'
import type { Biller, BillPaymentRequest } from '@/types'

type SubCategory = 'electricity' | 'cable_tv'

const QUICK_AMOUNTS = [1000, 2000, 5000, 10000]
const MIN_ELECTRICITY_NAIRA = 500
const NEUTRAL: BillerBrand = { key: 'neutral', label: 'Bills', logo: null, main: '#14532d', deep: '#052e16', on: '#ffffff', initials: 'B' }

export default function BillPaymentPage() {
  const navigate = useNavigate()
  const { customerId } = useParams<{ customerId?: string }>()
  const { wallet } = useWallet()

  const [subCategory, setSubCategory] = useState<SubCategory>('electricity')
  const [groupKey, setGroupKey] = useState<string | null>(null)
  const [meterMode, setMeterMode] = useState<MeterKind>('prepaid')
  const [productId, setProductId] = useState<string | null>(null)
  const [customerReference, setCustomerReference] = useState('')
  const [amountNaira, setAmountNaira] = useState<number | ''>('')
  const [completedRequest, setCompletedRequest] = useState<BillPaymentRequest | null>(null)
  const [showConfirm, setShowConfirm] = useState(false)

  const { data: cfgData } = useBillsConfig()
  const cfg = cfgData ?? DEFAULT_BILLS_CONFIG
  const { data: billers = [], isLoading, isError, refetch, isFetching } = useBillers(subCategory)

  const groups = useMemo(() => groupByBiller(billers), [billers])
  const group: BillerGroup | undefined = groups.find(g => g.key === groupKey)
  const brand = group ? resolveBrand(group.name) : NEUTRAL

  // Electricity: a provider sells Prepaid and Postpaid as separate products — show only the kinds it really has.
  const kinds = useMemo(() => (group && subCategory === 'electricity' ? meterKindsOf(group.products) : []), [group, subCategory])
  const activeKind: MeterKind | undefined = kinds.includes(meterMode) ? meterMode : kinds[0]
  const candidates: Biller[] = useMemo(() => {
    if (!group) return []
    const list = subCategory === 'electricity' ? group.products.filter(p => meterKind(p) === activeKind) : [...group.products]
    return list.sort((a, b) => (a.price_kobo ?? 0) - (b.price_kobo ?? 0) || a.product_name.localeCompare(b.product_name))
  }, [group, subCategory, activeKind])

  // One product -> it is the product. Several (TV bouquets) -> the customer picks.
  const selectedBiller: Biller | undefined = candidates.length === 1 && subCategory === 'electricity'
    ? candidates[0]
    : candidates.find(p => p.id === productId)

  const validateMutation = useValidateBill()
  const payMutation = usePayBill(customerId)

  // A stale "confirmed" name from a different meter is exactly the mistake this step exists to prevent.
  function resetValidation() { validateMutation.reset() }

  function switchCategory(next: SubCategory) {
    setSubCategory(next); setGroupKey(null); setProductId(null); setCustomerReference(''); setAmountNaira(''); resetValidation()
  }

  function chooseGroup(g: BillerGroup) {
    setGroupKey(g.key); setProductId(null); resetValidation()
    if (subCategory === 'electricity') {
      const ks = meterKindsOf(g.products)
      setMeterMode(ks.includes('prepaid') ? 'prepaid' : ks[0] ?? 'prepaid')
    }
  }

  function handleValidate() {
    if (!selectedBiller || customerReference.length < 5) return
    validateMutation.mutate(
      { biller_id: selectedBiller.id, customer_reference: customerReference },
      { onError: (e) => toast.error(getErrorMessage(e)) },
    )
  }

  const validated = validateMutation.data
  const isVerified = validateMutation.isSuccess
  const isCable = subCategory === 'cable_tv'
  const amountOk = typeof amountNaira === 'number' && amountNaira >= MIN_ELECTRICITY_NAIRA
  const canPay = cfg.bills_enabled && !!selectedBiller && customerReference.length >= 5 && isVerified && (isCable || amountOk)

  const payAmountKobo = isCable ? (selectedBiller?.price_kobo ?? 0) : (typeof amountNaira === 'number' ? amountNaira * 100 : 0)
  const refLabel = isCable ? 'Smartcard / IUC number' : 'Meter number'

  function handleConfirmPay() {
    if (!selectedBiller) return
    payMutation.mutate(
      {
        biller_id: selectedBiller.id,
        customer_reference: customerReference,
        amount_kobo: isCable ? undefined : (amountNaira as number) * 100,   // a TV plan's price is resolved server-side from the product itself
        validation_reference: validated?.validation_reference,
      },
      {
        onSuccess: (req) => { setShowConfirm(false); setCompletedRequest(req) },
        onError: (e) => { if (!isPinCancelled(e)) toast.error(getErrorMessage(e)) },
      },
    )
  }

  const receiptFields: ReceiptField[] = completedRequest ? [
    { label: isCable ? 'Provider' : 'Distribution company', value: group?.name ?? '' },
    ...(selectedBiller ? [{ label: isCable ? 'Plan' : 'Meter type', value: isCable ? selectedBiller.product_name : METER_LABEL[meterKind(selectedBiller)] }] : []),
    { label: refLabel, value: customerReference },
    ...(validated?.validated_account_name ? [{ label: 'Account name', value: validated.validated_account_name }] : []),
    ...(completedRequest.token ? [{ label: isCable ? 'Reference code' : 'Electricity token', value: completedRequest.token, kind: 'token' as const }] : []),
  ] : []

  return (
    <div className="relative min-h-dvh flex flex-col bg-green-50 dark:bg-night-800">
      {/* The page fades into the chosen provider's colour */}
      <motion.div
        key={brand.key} aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[28rem] dark:opacity-80"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}
        style={{ background: brandWash(brand) }}
      />

      <header className="relative flex items-center gap-3 px-4 py-3">
        <button onClick={() => navigate(-1)} aria-label="Back" className="w-9 h-9 bg-white/70 dark:bg-night-600 backdrop-blur rounded-xl flex items-center justify-center">
          <ArrowLeft className="w-4 h-4 text-green-700 dark:text-night-100" />
        </button>
        <h1 className="text-green-900 dark:text-white font-bold text-lg flex-1">Bill Payment</h1>
        <AnimatePresence mode="wait">
          {group && (
            <motion.div key={brand.key} initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.5, opacity: 0 }}>
              <BillerLogo brand={brand} size={36} glow />
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      <div className="relative flex-1 overflow-y-auto px-4" style={{ paddingBottom: 'calc(var(--bottom-nav-height, 4.5rem) + 6rem)' }}>
        {customerId && (
          <div className="bg-amber-50 dark:bg-night-600 rounded-2xl px-4 py-3 mt-2 mb-4">
            <p className="text-amber-700 dark:text-night-100 text-xs font-semibold">Paying on this customer's behalf — charged to their wallet, not yours.</p>
          </div>
        )}
        {cfg.notice && (
          <p className="mt-2 mb-3 rounded-2xl bg-white/80 dark:bg-night-700/80 border border-amber-300/60 px-4 py-3 text-xs font-semibold text-amber-800 dark:text-amber-200">{cfg.notice}</p>
        )}
        {!cfg.bills_enabled && (
          <p className="mt-2 mb-3 rounded-2xl bg-red-50 dark:bg-red-950/30 border border-red-200 px-4 py-3 text-sm font-semibold text-red-700 dark:text-red-200">Bill payments are paused right now. Please check back soon.</p>
        )}

        {/* Electricity / Cable TV */}
        <div className="relative flex bg-white/80 dark:bg-night-700 backdrop-blur rounded-2xl p-1 mt-2 mb-5 border border-green-100 dark:border-night-500">
          {([{ key: 'electricity' as const, label: 'Electricity', icon: Zap }, { key: 'cable_tv' as const, label: 'Cable TV', icon: Tv }]).map(({ key, label, icon: Icon }) => (
            <button
              key={key} onClick={() => switchCategory(key)}
              className={cn('relative flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-bold transition-colors', subCategory === key ? '' : 'text-green-700 dark:text-night-300')}
              style={subCategory === key ? { color: brand.on } : undefined}
            >
              {subCategory === key && <motion.span layoutId="bill-tab" className="absolute inset-0 rounded-xl" style={{ background: brandGradient(brand) }} transition={{ type: 'spring', stiffness: 380, damping: 32 }} />}
              <span className="relative flex items-center gap-1.5"><Icon className="w-4 h-4" /> {label}</span>
            </button>
          ))}
        </div>

        {/* Step 1 — provider */}
        <label className="text-green-700 dark:text-night-200 text-xs font-semibold uppercase tracking-wide mb-2 block">
          {isCable ? '1 · TV provider' : '1 · Distribution company'}
        </label>
        {isError ? (
          <FallbackError title="Couldn't load providers" onRetry={() => refetch()} isRetrying={isFetching} />
        ) : isLoading ? (
          <div className="grid grid-cols-3 gap-2.5 mb-5">{[1, 2, 3, 4, 5, 6].map(i => <div key={i} className="h-28 bg-white dark:bg-night-700 rounded-2xl animate-pulse" />)}</div>
        ) : groups.length === 0 ? (
          <p className="text-green-500 dark:text-night-300 text-sm mb-5">No providers are available right now.</p>
        ) : (
          <div className="mb-5"><BillerPicker groups={groups} selectedKey={groupKey} onSelect={chooseGroup} /></div>
        )}

        <AnimatePresence mode="wait">
          {group && (
            <motion.div key={group.key} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
              {/* Step 2 — meter type (electricity) or plan (TV) */}
              {!isCable ? (
                kinds.length > 0 && (
                  <div className="mb-5">
                    <label className="text-green-700 dark:text-night-200 text-xs font-semibold uppercase tracking-wide mb-2 block">2 · Meter type</label>
                    <div className="relative flex bg-white/80 dark:bg-night-700 rounded-2xl p-1 border border-green-100 dark:border-night-500">
                      {kinds.map(k => (
                        <button
                          key={k} onClick={() => { setMeterMode(k); setProductId(null); resetValidation() }}
                          className={cn('relative flex-1 py-2.5 rounded-xl text-sm font-bold', activeKind === k ? '' : 'text-green-700 dark:text-night-300')}
                          style={activeKind === k ? { color: brand.on } : undefined}
                        >
                          {activeKind === k && <motion.span layoutId="meter-kind" className="absolute inset-0 rounded-xl" style={{ background: brandGradient(brand) }} transition={{ type: 'spring', stiffness: 380, damping: 32 }} />}
                          <span className="relative">{METER_LABEL[k]}</span>
                        </button>
                      ))}
                    </div>
                    <p className="mt-1.5 text-[11px] text-green-600 dark:text-night-300">
                      {activeKind === 'postpaid' ? 'Postpaid: you pay off your monthly bill.' : activeKind === 'prepaid' ? 'Prepaid: you buy units and receive a token to load on your meter.' : ''}
                    </p>
                    {candidates.length > 1 && (
                      <div className="mt-3">
                        <PlanSheet title="Product" placeholder="Choose a product" brand={brand} plans={candidates} selectedId={productId} onSelect={p => { setProductId(p.id); resetValidation() }} />
                      </div>
                    )}
                  </div>
                )
              ) : (
                <div className="mb-5">
                  <label className="text-green-700 dark:text-night-200 text-xs font-semibold uppercase tracking-wide mb-2 block">2 · Choose a plan</label>
                  <PlanSheet title={`${brand.label} plan`} placeholder="Tap to choose a plan" brand={brand} plans={candidates} selectedId={productId} onSelect={p => { setProductId(p.id); resetValidation() }} />
                </div>
              )}

              {/* Step 3 — meter / smartcard number */}
              {selectedBiller && (
                <div className="mb-5">
                  <label className="text-green-700 dark:text-night-200 text-xs font-semibold uppercase tracking-wide mb-2 block">3 · {refLabel}</label>
                  <div className="flex gap-2">
                    <input
                      type="text" inputMode="numeric" value={customerReference}
                      onChange={(e) => { setCustomerReference(e.target.value.replace(/\D/g, '')); resetValidation() }}
                      placeholder="Enter number"
                      className="flex-1 bg-white dark:bg-night-700 border border-green-100 dark:border-night-500 rounded-2xl px-4 py-3.5 outline-none text-green-950 dark:text-white font-semibold tracking-wide"
                    />
                    <motion.button
                      whileTap={{ scale: 0.96 }} onClick={handleValidate}
                      disabled={customerReference.length < 5 || validateMutation.isPending}
                      className="px-5 rounded-2xl font-bold text-sm disabled:opacity-50 flex items-center gap-1.5"
                      style={{ background: brand.main, color: brand.on }}
                    >
                      {validateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                      {validateMutation.isPending ? 'Checking' : 'Verify'}
                    </motion.button>
                  </div>

                  {/* The trust moment — impossible to miss */}
                  <AnimatePresence>
                    {isVerified && (
                      <motion.div
                        initial={{ opacity: 0, y: 10, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0 }}
                        className="mt-3 flex items-center gap-3 rounded-2xl px-4 py-3.5 border"
                        style={{ background: rgba(brand.main, 0.1), borderColor: rgba(brand.main, 0.4) }}
                      >
                        <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 500, damping: 16 }}>
                          <CheckCircle2 className="w-6 h-6 shrink-0" style={{ color: brand.main }} />
                        </motion.span>
                        <div className="min-w-0">
                          <p className="text-green-600 dark:text-night-300 text-[11px] font-semibold uppercase">Confirm this is correct</p>
                          <p className="text-green-950 dark:text-white font-bold break-words">{validated?.validated_account_name ?? 'Details verified'}</p>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}

              {/* Step 4 — amount (electricity). TV plans carry their own price. */}
              {!isCable && selectedBiller && isVerified && (
                <div>
                  <label className="text-green-700 dark:text-night-200 text-xs font-semibold uppercase tracking-wide mb-2 block">4 · Amount</label>
                  <div className="grid grid-cols-4 gap-2 mb-3">
                    {QUICK_AMOUNTS.map(a => (
                      <motion.button
                        key={a} whileTap={{ scale: 0.95 }} onClick={() => setAmountNaira(a)}
                        className={cn('py-2.5 rounded-xl text-xs font-bold border', amountNaira === a ? 'border-transparent' : 'bg-white dark:bg-night-700 text-green-800 dark:text-night-100 border-green-100 dark:border-night-500')}
                        style={amountNaira === a ? { background: brand.main, color: brand.on } : undefined}
                      >
                        ₦{a.toLocaleString()}
                      </motion.button>
                    ))}
                  </div>
                  <input
                    type="number" inputMode="numeric" value={amountNaira}
                    onChange={(e) => setAmountNaira(e.target.value ? Number(e.target.value) : '')}
                    placeholder={`Or enter an amount (minimum ₦${MIN_ELECTRICITY_NAIRA})`}
                    className="w-full bg-white dark:bg-night-700 border border-green-100 dark:border-night-500 rounded-2xl px-4 py-3.5 outline-none text-green-950 dark:text-white font-semibold"
                  />
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="fixed left-0 right-0 z-30 bg-white/95 dark:bg-night-900/95 backdrop-blur border-t border-green-50 dark:border-night-700 px-4 py-3" style={{ bottom: 'var(--bottom-nav-height, 4.5rem)' }}>
        <motion.button
          whileTap={{ scale: 0.98 }} onClick={() => canPay && setShowConfirm(true)}
          disabled={!canPay || payMutation.isPending}
          className="w-full font-bold py-3.5 rounded-2xl disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
          style={{ background: brand.main, color: brand.on }}
        >
          {payMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
          {payMutation.isPending ? 'Processing…' : `Pay${payAmountKobo > 0 ? ` ${formatNaira(payAmountKobo)}` : ' bill'}`}
        </motion.button>
      </div>

      <PaymentConfirmSheet
        open={showConfirm}
        onClose={() => setShowConfirm(false)}
        onConfirm={handleConfirmPay}
        isSubmitting={payMutation.isPending}
        title={isCable ? 'Confirm cable TV payment' : 'Confirm electricity payment'}
        icon={group ? <BillerLogo brand={brand} size={30} /> : (isCable ? <Tv className="w-6 h-6 text-copper-500" /> : <Zap className="w-6 h-6 text-copper-500" />)}
        amountKobo={payAmountKobo}
        walletBalanceKobo={wallet?.balance_kobo ?? 0}
        detailRows={[
          { label: isCable ? 'Provider' : 'Distribution company', value: group?.name ?? '' },
          ...(selectedBiller ? [{ label: isCable ? 'Plan' : 'Meter type', value: isCable ? selectedBiller.product_name : METER_LABEL[meterKind(selectedBiller)] }] : []),
          { label: refLabel, value: customerReference },
          ...(validated?.validated_account_name ? [{ label: 'Account name', value: validated.validated_account_name }] : []),
        ]}
      />

      {completedRequest && (
        <PaymentReceipt
          open={!!completedRequest}
          onClose={() => { setCompletedRequest(null); navigate(-1) }}
          status={completedRequest.status === 'completed' ? 'completed' : completedRequest.status === 'failed' ? 'failed' : 'pending'}
          amountKobo={completedRequest.amount_charged_kobo ?? completedRequest.amount_kobo}
          serviceName={`${group?.name ?? 'Bill payment'}${!isCable && selectedBiller ? ` — ${METER_LABEL[meterKind(selectedBiller)]}` : ''}`}
          reference={completedRequest.monnify_transaction_reference ?? completedRequest.id}
          timestamp={new Date(completedRequest.created_at).toLocaleString()}
          fields={receiptFields}
          failureReason={completedRequest.failure_reason ?? undefined}
          brand={group ? brand : null}
        />
      )}
    </div>
  )
}
